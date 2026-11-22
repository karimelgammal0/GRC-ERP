// ============================================================
//  موديول التكاليف — سعر المتر الشهري
//   تكلفة مرحلة (صب / تشطيب) في الشهر ÷ المتر المسطح المنتج = تكلفة المتر للمرحلة
//   المتر المنتج = عدد شكاير الأسمنت المصروفة للصب × معدل فرد الشيكارة (يدوي ومتغير شهرياً)
//   مرحلة القوالب بتتحمّل على المشروع مباشرة ومش بتدخل في سعر المتر
// ============================================================
import { all, get, run, val, AppError, r2, r4, num } from '../db.js';
import { getSetting, setSetting } from './core.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CFG_KEYS = { cast: 'cost_stage_cast', finish: 'cost_stage_finish', mold: 'cost_stage_mold', cement: 'cost_cement_material_id' };

/** ربط المراحل والأسمنت: من الإعدادات، وإلا بالاسم (صب / تشطيب / قوالب) */
export async function getConfig() {
  const stages = await all('SELECT id, name FROM stages WHERE active=1 ORDER BY seq');
  const byName = (re) => stages.find((s) => re.test(s.name))?.id ?? null;
  const pick = async (k, d) => { const v = Number(await getSetting(CFG_KEYS[k])); return v || d || null; };
  return {
    cast_stage_id: await pick('cast', byName(/صب/)), finish_stage_id: await pick('finish', byName(/تشطيب/)), mold_stage_id: await pick('mold', byName(/قوالب|قالب/)),
    cement_material_id: await pick('cement', null),
  };
}
export async function saveConfig(b) {
  for (const [k, f] of [['cast', 'cast_stage_id'], ['finish', 'finish_stage_id'], ['mold', 'mold_stage_id'], ['cement', 'cement_material_id']]) {
    if (b[f] === undefined) continue; const v = b[f] === '' || b[f] === null ? null : Number(b[f]);
    if (v && !(await get(k === 'cement' ? 'SELECT 1 FROM materials WHERE id=?' : 'SELECT 1 FROM stages WHERE id=?', v))) throw new AppError('اختيار غير موجود');
    await setSetting(CFG_KEYS[k], v);
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

/** شكاير الأسمنت المصروفة لمرحلة الصب في الشهر (من النظام). لو الخامة مش متحددة بنختار أكبر خامة «اسمنت» صرفاً */
async function systemBags(cast, month, projectId, cementId) {
  if (!cast) return { material_id: cementId || null, bags: 0 };
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  let mid = cementId;
  if (!mid) mid = (await get(`SELECT c.material_id id FROM cost_lines c JOIN materials m ON m.id=c.material_id
      WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.cost_type='material' AND m.name LIKE '%اسمنت%'${pw} GROUP BY c.material_id ORDER BY SUM(c.qty) DESC LIMIT 1`, month, cast, ...pp))?.id || null;
  if (!mid) return { material_id: null, bags: 0 };
  const bags = await val(`SELECT COALESCE(SUM(c.qty),0) FROM cost_lines c WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.material_id=? AND c.cost_type='material' AND c.cost_class<>'transfer'${pw}`, month, cast, mid, ...pp);
  return { material_id: mid, bags: r4(bags) };
}

const keyOf = (month, projectId) => [month, projectId || 0];
export const getPeriod = async (month, projectId) => await get('SELECT * FROM unit_cost_periods WHERE month=? AND project_id=?', ...keyOf(month, projectId));

/** الحساب الحي من أسطر التكلفة + المدخلات المحفوظة (معدل الفرد). لا يقرأ الـ snapshot */
export async function computeLive(month, projectId = 0, inputs = null) {
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const cfg = await getConfig(); const saved = await getPeriod(month, projectId);
  const spread = num(inputs?.spread_rate ?? saved?.spread_rate);
  const override = inputs && 'bags_override' in inputs ? inputs.bags_override : saved?.bags_override;
  const cementId = Number(inputs?.cement_material_id ?? saved?.cement_material_id ?? cfg.cement_material_id) || null;
  const [cast, finish, mold] = [await stageBlock(cfg.cast_stage_id, month, projectId), await stageBlock(cfg.finish_stage_id, month, projectId), await moldBlock(cfg.mold_stage_id, month, projectId)];
  const sys = await systemBags(cfg.cast_stage_id, month, projectId, cementId);
  const bags = override !== null && override !== undefined && override !== '' ? num(override) : sys.bags;
  const area = r2(bags * spread);
  if (cast) for (const m of cast.materials) m.per_bag = bags > 0 ? r4(m.qty / bags) : null;   // معيار الشيكارة
  const per = (b) => (b && area > 0 ? r2(b.total / area) : null);
  if (cast) cast.per_m2 = per(cast); if (finish) finish.per_m2 = per(finish);
  const unit_cost = { cast: cast?.per_m2 ?? null, finish: finish?.per_m2 ?? null, total: area > 0 ? r2((cast?.total || 0) / area + (finish?.total || 0) / area) : null };
  return { month, project_id: projectId || 0, config: cfg,
    inputs: { cement_material_id: sys.material_id, bags_system: sys.bags, bags_override: override === '' ? null : override ?? null, bags, spread_rate: spread, area },
    cast, finish, mold, unit_cost, pool_total: r2((cast?.total || 0) + (finish?.total || 0)), notes: saved?.notes ?? null };
}

/** الشيت الكامل: المعتمد بيرجع من الـ snapshot (ثابت) + تنبيه لو الأرقام الحية اختلفت بعد الاعتماد */
export async function getSheet(month, projectId = 0) {
  const saved = await getPeriod(month, projectId);
  const live = await computeLive(month, projectId);
  if (saved?.status === 'approved' && saved.snapshot) {
    const snap = JSON.parse(saved.snapshot);
    const drift = snap.unit_cost?.total !== live.unit_cost.total || snap.pool_total !== live.pool_total;
    return { ...snap, status: 'approved', approved_at: saved.approved_at, drift, live_unit_cost: live.unit_cost, live_pool_total: live.pool_total, config: live.config };
  }
  return { ...live, status: saved ? 'draft' : 'new' };
}

export async function savePeriod(b, user) {
  const month = b.month, pid = Number(b.project_id) || 0;
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح');
  const spread = b.spread_rate === '' || b.spread_rate === null || b.spread_rate === undefined ? 0 : Number(b.spread_rate);
  if (!(spread >= 0) || spread > 100) throw new AppError('معدل فرد الشيكارة غير صحيح');
  const bo = b.bags_override === '' || b.bags_override === null || b.bags_override === undefined ? null : Number(b.bags_override);
  if (bo !== null && !(bo >= 0)) throw new AppError('عدد الشكاير غير صحيح');
  if (pid && !(await get('SELECT 1 FROM projects WHERE id=?', pid))) throw new AppError('المشروع غير موجود');
  const cement = b.cement_material_id ? Number(b.cement_material_id) : null;
  const cur = await getPeriod(month, pid);
  if (cur?.status === 'approved') throw new AppError('الشهر معتمد — أعد فتحه أولاً لتعديل المدخلات');
  if (cur) await run('UPDATE unit_cost_periods SET spread_rate=?, bags_override=?, cement_material_id=?, notes=? WHERE id=?', spread, bo, cement, b.notes ?? null, cur.id);
  else await run('INSERT INTO unit_cost_periods(month,project_id,spread_rate,bags_override,cement_material_id,notes,created_by) VALUES(?,?,?,?,?,?,?)', month, pid, spread, bo, cement, b.notes ?? null, user?.id ?? null);
  return await getSheet(month, pid);
}

export async function approvePeriod(month, projectId, user) {
  const pid = Number(projectId) || 0; const cur = await getPeriod(month, pid);
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
  const pid = Number(projectId) || 0; const cur = await getPeriod(month, pid);
  if (!cur || cur.status !== 'approved') throw new AppError('الشهر غير معتمد');
  await run(`UPDATE unit_cost_periods SET status='draft', snapshot=NULL, approved_by=NULL, approved_at=NULL WHERE id=?`, cur.id);
  return await getSheet(month, pid);
}

/** سجل الأشهر المحفوظة: المعتمد من الـ snapshot، والمسودة بالحساب الحي */
export async function history({ from, to, project_id } = {}) {
  const rows = await all(`SELECT month, project_id FROM unit_cost_periods WHERE (?::text IS NULL OR month>=?) AND (?::text IS NULL OR month<=?) AND (?::int IS NULL OR project_id=?) ORDER BY month DESC, project_id`, from || null, from || null, to || null, to || null, project_id === undefined || project_id === '' ? null : Number(project_id), project_id === undefined || project_id === '' ? null : Number(project_id));
  const out = [];
  for (const r of rows) {
    const s = await getSheet(r.month, r.project_id);
    out.push({ month: s.month, project_id: s.project_id, project_name: s.project_id ? await val('SELECT name FROM projects WHERE id=?', s.project_id) : 'كل المشاريع', status: s.status,
      bags: s.inputs.bags, spread_rate: s.inputs.spread_rate, area: s.inputs.area, cast_total: s.cast?.total ?? 0, finish_total: s.finish?.total ?? 0,
      cast_per_m2: s.unit_cost.cast, finish_per_m2: s.unit_cost.finish, unit_cost: s.unit_cost.total, mold_total: s.mold?.total ?? 0, drift: !!s.drift });
  }
  return out;
}
