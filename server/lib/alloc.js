// ============================================================
//  توزيع التكاليف غير المباشرة على الإنتاج (خطوة شهرية، قبل اعتماد سعر المتر)
//   • الأجور غير المباشرة + المصروفات غير المباشرة (5131…5137): مدين إنتاج تحت التشغيل للمرحلة / دائن حساب المصروف نفسه
//   • التوزيع على مرحلتي الصب والتشطيب (والمراحل الفرعية + صب GRG) بنسبة تكلفة كل مرحلة في الشهر
//   • المواد غير المباشرة بتتوزع وقت صرفها على المرحلة (إنتاج تحت التشغيل ← مواد مخزنية ← المخزون)
//   • مواد خلطة GRG المضافة اللي مش مصروفة لصب GRG: بتتنقل من مرحلة صرفها لمرحلة صب GRG بالمعيار
// ============================================================
import { all, get, run, val, tx, insertRow, AppError, r2, r4, num } from '../db.js';
import { acc } from './core.js';
import { replaceJournal, deleteJournals } from './gl.js';
import { getConfig, systemBags, grgStageIds, kindStageIds, additivesOf, MONTH_RE } from './costing.js';

const dc = (account_id, amount, extra = {}) => (amount >= 0 ? { account_id, debit: amount, credit: 0, ...extra } : { account_id, debit: 0, credit: -amount, ...extra });
const cr = (account_id, amount, extra = {}) => dc(account_id, -amount, extra);
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const stageAcc = (id) => val('SELECT COALESCE(s.account_id, p.account_id) FROM stages s LEFT JOIN stages p ON p.id=s.parent_id WHERE s.id=?', id);
const leaves = async (id) => { if (!id) return []; const k = await all('SELECT id FROM stages WHERE parent_id=? AND active=1 ORDER BY seq, id', id); return k.length ? k.map((x) => x.id) : [id]; };
const CL = ['date', 'source_type', 'source_id', 'cost_type', 'cost_class', 'stage_id', 'material_id', 'category_id', 'qty', 'amount', 'description'];

/** الحساب الحي (بدون ترحيل) */
export async function computeAlloc(month) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const out = { month, problems: [], pool: [], targets: [], reclass: [], total: 0 };
  const cfg = await getConfig();
  const ids = [...new Set([...(await leaves(cfg.cast_stage_id)), ...(await leaves(cfg.finish_stage_id)), ...(await leaves(cfg.grg_stage_id))])];
  if (!ids.length) { out.problems.push('اربط مراحل الصب والتشطيب من «ربط المراحل والمواد»'); return out; }
  // ---- المصدر (دائن): أجور غير مباشرة + كل فئة مصروف غير مباشر على حسابها ----
  const lab = r2(num(await val(`SELECT COALESCE(SUM(amount),0) FROM cost_lines WHERE substr(date,1,7)=? AND cost_class='indirect' AND cost_type='labor'`, month)));
  if (lab) out.pool.push({ key: 'labor', account_id: await acc('acc_indirect_labor'), name: 'أجور غير مباشرة', amount: lab });
  for (const x of await all(`SELECT c.category_id, e.name, e.account_id, SUM(c.amount) amt FROM cost_lines c LEFT JOIN expense_categories e ON e.id=c.category_id
      WHERE substr(c.date,1,7)=? AND c.cost_class='indirect' AND c.cost_type='expense' GROUP BY c.category_id, e.name, e.account_id ORDER BY e.name`, month)) {
    const amt = r2(num(x.amt)); if (!amt) continue;
    if (!x.account_id) { out.problems.push(`فئة المصروف «${x.name || 'بدون فئة'}» غير مربوطة بحساب`); continue; }
    out.pool.push({ key: `cat${x.category_id}`, category_id: x.category_id, account_id: x.account_id, name: x.name, amount: amt });
  }
  // ---- نقل المواد المضافة للخلطة (GRG: لكل شيكارة جبس، GRP: لكل كجم بوليستر) لو مش مصروفة فعلاً لمرحلة صب النوع ----
  const delta = new Map();
  for (const kind of ['GRG', 'GRP']) {
    const kIds = kind === 'GRG' ? await grgStageIds(cfg) : await kindStageIds(cfg.cast_stage_id, 'GRP'); const adds = additivesOf(cfg, kind);
    if (!kIds.length || !adds.length) continue;
    const sys = await systemBags(cfg, kind, kIds, month, 0);
    const to = kind === 'GRG' ? (await leaves(cfg.grg_stage_id))[0] : kIds[0];
    for (const a of adds) {
      const need = r4(sys.bags * a.ratio); if (!(need > 0)) continue;
      const issued = num(await val(`SELECT COALESCE(SUM(qty),0) FROM cost_lines WHERE substr(date,1,7)=? AND material_id=? AND cost_type='material' AND stage_id IN (${kIds.join(',')}) AND source_type NOT IN ('ialloc','ireclass')`, month, a.material_id));
      if (issued > 0) continue;
      let left = need;
      for (const r of await all(`SELECT stage_id, SUM(qty) q, SUM(amount) a FROM cost_lines WHERE substr(date,1,7)=? AND material_id=? AND cost_class='indirect' AND cost_type='material' AND source_type='issue'
          AND stage_id IS NOT NULL AND stage_id NOT IN (${kIds.join(',')}) GROUP BY stage_id ORDER BY stage_id`, month, a.material_id)) {
        const q = num(r.q); if (!(q > 0) || left <= 0) continue; const dq = Math.min(left, q), da = r2(num(r.a) * dq / q); left = r4(left - dq);
        out.reclass.push({ kind, material_id: a.material_id, name: await val('SELECT name FROM materials WHERE id=?', a.material_id), from_stage_id: r.stage_id, to_stage_id: to, qty: r4(dq), amount: da });
        delta.set(to, r2((delta.get(to) || 0) + da)); delta.set(r.stage_id, r2((delta.get(r.stage_id) || 0) - da));
      }
    }
  }
  // ---- المستهدف (مدين): المراحل بنسبة تكلفة كل مرحلة في الشهر ----
  let base = [];
  for (const id of ids) {
    const b = r2(num(await val(`SELECT COALESCE(SUM(amount),0) FROM cost_lines WHERE substr(date,1,7)=? AND stage_id=? AND cost_class<>'transfer' AND source_type NOT IN ('ialloc','ireclass')`, month, id)) + (delta.get(id) || 0));
    base.push({ stage_id: id, name: await val('SELECT name FROM stages WHERE id=?', id), account_id: await stageAcc(id), base: Math.max(b, 0) });
  }
  const B = base.reduce((t, x) => t + x.base, 0); const P = r2(out.pool.reduce((t, x) => t + x.amount, 0));
  out.total = P;
  if (P && !(B > 0)) out.problems.push('مفيش تكلفة على مراحل الصب والتشطيب في الشهر عشان نوزّع عليها');
  for (const t of base) if (P && t.base > 0 && !t.account_id) out.problems.push(`المرحلة «${t.name}» غير مربوطة بحساب إنتاج تحت التشغيل`);
  if (P && B > 0) {
    const act = base.filter((x) => x.base > 0); const lines = [];
    for (const p of out.pool) { let left = p.amount; act.forEach((t, i) => { const v = i === act.length - 1 ? left : r2(p.amount * t.base / B); left = r2(left - v); lines.push({ pool: p.key, stage_id: t.stage_id, amount: v }); }); }
    out.targets = act.map((t) => ({ ...t, share: r4(t.base / B), amount: r2(lines.filter((l) => l.stage_id === t.stage_id).reduce((s, l) => s + l.amount, 0)) }));
    out.lines = lines;
  }
  return out;
}

export async function getAlloc(month) {
  const cur = await get('SELECT * FROM indirect_allocations WHERE month=?', month);
  const live = await computeAlloc(month);
  if (cur?.status === 'approved' && cur.snapshot) {
    const s = JSON.parse(cur.snapshot);
    return { ...s, status: 'approved', approved_at: cur.approved_at, drift: r2(live.total) !== r2(s.total) || live.pool.length !== s.pool.length ? live.total : null };
  }
  return { ...live, status: cur ? 'draft' : 'new' };
}

export const approveAlloc = (...a) => tx(() => _approve(...a));
async function _approve(month, user) {
  const cur = await get('SELECT * FROM indirect_allocations WHERE month=?', month);
  if (cur?.status === 'approved') throw new AppError('التوزيع معتمد بالفعل');
  if (await get(`SELECT 1 FROM unit_cost_periods WHERE month=? AND status='approved' AND project_id=0`, month)) throw new AppError('سعر المتر معتمد لهذا الشهر — أعد فتحه أولاً');
  const r = await computeAlloc(month);
  if (r.problems.length) throw new AppError(r.problems[0]);
  if (!r.pool.length && !r.reclass.length) throw new AppError('مفيش تكاليف غير مباشرة تتوزع في الشهر ده');
  const id = cur ? cur.id : await insertRow('indirect_allocations', { month }, ['month']);
  await run(`DELETE FROM cost_lines WHERE source_type IN ('ialloc','ireclass') AND source_id=?`, id);
  const date = monthEnd(month); const lines = []; const desc = `توزيع تكاليف غير مباشرة ${month}`;
  for (const m of r.reclass) {   // نقل مادة مضافة من مرحلة صرفها لصب GRG
    const fa = await stageAcc(m.from_stage_id), ta = await stageAcc(m.to_stage_id);
    if (!fa || !ta) throw new AppError('مراحل نقل مواد GRG لازم تكون مربوطة بحساب إنتاج تحت التشغيل');
    lines.push(dc(ta, m.amount, { stage_id: m.to_stage_id }), cr(fa, m.amount, { stage_id: m.from_stage_id }));
    for (const [sg, sgn] of [[m.to_stage_id, 1], [m.from_stage_id, -1]])
      await insertRow('cost_lines', { date, source_type: 'ireclass', source_id: id, cost_type: 'material', cost_class: 'direct', stage_id: sg, material_id: m.material_id, qty: sgn * m.qty, amount: sgn * m.amount, description: `نقل مادة مضافة GRG — ${desc}` }, CL);
  }
  for (const t of r.targets) lines.push(dc(t.account_id, t.amount, { stage_id: t.stage_id }));
  for (const p of r.pool) lines.push(cr(p.account_id, p.amount));
  for (const l of r.lines || []) {
    const p = r.pool.find((x) => x.key === l.pool);
    await insertRow('cost_lines', { date, source_type: 'ialloc', source_id: id, cost_type: 'expense', cost_class: 'direct', stage_id: l.stage_id, category_id: p.category_id ?? null, qty: 0, amount: l.amount, description: `${desc} — ${p.name}` }, CL);
  }
  await replaceJournal({ date, source_type: 'ialloc', source_id: id, description: desc, lines });
  await run(`UPDATE indirect_allocations SET status='approved', snapshot=?, approved_by=?, approved_at=to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, JSON.stringify(r), user?.id ?? null, id);
  return await getAlloc(month);
}

export const reopenAlloc = (...a) => tx(() => _reopen(...a));
async function _reopen(month) {
  const cur = await get('SELECT * FROM indirect_allocations WHERE month=?', month);
  if (!cur || cur.status !== 'approved') throw new AppError('التوزيع غير معتمد');
  if (await get(`SELECT 1 FROM unit_cost_periods WHERE month=? AND status='approved' AND project_id=0`, month)) throw new AppError('سعر المتر معتمد لهذا الشهر — أعد فتحه أولاً');
  if (await get(`SELECT 1 FROM costing_runs WHERE month=? AND status='approved'`, month)) throw new AppError('في تكلفة منتج تام معتمدة لهذا الشهر — أعد فتحها أولاً');
  await deleteJournals('ialloc', cur.id);
  await run(`DELETE FROM cost_lines WHERE source_type IN ('ialloc','ireclass') AND source_id=?`, cur.id);
  await run(`UPDATE indirect_allocations SET status='draft', snapshot=NULL, approved_by=NULL, approved_at=NULL WHERE id=?`, cur.id);
  return await getAlloc(month);
}
