// ============================================================
//  المرحلة 3: الإنتاج التام ← تكلفة المنتج التام ← التسليم للعميل ← المستخلص
//   • سجل الإنتاج: كميات فقط (القيمة بتتحدد في تشغيل نهاية الشهر)
//   • تشغيل التكلفة (لكل مشروع وشهر): تكلفة المشروع كلها (سعر المتر + قوالب + مباشر + غير مباشر موزّع) ← قيمة كل بند تام ← مخزن التام (1222)
//   • إذن التسليم: الإيراد = متوسط كارت الصنف وقت التسليم × (1 + نسبة الربح)، والتكلفة بتخرج من 1222 بالمتوسط المرجح
//   • المستخلص: إذونات التسليم غير المستخلصة + خصومات وإضافات مكوّدة (نسبة أو رقم)
// ============================================================
import { all, get, run, val, tx, insertRow, AppError, r2, r4, num } from '../db.js';
import { acc, nextNo, getSetting } from './core.js';
import { postJournal, replaceJournal, deleteJournals } from './gl.js';
import { addMove, settle, removeMoves, stockOf, stockAsOf, onRecost } from './stock.js';
import { DOCS } from './docs.js';
import { computeLive, getPeriod, getSheet } from './costing.js';
export { DOCS };

const dc = (account_id, amount, extra = {}) => (amount >= 0 ? { account_id, debit: amount, credit: 0, ...extra } : { account_id, debit: 0, credit: -amount, ...extra });
const cr = (account_id, amount, extra = {}) => dc(account_id, -amount, extra);
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const monthOf = (d) => String(d).slice(0, 7);

// ---------- مخزن التام وصنف المنتج التام ----------
export async function fgWarehouse() {
  let id = await val(`SELECT id FROM warehouses WHERE type='finished' AND active=1 ORDER BY id LIMIT 1`);
  if (!id) id = await insertRow('warehouses', { code: await nextNo('warehouse'), name: 'مخزن المنتجات التامة', type: 'finished' }, ['code', 'name', 'type']);
  return id;
}
/** صنف خاص بكل بند مشروع في دفتر المخزون (عشان نستخدم نفس محرك المتوسط المرجح وكارت الصنف). مش بيظهر في كود الأصناف */
export async function fgMaterial(itemId) {
  const it = await get('SELECT * FROM project_items WHERE id=?', itemId);
  if (!it) throw new AppError('البند غير موجود');
  if (it.fg_material_id) return it.fg_material_id;
  const unit = it.unit_id || await val('SELECT id FROM units ORDER BY id LIMIT 1');
  const id = await insertRow('materials', { code: `FG-${it.code}`, name: `${it.name} (تام)`, unit_id: unit, fg_item_id: it.id }, ['code', 'name', 'unit_id', 'fg_item_id']);
  await run('UPDATE project_items SET fg_material_id=? WHERE id=?', id, itemId);
  return id;
}
export const profitPct = async () => num(await getSetting('profit_pct', '0'));

// ============================================================
//  سجل الإنتاج التام (كميات)
// ============================================================
async function runLock(month, projectId, what) {
  const r = await get(`SELECT id FROM costing_runs WHERE month=? AND project_id=? AND status='approved'`, month, projectId);
  if (r) throw new AppError(`تكلفة المنتج التام لشهر ${month} على المشروع معتمدة — أعد فتح التشغيل من «تكاليف مشروعات» قبل ${what}`);
}
DOCS.production_log = {
  table: 'production_logs', lines: 'production_log_lines', fk: 'log_id', seq: 'production_log',
  cols: ['date', 'project_id', 'notes'], lineCols: ['item_id', 'qty', 'area_m2', 'notes'], blank: (l) => !l.item_id,
  async validate(p, lines) {
    if (!p.project_id || !await get('SELECT 1 FROM projects WHERE id=?', p.project_id)) throw new AppError('اختر المشروع');
    await runLock(monthOf(p.date), Number(p.project_id), 'تسجيل إنتاج فيه');
    for (const l of lines) {
      const it = await get('SELECT * FROM project_items WHERE id=?', l.item_id);
      if (!it || it.project_id !== Number(p.project_id)) throw new AppError('البند لا يتبع المشروع المختار');
      if (!(num(l.qty) > 0)) throw new AppError(`كمية «${it.name}» لازم تكون أكبر من صفر`);
      if (!(num(it.area_m2) > 0)) throw new AppError(`حدد المتر المسطح للقطعة في بند «${it.name}» (الإعدادات ← بنود المشروعات)`);
      l.area_m2 = num(it.area_m2);   // بنثبّت متر القطعة وقت التسجيل
    }
  },
  async unpost(cur) { await runLock(monthOf(cur.date), cur.project_id, 'تعديل أو إلغاء سجل إنتاج'); },
  async enrich(h) { h.project_name = await val('SELECT name FROM projects WHERE id=?', h.project_id); },
};

/** كميات وأمتار الإنتاج التام في شهر (لمشروع أو لكل المشروعات) */
export async function monthProduction(month, projectId = null) {
  const pw = projectId ? ' AND d.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  return await all(`SELECT l.item_id, i.name, i.kind, d.project_id, SUM(l.qty) qty, SUM(l.qty*l.area_m2) meters
    FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id JOIN project_items i ON i.id=l.item_id
    WHERE d.status='posted' AND substr(d.date,1,7)=?${pw} GROUP BY l.item_id, i.name, i.kind, d.project_id ORDER BY i.name`, month, ...pp);
}

// ============================================================
//  تشغيل تكلفة المنتج التام لمشروع وشهر
// ============================================================
/** الحساب الحي. لا يغيّر شيئاً — المعتمد بيتخزّن snapshot */
export async function computeRun(month, projectId, carryIn = null) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const project = await get('SELECT id, name FROM projects WHERE id=?', projectId);
  if (!project) throw new AppError('اختر المشروع');
  const saved = await get('SELECT * FROM costing_runs WHERE month=? AND project_id=?', month, projectId);
  const carry = r2(num(carryIn ?? saved?.carry ?? 0));
  const prod = await monthProduction(month, projectId);
  const allMeters = r4((await monthProduction(month)).reduce((t, r) => t + num(r.meters), 0));
  const meters = r4(prod.reduce((t, r) => t + num(r.meters), 0));
  const out = { month, project_id: projectId, project_name: project.name, status: saved?.status || 'new', carry, items: [], problems: [], total_meters: meters, month_meters: allMeters };
  if (!prod.length) { out.problems.push('لا يوجد إنتاج تام مسجّل لهذا المشروع في الشهر'); return out; }
  const kinds = [...new Set(prod.map((r) => r.kind || 'GRC'))];
  const cfg = (await computeLive(month, 0, null, '')).config;
  // سعر المتر لكل نوع (لازم يكون معتمد)
  const unit = {};
  for (const k of kinds) {
    const p = await getPeriod(month, 0, k);
    if (p?.status !== 'approved') { out.problems.push(`اعتمد سعر متر ${k} لشهر ${month} من «تكلفة المتر» أولاً`); continue; }
    const s = await getSheet(month, 0, k);
    unit[k] = { cast: num(s.unit_cost.cast), finish: num(s.unit_cost.finish), cast_ids: s.stage_ids?.cast || [], finish_ids: s.stage_ids?.finish || [], cast_stage_id: String(k).toUpperCase() === 'GRG' ? cfg.grg_stage_id : cfg.cast_stage_id };
  }
  // قوالب المشروع (شامل نصيبه من القوالب غير المسنَدة)
  const live = await computeLive(month, 0, null, '');
  const mold = r2(num(live.mold?.by_project?.find((r) => r.project_id === Number(projectId))?.total));
  // المباشر خارج المتر المجمّع: مراحل غير (صب/تشطيب/قوالب)
  const fam = [cfg.cast_stage_id, cfg.finish_stage_id, cfg.mold_stage_id, cfg.grg_stage_id].filter(Boolean);
  const famSql = fam.length ? `AND COALESCE(c.stage_id,0) NOT IN (SELECT id FROM stages WHERE id IN (${fam.join(',')}) OR parent_id IN (${fam.join(',')}))` : '';
  const otherRows = await all(`SELECT COALESCE(c.stage_id,0) stage_id, SUM(c.amount) amt FROM cost_lines c
    WHERE substr(c.date,1,7)=? AND c.project_id=? AND c.cost_class='direct' ${famSql} GROUP BY COALESCE(c.stage_id,0)`, month, projectId);
  const other = r2(otherRows.reduce((t, r) => t + num(r.amt), 0));
  // غير المباشر اتوزّع قبل كده على مراحل الصب والتشطيب (خطوة «توزيع غير المباشر») فهو داخل سعر المتر
  const indPool = 0, share = 0, indirect = 0;
  if (carry < 0 || carry > r2(mold + other) + 0.004) out.problems.push(`المرحّل لنصف المصنّع لازم يكون بين صفر و ${r2(mold + other)} (قوالب + مباشر خارج المتر)`);
  const extras = r2(mold + other - carry + indirect);
  const extraPer = meters > 0 ? extras / meters : 0;
  let poolCast = 0, poolFinish = 0; const byStageIds = []; const items = [];
  for (const r of prod) {
    const k = r.kind || 'GRC', u = unit[k] || { cast: 0, finish: 0, auto: 0 }; const m = num(r.meters);
    const castV = r2(m * u.cast), finV = r2(m * u.finish), extV = r2(m * extraPer);
    poolCast += castV; poolFinish += finV;
    byStageIds.push({ ids: u.cast_ids?.length ? u.cast_ids : [u.cast_stage_id || cfg.cast_stage_id], amt: castV, label: 'صب (سعر المتر)' });
    if (finV) byStageIds.push({ ids: u.finish_ids?.length ? u.finish_ids : [cfg.finish_stage_id], amt: finV, label: 'تشطيب (سعر المتر)' });
    items.push({ item_id: r.item_id, name: r.name, kind: k, qty: r4(r.qty), meters: r4(m), pool: r2(castV + finV), extras: extV, value: r2(castV + finV + extV) });
  }
  // فرق التقريب على آخر بند عشان إجمالي البنود = إجمالي تكلفة المشروع
  const target = r2(poolCast + poolFinish + extras);
  const diff = r2(target - items.reduce((t, i) => t + i.value, 0));
  if (items.length) items[items.length - 1].value = r2(items[items.length - 1].value + diff);
  items.forEach((i) => { i.unit_cost = i.qty > 0 ? r4(i.value / i.qty) : 0; });
  // أرصدة الإنتاج تحت التشغيل اللي هتتخفّض (الدائن)
  const stageAcc = async (sid) => (sid ? await val('SELECT COALESCE(s.account_id, p.account_id) FROM stages s LEFT JOIN stages p ON p.id=s.parent_id WHERE s.id=?', sid) : null);
  const f = mold + other > 0 ? (mold + other - carry) / (mold + other) : 1;
  const credits = [];
  const addCr = (account_id, amount, label, stage_id = null) => { if (amount && account_id) credits.push({ account_id, amount: r2(amount), label, stage_id }); };
  // الدائن على إنتاج تحت التشغيل بكل فروع المرحلة: موزّع على المراحل الفرعية للنوع بنسبة تكلفة كل فرع في الشهر
  for (const g of byStageIds) {
    const w = []; for (const id of g.ids) w.push(Math.max(num(await val(`SELECT COALESCE(SUM(amount),0) FROM cost_lines WHERE substr(date,1,7)=? AND stage_id=? AND cost_class<>'transfer'`, month, id)), 0));
    const W = w.reduce((t, x) => t + x, 0); let left = g.amt;
    for (const [i, id] of g.ids.entries()) { const v = i === g.ids.length - 1 ? left : r2(g.amt * (W > 0 ? w[i] / W : 1 / g.ids.length)); left = r2(left - v); addCr(await stageAcc(id), v, g.label, id); }
  }
  addCr(await stageAcc(cfg.mold_stage_id), mold * f, 'قوالب', cfg.mold_stage_id);
  for (const r of otherRows) addCr((await stageAcc(r.stage_id)) || (await stageAcc(cfg.finish_stage_id)), num(r.amt) * f, 'مباشر على المشروع', r.stage_id || null);
  const credSum = r2(credits.reduce((t, c) => t + c.amount, 0));
  if (credits.length && credSum !== target) { const big = credits.reduce((a, b) => (b.amount > a.amount ? b : a)); big.amount = r2(big.amount + target - credSum); }
  Object.assign(out, { items, credits, total: target, per_meter: meters > 0 ? r4(target / meters) : 0,
    parts: { pool_cast: r2(poolCast), pool_finish: r2(poolFinish), mold, other_direct: other, carry, indirect_pool: indPool, indirect_share: r4(share), indirect, extras }, unit });
  return out;
}

export async function saveRun(month, projectId, carry) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح');
  const cur = await get('SELECT * FROM costing_runs WHERE month=? AND project_id=?', month, projectId);
  if (cur?.status === 'approved') throw new AppError('التشغيل معتمد — أعد فتحه أولاً');
  const chk = (await computeRun(month, projectId, carry)).problems.find((x) => x.startsWith('المرحّل'));
  if (chk) throw new AppError(chk);
  if (cur) await run('UPDATE costing_runs SET carry=? WHERE id=?', r2(num(carry)), cur.id);
  else await insertRow('costing_runs', { month, project_id: projectId, carry: r2(num(carry)) }, ['month', 'project_id', 'carry']);
  return await computeRun(month, projectId);
}

export const approveRun = (...a) => tx(() => _approveRun(...a));
async function _approveRun(month, projectId, user) {
  const cur = await get('SELECT * FROM costing_runs WHERE month=? AND project_id=?', month, projectId);
  if (cur?.status === 'approved') throw new AppError('التشغيل معتمد بالفعل');
  const r = await computeRun(month, projectId, cur?.carry ?? 0);
  if (r.problems.length) throw new AppError(r.problems[0]);
  if (!r.items.length || !(r.total > 0)) throw new AppError('لا توجد تكلفة لتحميلها على المنتج التام');
  const runId = cur ? cur.id : await insertRow('costing_runs', { month, project_id: projectId, carry: 0 }, ['month', 'project_id', 'carry']);
  const wh = await fgWarehouse(); const fgAcc = await acc('acc_fg'); const pairs = [];
  await run('DELETE FROM costing_run_items WHERE run_id=?', runId);
  const dr = [];
  for (const it of r.items) {
    await insertRow('costing_run_items', { run_id: runId, item_id: it.item_id, qty: it.qty, meters: it.meters, value: it.value }, ['run_id', 'item_id', 'qty', 'meters', 'value']);
    const mat = await fgMaterial(it.item_id);
    // كل سطر إنتاج بياخد نصيبه من قيمة البند ويدخل مخزن التام بتاريخ الإنتاج (عشان التسليم الأقدم من آخر الشهر يشتغل)
    const logs = await all(`SELECT l.id, d.date, l.qty FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id
      WHERE d.status='posted' AND substr(d.date,1,7)=? AND d.project_id=? AND l.item_id=? ORDER BY d.date, l.id`, month, projectId, it.item_id);
    const totQty = logs.reduce((t, l) => t + num(l.qty), 0); let left = it.value;
    for (const [i, l] of logs.entries()) {
      const v = i === logs.length - 1 ? left : r2(it.value * num(l.qty) / totQty); left = r2(left - v);
      await addMove({ date: l.date, warehouse_id: wh, material_id: mat, direction: 'in', qty: num(l.qty), value: v, doc_type: 'fgrun', doc_id: runId, line_id: l.id,
        party: `إنتاج تام ${month}`, notes: r.project_name });
    }
    pairs.push([wh, mat]);
    dr.push(dc(fgAcc, it.value, { project_id: projectId, item_id: it.item_id }));
  }
  await settle(pairs, { type: 'fgrun', id: runId });
  await replaceJournal({ date: monthEnd(month), source_type: 'fgrun', source_id: runId, description: `تحميل تكلفة المنتج التام ${month} — ${r.project_name}`,
    lines: [...dr, ...r.credits.map((c) => cr(c.account_id, c.amount, { project_id: projectId, ...(c.stage_id ? { stage_id: c.stage_id } : {}) }))] });
  await run(`UPDATE costing_runs SET status='approved', snapshot=?, approved_by=?, approved_at=to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, JSON.stringify(r), user?.id ?? null, runId);
  return await getRun(month, projectId);
}

export const reopenRun = (...a) => tx(() => _reopenRun(...a));
async function _reopenRun(month, projectId) {
  const cur = await get('SELECT * FROM costing_runs WHERE month=? AND project_id=?', month, projectId);
  if (!cur || cur.status !== 'approved') throw new AppError('التشغيل غير معتمد');
  await deleteJournals('fgrun', cur.id);
  await removeMoves('fgrun', cur.id);     // لو في تسليمات مبنية على الكمية دي هيرفض بسبب الرصيد
  await run('DELETE FROM costing_run_items WHERE run_id=?', cur.id);
  await run(`UPDATE costing_runs SET status='draft', snapshot=NULL, approved_by=NULL, approved_at=NULL WHERE id=?`, cur.id);
  return await getRun(month, projectId);
}

/** المعتمد من الـ snapshot (ثابت)، والمسودة بالحساب الحي */
export async function getRun(month, projectId) {
  const cur = await get('SELECT * FROM costing_runs WHERE month=? AND project_id=?', month, projectId);
  if (cur?.status === 'approved' && cur.snapshot) return { ...JSON.parse(cur.snapshot), status: 'approved', approved_at: cur.approved_at };
  return await computeRun(month, projectId);
}

/** نظرة الشهر: كل المشروعات اللي فيها إنتاج تام + حالة تشغيل كل واحد */
export async function monthOverview(month) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const rows = await all(`SELECT p.id project_id, p.name project_name, SUM(l.qty) qty, SUM(l.qty*l.area_m2) meters
    FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id JOIN projects p ON p.id=d.project_id
    WHERE d.status='posted' AND substr(d.date,1,7)=? GROUP BY p.id, p.name ORDER BY p.name`, month);
  const out = [];
  for (const r of rows) {
    const run_ = await get('SELECT status, snapshot FROM costing_runs WHERE month=? AND project_id=?', month, r.project_id);
    let total = null; if (run_?.status === 'approved' && run_.snapshot) total = JSON.parse(run_.snapshot).total;
    out.push({ ...r, qty: r4(r.qty), meters: r4(r.meters), status: run_?.status || 'new', total, per_meter: total && num(r.meters) ? r4(total / num(r.meters)) : null });
  }
  return out;
}

// ============================================================
//  إذن التسليم للعميل
// ============================================================
async function buildDelivery(id) {
  const h = await get('SELECT * FROM delivery_notes WHERE id=?', id);
  if (!h || h.status === 'void') return;
  const lines = await all('SELECT * FROM delivery_note_lines WHERE note_id=? ORDER BY id', id);
  let totalCost = 0, total = 0; const jl = [];
  const [ar, rev, cogs, fg] = [await acc('acc_ar'), await acc('acc_revenue'), await acc('acc_cogs'), await acc('acc_fg')];
  for (const l of lines) {
    const mv = await get(`SELECT value FROM stock_moves WHERE doc_type='delivery' AND doc_id=? AND line_id=?`, id, l.id);
    const cost = r2(mv.value), amount = r2(cost * (1 + num(h.profit_pct) / 100));
    await run('UPDATE delivery_note_lines SET cost=?, unit_cost=?, amount=?, unit_price=? WHERE id=?', cost, r4(cost / num(l.qty)), amount, r4(amount / num(l.qty)), l.id);
    totalCost += cost; total += amount;
    jl.push(dc(cogs, cost, { project_id: h.project_id, item_id: l.item_id }), cr(fg, cost, { project_id: h.project_id, item_id: l.item_id }),
      cr(rev, amount, { project_id: h.project_id, item_id: l.item_id }));
  }
  totalCost = r2(totalCost); total = r2(total);
  await run('UPDATE delivery_notes SET total_cost=?, total=? WHERE id=?', totalCost, total, id);
  jl.push(dc(ar, total, { client_id: h.client_id, project_id: h.project_id }));
  await replaceJournal({ date: h.date, source_type: 'delivery', source_id: id, description: `إذن تسليم ${h.no} — ${await val('SELECT name FROM projects WHERE id=?', h.project_id)}`, lines: jl, allowZero: true });
  // أي مستخلص فيه بنود من الإذن ده لازم يتحدّث بالأسعار الجديدة
  for (const c of await all(`SELECT DISTINCT c.id FROM client_certificates c JOIN client_certificate_lines cl ON cl.cert_id=c.id
    JOIN delivery_note_lines dl ON dl.id=cl.delivery_line_id WHERE dl.note_id=? AND c.status='posted'`, id)) await buildCertificate(c.id);
}
onRecost.delivery = buildDelivery;

DOCS.delivery_note = {
  table: 'delivery_notes', lines: 'delivery_note_lines', fk: 'note_id', seq: 'delivery_note',
  cols: ['date', 'project_id', 'client_id', 'site_id', 'manual_no', 'vehicle_no', 'driver_name', 'profit_pct', 'notes'], lineCols: ['item_id', 'qty', 'notes'], blank: (l) => !l.item_id,
  async validate(p, lines, id) {
    const prj = await get('SELECT * FROM projects WHERE id=?', p.project_id);
    if (!prj) throw new AppError('اختر المشروع');
    if (!prj.client_id) throw new AppError('المشروع ده مش مربوط بعميل — حدد العميل في الإعدادات ← المشروعات');
    p.client_id = prj.client_id;
    // الموقع: بيفتح بس لو المشروع له مواقع متكودة، وساعتها إجباري ولازم يتبع المشروع
    const siteIds = (await all('SELECT id FROM sites WHERE project_id=? AND active=1', prj.id)).map((x) => Number(x.id));
    if (siteIds.length) {
      if (!p.site_id) throw new AppError('اختر الموقع — المشروع ده متكود له مواقع');
      if (!siteIds.includes(Number(p.site_id))) throw new AppError('الموقع المختار لا يتبع المشروع');
    } else p.site_id = null;
    if (p.profit_pct === undefined || p.profit_pct === null || p.profit_pct === '' || !id) p.profit_pct = await profitPct();
    const seen = new Set();
    for (const l of lines) {
      const it = await get('SELECT * FROM project_items WHERE id=?', l.item_id);
      if (!it || it.project_id !== Number(p.project_id)) throw new AppError('البند لا يتبع المشروع المختار');
      if (!(num(l.qty) > 0)) throw new AppError(`كمية «${it.name}» لازم تكون أكبر من صفر`);
      if (!it.fg_material_id) throw new AppError(`«${it.name}» لا يوجد له إنتاج تام معتمد التكلفة بعد`);
      if (seen.has(it.id)) throw new AppError(`البند «${it.name}» مكرر في الإذن`); seen.add(it.id);
    }
  },
  async post(doc) {
    const wh = await fgWarehouse(); const pairs = [];
    for (const l of doc.lines) {
      const mat = await val('SELECT fg_material_id FROM project_items WHERE id=?', l.item_id);
      await addMove({ date: doc.date, warehouse_id: wh, material_id: mat, direction: 'out', qty: l.qty, doc_type: 'delivery', doc_id: doc.id, line_id: l.id,
        party: `تسليم ${await val('SELECT name FROM clients WHERE id=?', doc.client_id)}`, notes: doc.notes });
      pairs.push([wh, mat]);
    }
    await settle(pairs, { type: 'delivery', id: doc.id });
    await buildDelivery(doc.id);
  },
  async unpost(cur) {
    const used = await get(`SELECT c.no FROM client_certificate_lines cl JOIN client_certificates c ON c.id=cl.cert_id JOIN delivery_note_lines dl ON dl.id=cl.delivery_line_id
      WHERE dl.note_id=? AND c.status='posted' LIMIT 1`, cur.id);
    if (used) throw new AppError(`الإذن داخل في المستخلص ${used.no} — ألغِ المستخلص أولاً`);
    await deleteJournals('delivery', cur.id);
    await removeMoves('delivery', cur.id);
  },
  async enrich(h) { h.project_name = await val('SELECT name FROM projects WHERE id=?', h.project_id); h.client_name = await val('SELECT name FROM clients WHERE id=?', h.client_id); },
};
/** رصيد المنتج التام المتاح للتسليم لبنود مشروع (بتاريخ معيّن) */
export async function fgAvailability(projectId, date = null) {
  const wh = await fgWarehouse();
  const items = await all('SELECT id, code, name, fg_material_id FROM project_items WHERE project_id=? AND fg_material_id IS NOT NULL AND active=1 ORDER BY name', projectId);
  const out = [];
  for (const it of items) {
    const st = date ? await stockAsOf(wh, it.fg_material_id, date) : await stockOf(wh, it.fg_material_id);
    out.push({ item_id: it.id, name: it.name, qty: r4(st.qty), avg_cost: r4(st.avg_cost) });
  }
  return out;
}

// ============================================================
//  مستخلص العميل
// ============================================================
async function buildCertificate(id) {
  const h = await get('SELECT * FROM client_certificates WHERE id=?', id);
  if (!h || h.status === 'void') return;
  // الأسعار والمبالغ بتتقرأ من إذونات التسليم (ممكن تتغيّر بإعادة التقييم)
  for (const l of await all('SELECT cl.id, dl.qty, dl.unit_price, dl.amount FROM client_certificate_lines cl JOIN delivery_note_lines dl ON dl.id=cl.delivery_line_id WHERE cl.cert_id=?', id))
    await run('UPDATE client_certificate_lines SET qty=?, unit_price=?, amount=? WHERE id=?', l.qty, l.unit_price, l.amount, l.id);
  const gross = r2(num(await val('SELECT COALESCE(SUM(amount),0) FROM client_certificate_lines WHERE cert_id=?', id)));
  let ded = 0, add = 0; const jl = []; const ar = await acc('acc_ar');
  for (const a of await all('SELECT * FROM client_certificate_adjustments WHERE cert_id=? ORDER BY id', id)) {
    const amount = a.method === 'percent' ? r2(gross * num(a.rate) / 100) : r2(num(a.rate));
    await run('UPDATE client_certificate_adjustments SET amount=? WHERE id=?', amount, a.id);
    if (!amount) continue;
    if (a.kind === 'deduction') { ded += amount; jl.push(dc(a.account_id, amount, { client_id: h.client_id, project_id: h.project_id }), cr(ar, amount, { client_id: h.client_id, project_id: h.project_id })); }
    else { add += amount; jl.push(dc(ar, amount, { client_id: h.client_id, project_id: h.project_id }), cr(a.account_id, amount, { project_id: h.project_id })); }
  }
  ded = r2(ded); add = r2(add);
  await run('UPDATE client_certificates SET gross=?, deductions_total=?, additions_total=?, net=? WHERE id=?', gross, ded, add, r2(gross - ded + add), id);
  if (jl.length) await replaceJournal({ date: h.date, source_type: 'certificate', source_id: id, description: `مستخلص ${h.no} — ${await val('SELECT name FROM clients WHERE id=?', h.client_id)}`, lines: jl });
  else await deleteJournals('certificate', id);
}

DOCS.client_certificate = {
  table: 'client_certificates', lines: 'client_certificate_lines', fk: 'cert_id', seq: 'client_certificate',
  cols: ['date', 'client_id', 'project_id', 'period_from', 'period_to', 'notes'], lineCols: ['delivery_line_id', 'item_id'], blank: (l) => !l.delivery_line_id,
  async validate(p, lines, id) {
    const prj = await get('SELECT * FROM projects WHERE id=?', p.project_id);
    if (!prj) throw new AppError('اختر المشروع');
    if (!prj.client_id) throw new AppError('المشروع ده مش مربوط بعميل');
    p.client_id = prj.client_id;
    const seen = new Set();
    for (const l of lines) {
      const dl = await get(`SELECT dl.*, n.project_id, n.status, n.no FROM delivery_note_lines dl JOIN delivery_notes n ON n.id=dl.note_id WHERE dl.id=?`, l.delivery_line_id);
      if (!dl || dl.status === 'void') throw new AppError('بند تسليم غير موجود أو إذنه ملغي');
      if (dl.project_id !== Number(p.project_id)) throw new AppError(`بند الإذن ${dl.no} لا يتبع المشروع`);
      if (seen.has(dl.id)) throw new AppError('بند تسليم مكرر'); seen.add(dl.id);
      const other = await get(`SELECT c.no FROM client_certificate_lines cl JOIN client_certificates c ON c.id=cl.cert_id WHERE cl.delivery_line_id=? AND c.status='posted' ${id ? 'AND c.id<>?' : ''} LIMIT 1`, ...[dl.id, ...(id ? [id] : [])]);
      if (other) throw new AppError(`بند من الإذن ${dl.no} داخل بالفعل في المستخلص ${other.no}`);
      l.item_id = dl.item_id;
    }
    for (const a of p.adjustments || []) {
      const t = await get('SELECT * FROM deduction_types WHERE id=?', a.type_id);
      if (!t) throw new AppError('خصم/إضافة غير موجودة');
      if (!t.account_id) throw new AppError(`حدد الحساب المقابل لـ «${t.name}» في الإعدادات ← الخصومات والإضافات`);
    }
  },
  async post(doc, user, p) {
    for (const a of p.adjustments || []) {
      const t = await get('SELECT * FROM deduction_types WHERE id=?', a.type_id);
      // القيمة الافتراضية من الكود، ويقدر يعدّلها على المستخلص نفسه (نسبة أو رقم حسب طريقة الكود)
      const rate = a.rate === undefined || a.rate === null || a.rate === '' ? num(t.value) : num(a.rate);
      await insertRow('client_certificate_adjustments', { cert_id: doc.id, type_id: t.id, name: t.name, kind: t.kind, method: t.method, rate, amount: 0, account_id: t.account_id },
        ['cert_id', 'type_id', 'name', 'kind', 'method', 'rate', 'amount', 'account_id']);
    }
    await buildCertificate(doc.id);
  },
  async unpost(cur) { await deleteJournals('certificate', cur.id); await run('DELETE FROM client_certificate_adjustments WHERE cert_id=?', cur.id); },
  async enrich(h) {
    h.project_name = await val('SELECT name FROM projects WHERE id=?', h.project_id); h.client_name = await val('SELECT name FROM clients WHERE id=?', h.client_id);
    h.adjustments = await all('SELECT * FROM client_certificate_adjustments WHERE cert_id=? ORDER BY id', h.id);
    h.lines = await all(`SELECT cl.*, i.name item_name, n.no note_no, n.date note_date, u.name unit_name FROM client_certificate_lines cl JOIN delivery_note_lines dl ON dl.id=cl.delivery_line_id
      JOIN delivery_notes n ON n.id=dl.note_id LEFT JOIN project_items i ON i.id=cl.item_id LEFT JOIN units u ON u.id=i.unit_id WHERE cl.cert_id=? ORDER BY n.date, cl.id`, h.id);
  },
};
/** بنود التسليم المتاحة للمستخلص (مش داخلة في مستخلص تاني) */
export async function certifiableLines(projectId, { from, to, certId } = {}) {
  const w = []; const p = [projectId];
  if (from) { w.push('n.date>=?'); p.push(from); } if (to) { w.push('n.date<=?'); p.push(to); }
  return await all(`SELECT dl.id delivery_line_id, dl.item_id, i.name item_name, u.name unit_name, n.no note_no, n.date note_date, dl.qty, dl.unit_price, dl.amount
    FROM delivery_note_lines dl JOIN delivery_notes n ON n.id=dl.note_id JOIN project_items i ON i.id=dl.item_id LEFT JOIN units u ON u.id=i.unit_id
    WHERE n.project_id=? AND n.status='posted' ${w.length ? 'AND ' + w.join(' AND ') : ''}
      AND NOT EXISTS (SELECT 1 FROM client_certificate_lines cl JOIN client_certificates c ON c.id=cl.cert_id WHERE cl.delivery_line_id=dl.id AND c.status='posted' ${certId ? 'AND c.id<>' + Number(certId) : ''})
    ORDER BY n.date, dl.id`, ...p);
}

/** كميات الإنتاج التام: المطلوب (تعاقدي) / منتج في الشهر / منتج حتى الآن / مسلّم / مستخلص / رصيد المخزن */
export async function quantitiesReport(month, projectId = null) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const end = monthEnd(month); const w = projectId ? 'AND i.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const items = await all(`SELECT i.id item_id, i.name, i.qty contract_qty, i.area_m2, p.id project_id, p.name project_name, u.name unit_name, i.fg_material_id
    FROM project_items i JOIN projects p ON p.id=i.project_id LEFT JOIN units u ON u.id=i.unit_id
    WHERE i.active=1 AND (EXISTS (SELECT 1 FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id WHERE l.item_id=i.id AND d.status='posted' AND d.date<=?)) ${w} ORDER BY p.name, i.name`, end, ...pp);
  const wh = await fgWarehouse(); const out = [];
  for (const it of items) {
    const q = async (sql, ...a) => num(await val(sql, ...a));
    const inMonth = await q(`SELECT COALESCE(SUM(l.qty),0) FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id WHERE l.item_id=? AND d.status='posted' AND substr(d.date,1,7)=?`, it.item_id, month);
    const toDate = await q(`SELECT COALESCE(SUM(l.qty),0) FROM production_log_lines l JOIN production_logs d ON d.id=l.log_id WHERE l.item_id=? AND d.status='posted' AND d.date<=?`, it.item_id, end);
    const delivered = await q(`SELECT COALESCE(SUM(l.qty),0) FROM delivery_note_lines l JOIN delivery_notes d ON d.id=l.note_id WHERE l.item_id=? AND d.status='posted' AND d.date<=?`, it.item_id, end);
    const certified = await q(`SELECT COALESCE(SUM(cl.qty),0) FROM client_certificate_lines cl JOIN client_certificates c ON c.id=cl.cert_id WHERE cl.item_id=? AND c.status='posted' AND c.date<=?`, it.item_id, end);
    const stock = it.fg_material_id ? num((await stockAsOf(wh, it.fg_material_id, end)).qty) : 0;
    out.push({ ...it, in_month: r4(inMonth), meters_month: r4(inMonth * num(it.area_m2)), to_date: r4(toDate), delivered: r4(delivered), certified: r4(certified), stock: r4(stock), uncosted: r4(toDate - stock - delivered),
      remaining: it.contract_qty === null ? null : r4(num(it.contract_qty) - toDate) });
  }
  return out;
}
