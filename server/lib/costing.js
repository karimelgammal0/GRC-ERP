// ============================================================
//  موديول التكاليف — سعر المتر الشهري
//   تكلفة مرحلة (صب / تشطيب) في الشهر ÷ المتر المسطح المنتج = تكلفة المتر للمرحلة
//   المتر المنتج = عدد شكاير الأسمنت (معياري 50 كجم) المصروفة للصب × معدل فرد الشيكارة (يدوي ومتغير شهرياً)
//   مرحلة القوالب بتتحمّل على المشروع مباشرة ومش بتدخل في سعر المتر
// ============================================================
import { all, get, run, val, AppError, r2, r4, num } from '../db.js';
import { getSetting, setSetting } from './core.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CFG_KEYS = { cast: 'cost_stage_cast', finish: 'cost_stage_finish', mold: 'cost_stage_mold', cement: 'cost_cement_materials', kg: 'cost_cement_kg' };
export const STD_BAG_KG = 50;   // الوحدة المعيارية: شيكارة 50 كجم
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
/** وزن وحدة الصنف بالكيلو: المحدد في الإعدادات، وإلا من الاسم (مثال «*30ك»)، وإلا 50 */
export const kgOf = (m, map = {}) => Number(map[m.id]) || Number(/(\d+(?:\.\d+)?)\s*ك(?:جم|ج)?/.exec(m.name || '')?.[1]) || STD_BAG_KG;

/** ربط المراحل والأسمنت: من الإعدادات، وإلا بالاسم (صب / تشطيب / قوالب) */
export async function getConfig() {
  const stages = await all('SELECT id, name FROM stages WHERE active=1 ORDER BY seq');
  const byName = (re) => stages.find((s) => re.test(s.name))?.id ?? null;
  const pick = async (k, d) => { const v = Number(await getSetting(CFG_KEYS[k])); return v || d || null; };
  return {
    cast_stage_id: await pick('cast', byName(/صب/)), finish_stage_id: await pick('finish', byName(/تشطيب/)), mold_stage_id: await pick('mold', byName(/قوالب|قالب/)),
    cement_material_ids: json(await getSetting(CFG_KEYS.cement), []).map(Number), cement_kg: json(await getSetting(CFG_KEYS.kg), {}),
  };
}
/** أصناف الأسمنت المرشحة (الاسم فيه «اسمنت») مع الوزن الحالي لكل وحدة */
export async function cementCandidates(cfg) {
  const rows = await all(`SELECT id, name FROM materials WHERE name LIKE '%اسمنت%' AND active=1 ORDER BY name`);
  return rows.map((m) => ({ id: m.id, name: m.name, kg: kgOf(m, cfg.cement_kg), selected: !cfg.cement_material_ids.length || cfg.cement_material_ids.includes(m.id) }));
}
export async function saveConfig(b) {
  for (const [k, f] of [['cast', 'cast_stage_id'], ['finish', 'finish_stage_id'], ['mold', 'mold_stage_id']]) {
    if (b[f] === undefined) continue; const v = b[f] === '' || b[f] === null ? null : Number(b[f]);
    if (v && !(await get('SELECT 1 FROM stages WHERE id=?', v))) throw new AppError('اختيار غير موجود');
    await setSetting(CFG_KEYS[k], v);
  }
  if (b.cement_material_ids !== undefined) await setSetting(CFG_KEYS.cement, JSON.stringify((b.cement_material_ids || []).map(Number).filter(Boolean)));
  if (b.cement_kg !== undefined) {
    const map = {}; for (const [id, kg] of Object.entries(b.cement_kg || {})) { const n = Number(kg); if (!(n > 0 && n <= 1000)) throw new AppError('وزن الشيكارة غير صحيح'); map[Number(id)] = n; }
    await setSetting(CFG_KEYS.kg, JSON.stringify(map));
  }
  const c = await getConfig();
  const ids = [c.cast_stage_id, c.finish_stage_id, c.mold_stage_id].filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new AppError('كل مرحلة لازم تتربط بدور مختلف (صب / تشطيب / قوالب)');
  return c;
}

/** أسطر تكلفة مرحلة في شهر مجمّعة: خامات بالصنف + أجور يومية + مرتبات شهرية + مصروفات مباشرة */
async function stageBlock(stageId, month, projectId) {
  if (!stageId) return null;
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const rows = await all(`SELECT c.cost_type, c.source_type, c.material_id, m.name mname, u.name unit, SUM(c.qty) qty, SUM(c.amount) amt
    FROM cost_lines c LEFT JOIN materials m ON m.id=c.material_id LEFT JOIN units u ON u.id=m.unit_id
    WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.cost_class<>'transfer'${pw}
    GROUP BY c.cost_type, c.source_type, c.material_id, m.name, u.name`, month, stageId, ...pp);
  const mats = rows.filter((r) => r.cost_type === 'material').map((r) => ({ material_id: r.material_id, name: r.mname || 'غير محدد', unit: r.unit || '', qty: r4(r.qty), amount: r2(r.amt) })).sort((a, b) => b.amount - a.amount);
  const sum = (f) => r2(rows.filter(f).reduce((s, r) => s + num(r.amt), 0));
  const b = { stage_id: stageId, name: await val('SELECT name FROM stages WHERE id=?', stageId), materials: mats,
    mat_total: sum((r) => r.cost_type === 'material'), labor_daily: sum((r) => r.cost_type === 'labor' && r.source_type !== 'payroll'),
    labor_monthly: sum((r) => r.cost_type === 'labor' && r.source_type === 'payroll'), expense: sum((r) => r.cost_type === 'expense') };
  b.total = r2(b.mat_total + b.labor_daily + b.labor_monthly + b.expense);
  return b;
}

async function moldBlock(stageId, month, projectId) {
  if (!stageId) return null;
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const rows = await all(`SELECT COALESCE(c.project_id,0) pid, p.name pname,
      SUM(CASE WHEN c.cost_type='material' THEN c.amount ELSE 0 END) mat, SUM(CASE WHEN c.cost_type='labor' THEN c.amount ELSE 0 END) lab,
      SUM(CASE WHEN c.cost_type='expense' THEN c.amount ELSE 0 END) exp, SUM(c.amount) total
    FROM cost_lines c LEFT JOIN projects p ON p.id=c.project_id
    WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.cost_class<>'transfer'${pw} GROUP BY COALESCE(c.project_id,0), p.name ORDER BY total DESC`, month, stageId, ...pp);
  const by_project = rows.map((r) => ({ project_id: r.pid, name: r.pname || 'غير محدد', material: r2(r.mat), labor: r2(r.lab), expense: r2(r.exp), total: r2(r.total) }));
  return { stage_id: stageId, name: await val('SELECT name FROM stages WHERE id=?', stageId), by_project, total: r2(by_project.reduce((s, r) => s + r.total, 0)) };
}

/** شكاير الأسمنت المصروفة للصب في الشهر محوّلة لشكاير معيارية 50 كجم (الأصناف 30 كجم وغيرها بتتحول بالوزن) */
async function systemBags(cfg, month, projectId) {
  if (!cfg.cast_stage_id) return { lines: [], bags: 0 };
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const ids = cfg.cement_material_ids; const iw = ids.length ? ` AND c.material_id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = await all(`SELECT m.id, m.name, SUM(c.qty) qty FROM cost_lines c JOIN materials m ON m.id=c.material_id
    WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.cost_type='material' AND c.cost_class<>'transfer' AND m.name LIKE '%اسمنت%'${iw}${pw}
    GROUP BY m.id, m.name ORDER BY m.name`, month, cfg.cast_stage_id, ...ids, ...pp);
  const lines = rows.map((r) => { const kg = kgOf(r, cfg.cement_kg); return { material_id: r.id, name: r.name, qty: r4(r.qty), kg, std_bags: r4(r.qty * kg / STD_BAG_KG) }; });
  return { lines, bags: r4(lines.reduce((t, l) => t + l.std_bags, 0)) };
}

const keyOf = (month, projectId) => [month, projectId || 0];
export const getPeriod = async (month, projectId) => await get('SELECT * FROM unit_cost_periods WHERE month=? AND project_id=?', ...keyOf(month, projectId));

/** الحساب الحي من أسطر التكلفة + المدخلات المحفوظة (معدل الفرد). لا يقرأ الـ snapshot */
export async function computeLive(month, projectId = 0, inputs = null) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const cfg = await getConfig(); const saved = await getPeriod(month, 0);   // معدل الفرد والإعدادات شهرية واحدة لكل المشروعات
  const spread = num(inputs?.spread_rate ?? saved?.spread_rate);
  const [cast, finish, mold] = [await stageBlock(cfg.cast_stage_id, month, projectId), await stageBlock(cfg.finish_stage_id, month, projectId), await moldBlock(cfg.mold_stage_id, month, projectId)];
  const sys = await systemBags(cfg, month, projectId);
  const bags = sys.bags;   // الشكاير دايماً من المنصرف بالنظام (مفيش إدخال يدوي)
  const area = r2(bags * spread);
  if (cast) for (const m of cast.materials) m.per_bag = bags > 0 ? r4(m.qty / bags) : null;   // معيار الشيكارة
  const per = (b) => (b && area > 0 ? r2(b.total / area) : null);
  if (cast) cast.per_m2 = per(cast); if (finish) finish.per_m2 = per(finish);
  const unit_cost = { cast: cast?.per_m2 ?? null, finish: finish?.per_m2 ?? null, total: area > 0 ? r2((cast?.total || 0) / area + (finish?.total || 0) / area) : null };
  return { month, project_id: projectId || 0, config: cfg,
    inputs: { cement_lines: sys.lines, bags_system: sys.bags, bags, spread_rate: spread, area },
    cast, finish, mold, unit_cost, pool_total: r2((cast?.total || 0) + (finish?.total || 0)), notes: saved?.notes ?? null };
}

/** الشيت الكامل: المعتمد بيرجع من الـ snapshot (ثابت) + تنبيه لو الأرقام الحية اختلفت بعد الاعتماد */
export async function getSheet(month, projectId = 0) {
  const saved = await getPeriod(month, 0);
  const live = await computeLive(month, projectId);
  if (projectId) return { ...live, status: saved?.status === 'approved' ? 'approved_view' : saved ? 'draft' : 'new', project_view: true };   // عرض تحليلي لمشروع بنفس معدل الشهر
  if (saved?.status === 'approved' && saved.snapshot) {
    const snap = JSON.parse(saved.snapshot);
    const drift = snap.unit_cost?.total !== live.unit_cost.total || snap.pool_total !== live.pool_total;
    return { ...snap, status: 'approved', approved_at: saved.approved_at, drift, live_unit_cost: live.unit_cost, live_pool_total: live.pool_total, config: live.config };
  }
  return { ...live, status: saved ? 'draft' : 'new' };
}

export async function savePeriod(b, user) {
  const month = b.month, pid = 0;   // المدخلات شهرية فقط (مش لكل مشروع)
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح');
  const spread = b.spread_rate === '' || b.spread_rate === null || b.spread_rate === undefined ? 0 : Number(b.spread_rate);
  if (!(spread >= 0) || spread > 100) throw new AppError('معدل فرد الشيكارة غير صحيح');
  const cur = await getPeriod(month, pid);
  if (cur?.status === 'approved') throw new AppError('الشهر معتمد — أعد فتحه أولاً لتعديل المدخلات');
  if (cur) await run('UPDATE unit_cost_periods SET spread_rate=?, notes=? WHERE id=?', spread, b.notes ?? null, cur.id);
  else await run('INSERT INTO unit_cost_periods(month,project_id,spread_rate,notes,created_by) VALUES(?,?,?,?,?)', month, pid, spread, b.notes ?? null, user?.id ?? null);
  return await getSheet(month, pid);
}

export async function approvePeriod(month, projectId, user) {
  const pid = 0; const cur = await getPeriod(month, pid);
  if (!cur) throw new AppError('احفظ معدل فرد الشيكارة للشهر أولاً');
  if (cur.status === 'approved') throw new AppError('الشهر معتمد بالفعل');
  const live = await computeLive(month, pid);
  if (!(live.inputs.spread_rate > 0)) throw new AppError('أدخل معدل فرد الشيكارة قبل الاعتماد');
  if (!(live.inputs.bags > 0)) throw new AppError('لا توجد شكاير أسمنت مصروفة للصب في هذا الشهر — تأكد من خامة الأسمنت أو أدخل العدد يدوياً');
  if (!live.config.cast_stage_id || !live.config.finish_stage_id) throw new AppError('اربط مرحلتي الصب والتشطيب من إعدادات التكاليف');
  await run(`UPDATE unit_cost_periods SET status='approved', snapshot=?, approved_by=?, approved_at=to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, JSON.stringify(live), user?.id ?? null, cur.id);
  return await getSheet(month, pid);
}
export async function reopenPeriod(month, projectId) {
  const pid = 0; const cur = await getPeriod(month, pid);
  if (!cur || cur.status !== 'approved') throw new AppError('الشهر غير معتمد');
  await run(`UPDATE unit_cost_periods SET status='draft', snapshot=NULL, approved_by=NULL, approved_at=NULL WHERE id=?`, cur.id);
  return await getSheet(month, pid);
}

/** سجل الأشهر المحفوظة: المعتمد من الـ snapshot، والمسودة بالحساب الحي */
export async function history({ from, to } = {}) {
  const rows = await all(`SELECT month, project_id FROM unit_cost_periods WHERE (?::text IS NULL OR month>=?) AND (?::text IS NULL OR month<=?) AND project_id=0 ORDER BY month DESC, project_id`, from || null, from || null, to || null, to || null);
  const out = [];
  for (const r of rows) {
    const s = await getSheet(r.month, r.project_id);
    out.push({ month: s.month, project_id: s.project_id, project_name: s.project_id ? await val('SELECT name FROM projects WHERE id=?', s.project_id) : 'كل المشاريع', status: s.status,
      bags: s.inputs.bags, spread_rate: s.inputs.spread_rate, area: s.inputs.area, cast_total: s.cast?.total ?? 0, finish_total: s.finish?.total ?? 0,
      cast_per_m2: s.unit_cost.cast, finish_per_m2: s.unit_cost.finish, unit_cost: s.unit_cost.total, mold_total: s.mold?.total ?? 0, drift: !!s.drift });
  }
  return out;
}
