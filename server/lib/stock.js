import { all, get, run, insertRow, AppError, r2, r4 } from '../db.js';
import { getSetting } from './core.js';

const EPS = 1e-7;
const MOVE_COLS = ['date', 'ord', 'warehouse_id', 'material_id', 'direction', 'qty', 'cost_mode', 'value', 'doc_type', 'doc_id', 'line_id', 'party', 'notes'];

/** معالجات إعادة التقييم: لما تكلفة صرف قديم تتغير بسبب حركة بأثر رجعي، المستند بيتبني من جديد */
export const onRecost = {}; // { doc_type: (doc_id) => void }

/**
 * إضافة حركة مخزون. وارد: القيمة معروفة (value). صادر: لو value مش محددة بتتحسب بالمتوسط المرجح.
 * بعد إضافة كل حركات المستند لازم يتنادى settle() عشان يتحسب الرصيد والتكلفة.
 */
export async function addMove(m) {
  const mode = m.direction === 'out' && (m.value === undefined || m.value === null) ? 'avg' : 'fixed';
  const ord = m.ord ?? (m.doc_type === 'opening' ? 0 : m.direction === 'in' ? 1 : 2);
  return await insertRow('stock_moves', { ...m, ord, cost_mode: mode, value: r2(m.value ?? 0) }, MOVE_COLS);
}

/** إعادة حساب دفتر صنف في مخزن بالكامل بالمتوسط المرجح المتحرك. بترجع الحركات اللي اتغيّرت قيمتها. */
export async function recost(warehouse_id, material_id) {
  const moves = await all(`SELECT * FROM stock_moves WHERE warehouse_id=? AND material_id=? ORDER BY date, ord, id`, warehouse_id, material_id);
  const allowNeg = await getSetting('allow_negative_stock', '0') === '1';
  const upd = async (id, value, unit, bq, bv, av) =>
    await run('UPDATE stock_moves SET value=?, unit_cost=?, bal_qty=?, bal_value=?, avg_cost=? WHERE id=?', value, unit, bq, bv, av, id);
  let q = 0, v = 0, lastAvg = 0;
  const changed = [];
  for (const m of moves) {
    let value = m.value;
    if (m.direction === 'in') {
      q += m.qty; v += value;
    } else {
      if (m.cost_mode === 'avg') {
        const avg = q > EPS ? v / q : lastAvg;
        // لو الصرف هيصفّر الرصيد ياخد كل القيمة المتبقية (مفيش كسور تتسرّب)
        value = q > EPS && Math.abs(q - m.qty) < 1e-6 ? r2(v) : r2(avg * m.qty);
      }
      q -= m.qty; v -= value;
    }
    q = Math.abs(q) < EPS ? 0 : Math.round(q * 1e6) / 1e6;
    v = r2(v);
    if (q < -EPS && !allowNeg) {
      const mat = await get('SELECT name FROM materials WHERE id=?', material_id);
      throw new AppError(`رصيد «${mat?.name}» لا يكفي: الرصيد يصبح ${q} بتاريخ ${m.date}. راجع الكميات أو التواريخ.`);
    }
    if (q > EPS) lastAvg = v / q;
    const unit = m.qty > 0 ? r4(value / m.qty) : 0;
    if (m.cost_mode === 'avg' && Math.abs(value - m.value) > 0.004) changed.push({ ...m, new_value: value });
    await upd(m.id, value, unit, q, v, q > EPS ? r4(v / q) : r4(lastAvg));
  }
  await run(`INSERT INTO material_stock(warehouse_id,material_id,qty,value,avg_cost) VALUES(?,?,?,?,?)
       ON CONFLICT(warehouse_id,material_id) DO UPDATE SET qty=excluded.qty, value=excluded.value, avg_cost=excluded.avg_cost`,
    warehouse_id, material_id, q, v, q > EPS ? r4(v / q) : r4(lastAvg));
  return changed;
}

/** تسوية مجموعة (مخزن، صنف): إعادة حساب + إعادة بناء المستندات اللي تكلفتها اتغيرت (ما عدا المستند الحالي) */
export async function settle(pairs, skip = null) {
  const seen = new Set(); const docs = new Map();
  for (const [w, mt] of pairs) {
    const k = `${w}:${mt}`; if (seen.has(k)) continue; seen.add(k);
    for (const c of await recost(w, mt)) {
      if (skip && skip.type === c.doc_type && skip.id === c.doc_id) continue;
      docs.set(`${c.doc_type}:${c.doc_id}`, c);
    }
  }
  for (const c of docs.values()) {
    const fn = onRecost[c.doc_type];
    if (!fn) continue;
    try { await fn(c.doc_id); }
    catch (e) {
      if (e instanceof AppError) throw new AppError(`هذه الحركة بأثر رجعي تغيّر تكلفة مستند آخر (${c.doc_type} #${c.doc_id} بتاريخ ${c.date}) وتعذّر تحديثه: ${e.message}`);
      throw e;
    }
  }
}

/** مسح حركات مستند ثم إعادة التقييم؛ بترجع الأزواج المتأثرة */
export async function removeMoves(doc_type, doc_id) {
  const pairs = (await all('SELECT DISTINCT warehouse_id w, material_id m FROM stock_moves WHERE doc_type=? AND doc_id=?', doc_type, doc_id)).map((r) => [r.w, r.m]);
  await run('DELETE FROM stock_moves WHERE doc_type=? AND doc_id=?', doc_type, doc_id);
  await settle(pairs);
  return pairs;
}

export const stockOf = async (warehouse_id, material_id) =>
  await get('SELECT qty,value,avg_cost FROM material_stock WHERE warehouse_id=? AND material_id=?', warehouse_id, material_id) || { qty: 0, value: 0, avg_cost: 0 };

/** الرصيد والمتوسط بعد آخر حركة في تاريخ معين (شاملاً اليوم) */
export async function stockAsOf(warehouse_id, material_id, date) {
  const r = await get(`SELECT bal_qty qty, bal_value value, avg_cost FROM stock_moves
                 WHERE warehouse_id=? AND material_id=? AND date<=? ORDER BY date DESC, ord DESC, id DESC LIMIT 1`, warehouse_id, material_id, date);
  return r || { qty: 0, value: 0, avg_cost: 0 };
}
/** آخر تكلفة معروفة للصنف (لتقييم الزيادة في الجرد لو الرصيد صفر) */
export async function lastKnownCost(material_id) {
  const r = await get(`SELECT unit_cost FROM stock_moves WHERE material_id=? AND direction='in' AND qty>0 AND unit_cost>0 ORDER BY date DESC, id DESC LIMIT 1`, material_id);
  return r ? r.unit_cost : 0;
}
