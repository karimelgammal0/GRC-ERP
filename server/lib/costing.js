// ============================================================
//  موديول التكاليف — سعر المتر الشهري
//   تكلفة مرحلة (صب / تشطيب) في الشهر ÷ المتر المسطح المنتج = تكلفة المتر للمرحلة
//   المتر المنتج = عدد شكاير الأسمنت (معياري 50 كجم) المصروفة للصب × معدل فرد الشيكارة (يدوي ومتغير شهرياً)
//   مرحلة القوالب بتتحمّل على المشروع مباشرة ومش بتدخل في سعر المتر
// ============================================================
import { all, get, run, val, AppError, r2, r4, num } from '../db.js';
import { getSetting, setSetting } from './core.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CFG_KEYS = { cast: 'cost_stage_cast', finish: 'cost_stage_finish', mold: 'cost_stage_mold', cement: 'cost_cement_materials', kg: 'cost_cement_kg', basis: 'cost_basis', grg: 'cost_stage_grg', adds: 'cost_grg_additives' };
export const STD_BAG_KG = 50;   // الوحدة المعيارية: شيكارة 50 كجم
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
/** وزن وحدة الصنف بالكيلو: المحدد في الإعدادات، وإلا من الاسم (مثال «*30ك»)، وإلا 50 */
export const kgOf = (m, map = {}, def = STD_BAG_KG) => Number(map[m.id]) || Number(/(\d+(?:\.\d+)?)\s*ك(?:جم|ج)?/.exec(m.name || '')?.[1]) || def;
/** الوزن متخمّن (مش محدد في الإعدادات ولا مكتوب في الاسم) — لازم يتنبّه له المستخدم */
export const kgGuessed = (m, map = {}) => !Number(map[m.id]) && !/(\d+(?:\.\d+)?)\s*ك(?:جم|ج)?/.test(m.name || '');
// «اسمنت» بأي كتابة (اسمنت / أسمنت / إسمنت)
const NORM = (col) => `REPLACE(REPLACE(REPLACE(${col},'أ','ا'),'إ','ا'),'آ','ا')`;

/** ربط المراحل والمواد: من الإعدادات، وإلا بالاسم (صب / تشطيب / قوالب) */
export async function getConfig() {
  const stages = await all('SELECT id, name FROM stages WHERE active=1 AND parent_id IS NULL ORDER BY seq');
  const byName = (re) => stages.find((s) => re.test(s.name))?.id ?? null;
  const pick = async (k, d) => { const v = Number(await getSetting(CFG_KEYS[k])); return v || d || null; };
  return {
    cast_stage_id: await pick('cast', byName(/صب/)), finish_stage_id: await pick('finish', byName(/تشطيب/)), mold_stage_id: await pick('mold', byName(/قوالب|قالب/)),
    cement_material_ids: json(await getSetting(CFG_KEYS.cement), []).map(Number), cement_kg: json(await getSetting(CFG_KEYS.kg), {}),
    basis: json(await getSetting(CFG_KEYS.basis), {}),   // أصناف أساس المتر المنتج لغير GRC: { GRP: { ids, factor }, GRG: {...} }
    grg_stage_id: Number(await getSetting(CFG_KEYS.grg)) || (await all('SELECT id, name FROM stages WHERE active=1 ORDER BY seq')).find((x) => /grg/i.test(x.name) && !/تشطيب/.test(x.name))?.id || null,   // مرحلة صب GRG (المرحلة الوحيدة للنوع)
    grg_additives: json(await getSetting(CFG_KEYS.adds), []).map((a) => ({ material_id: Number(a.material_id), ratio: Number(a.ratio) })).filter((a) => a.material_id && a.ratio > 0),   // مواد مضافة لخلطة GRG: كمية لكل شيكارة جبس معيارية
  };
}
// ---------- أساس المتر المنتج لكل نوع منتج ----------
//  GRC: أسمنت (شيكارة معيارية 50 كجم) — GRP: بوليستر — GRG: جبس (Gypro وغيره) — المتر المنتج = كمية الأساس المصروفة للصب × معدل الفرد (يدوي شهري)
const BASIS = {
  GRC: { pats: ['اسمنت'], std: STD_BAG_KG, bagged: true, title: 'الأسمنت', qty_label: 'شكاير الأسمنت للصب (معيارية 50 كجم)', spread_label: 'معدل فرد الشيكارة', per_unit: 'م² / شيكارة', unit_short: 'شيكارة', per_col: 'معيار الشيكارة', lines_title: 'أسمنت الصب محوّل لشكاير 50 كجم', std_col: 'ما يعادل شكاير 50 كجم', factor_label: 'وزن الوحدة (كجم)' },
  GRP: { pats: ['بوليستر', 'polyester'], std: 1, divide: true, title: 'البوليستر', qty_label: 'كمية البوليستر للصب (كجم)', spread_label: 'معدل فرد البوليستر', per_unit: 'كجم / م²', unit_short: 'كجم', per_col: 'معيار الكجم', lines_title: 'بوليستر الصب (كجم)', std_col: 'ما يعادل كجم', factor_label: 'كجم لكل وحدة' },
  GRG: { pats: ['جبس', 'gypro', 'جيبرو', 'gypsum'], std: 25, bagged: true, title: 'الجبس', qty_label: 'كمية الجبس للصب (معيارية 25كجم)', spread_label: 'معدل فرد الجبس', per_unit: 'م² / شيكارة', unit_short: 'شيكارة', per_col: 'معيار الشيكارة', lines_title: 'جبس الصب محوّل لشكاير 25 كجم', std_col: 'ما يعادل شكاير 25 كجم', factor_label: 'وزن الوحدة (كجم)' },
};
export const basisOf = (kind) => BASIS[String(kind).toUpperCase()] || { pats: [], std: 1, title: kind, qty_label: `كمية أساس ${kind} للصب`, spread_label: `معدل فرد ${kind}`, per_unit: 'م² / وحدة', unit_short: 'وحدة', per_col: 'معيار الوحدة', lines_title: `أصناف أساس ${kind}`, std_col: 'الكمية المعيارية', factor_label: 'معامل الوحدة' };
const isCement = (kind) => String(kind).toUpperCase() === 'GRC';
const isBagged = (kind) => !!basisOf(kind).bagged;   // أساس بالشكاير المعيارية (أسمنت 50 كجم / جبس 25 كجم)
const basisCfg = (cfg, kind) => (isCement(kind) ? { ids: cfg.cement_material_ids, factor: cfg.cement_kg } : { ids: (cfg.basis?.[String(kind).toUpperCase()]?.ids || []).map(Number), factor: cfg.basis?.[String(kind).toUpperCase()]?.factor || {} });
/** كمية الوحدة بالكيلو (أسمنت: من الإعدادات/الاسم/50)، وغيره: المعامل المحدد وإلا 1 (الكمية بوحدة الصنف نفسها) */
const perUnitOf = (kind, m, factor) => (isBagged(kind) ? kgOf(m, factor, basisOf(kind).std) : (Number(factor[m.id]) || 1));
const patCond = (kind) => { const pats = basisOf(kind).pats; return { sql: pats.length ? `(${pats.map(() => `LOWER(${NORM('m.name')}) LIKE ?`).join(' OR ')})` : null, params: pats.map((p) => `%${p}%`) }; };
/** أصناف أساس المتر المرشحة لنوع: اللي اسمها مطابق + اللي اتضافت يدوياً، مع المعامل الحالي */
export async function basisCandidates(cfg, kind) {
  const bc = basisCfg(cfg, kind); const pc = patCond(kind);
  const byPat = pc.sql ? await all(`SELECT m.id, m.name FROM materials m WHERE m.active=1 AND ${pc.sql} ORDER BY m.name`, ...pc.params) : [];
  const extra = bc.ids.length ? await all(`SELECT m.id, m.name FROM materials m WHERE m.id IN (${bc.ids.map(() => '?').join(',')}) ORDER BY m.name`, ...bc.ids) : [];
  const seen = new Map(); for (const m of [...byPat, ...extra]) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((m) => ({ id: m.id, name: m.name, kg: perUnitOf(kind, m, bc.factor), kg_guessed: isBagged(kind) && kgGuessed(m, bc.factor), selected: !bc.ids.length || bc.ids.includes(m.id) }));
}
export const cementCandidates = (cfg) => basisCandidates(cfg, 'GRC');
export async function saveConfig(b) {
  for (const [k, f] of [['cast', 'cast_stage_id'], ['finish', 'finish_stage_id'], ['mold', 'mold_stage_id']]) {
    if (b[f] === undefined) continue; const v = b[f] === '' || b[f] === null ? null : Number(b[f]);
    if (v && !(await get('SELECT 1 FROM stages WHERE id=? AND parent_id IS NULL', v))) throw new AppError('اختيار غير موجود (لازم مرحلة رئيسية)');
    await setSetting(CFG_KEYS[k], v);
  }
  if (b.grg_stage_id !== undefined) {
    const v = b.grg_stage_id === '' || b.grg_stage_id === null ? null : Number(b.grg_stage_id);
    if (v && !(await get('SELECT 1 FROM stages WHERE id=?', v))) throw new AppError('مرحلة GRG غير موجودة');
    await setSetting(CFG_KEYS.grg, v);
  }
  if (b.grg_additives !== undefined) {
    const seen = new Set(); const list = [];
    for (const a of b.grg_additives || []) {
      const id = Number(a.material_id), ratio = Number(a.ratio); if (!id) continue;
      if (!(ratio > 0 && ratio <= 100000)) throw new AppError('معيار المادة المضافة لازم يكون أكبر من صفر');
      if (!(await get('SELECT 1 FROM materials WHERE id=?', id))) throw new AppError('صنف مضاف غير موجود');
      if (seen.has(id)) throw new AppError('الصنف المضاف متكرر'); seen.add(id); list.push({ material_id: id, ratio });
    }
    await setSetting(CFG_KEYS.adds, JSON.stringify(list));
  }
  if (b.cement_material_ids !== undefined) await setSetting(CFG_KEYS.cement, JSON.stringify((b.cement_material_ids || []).map(Number).filter(Boolean)));
  if (b.cement_kg !== undefined) {
    const map = {}; for (const [id, kg] of Object.entries(b.cement_kg || {})) { const n = Number(kg); if (!(n > 0 && n <= 1000)) throw new AppError('وزن الشيكارة غير صحيح'); map[Number(id)] = n; }
    await setSetting(CFG_KEYS.kg, JSON.stringify(map));
  }
  if (b.basis) {
    const kind = await kindOf(b.basis.kind); const key = kind.toUpperCase();
    const ids = [...new Set((b.basis.ids || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new AppError(`اختر صنف واحد على الأقل لأساس متر ${kind}`);
    const factor = {}; for (const [id, v] of Object.entries(b.basis.factor || {})) { const n = Number(v); if (!(n > 0 && n <= 1000)) throw new AppError(isBagged(kind) ? 'وزن الشيكارة غير صحيح' : 'معامل الوحدة غير صحيح'); factor[Number(id)] = n; }
    const pc = patCond(kind); const cand = pc.sql ? (await all(`SELECT m.id FROM materials m WHERE m.active=1 AND ${pc.sql}`, ...pc.params)).map((x) => Number(x.id)) : [];
    const finalIds = ids.length === cand.length && ids.every((i) => cand.includes(i)) ? [] : ids;   // كل المطابقين بالاسم بدون إضافات = تلقائي (أي صنف جديد بالاسم بيدخل لوحده)
    if (isCement(kind)) { await setSetting(CFG_KEYS.cement, JSON.stringify(finalIds)); await setSetting(CFG_KEYS.kg, JSON.stringify(factor)); }
    else { const cur = json(await getSetting(CFG_KEYS.basis), {}); cur[key] = { ids: finalIds, factor }; await setSetting(CFG_KEYS.basis, JSON.stringify(cur)); }
  }
  const c = await getConfig();
  const ids = [c.cast_stage_id, c.finish_stage_id, c.mold_stage_id].filter(Boolean);   // مرحلة GRG مستقلة عن الأدوار دي
  if (new Set(ids).size !== ids.length) throw new AppError('كل مرحلة لازم تتربط بدور مختلف (صب / تشطيب / قوالب)');
  return c;
}

/** أنواع المنتج التام المتاحة (من الإعدادات ← نوع المنتج التام) */
export const productKinds = async () => (await all('SELECT name FROM finished_types WHERE active=1 ORDER BY id')).map((x) => x.name);
/** يتحقق من النوع ويرجّع اسمه كما هو متكوّد؛ فاضي ← أول نوع نشط */
export const kindOf = async (k) => {
  const names = await productKinds(); const v = String(k || '').trim();
  if (!v) { if (!names.length) throw new AppError('كوّد نوع منتج تام واحد على الأقل من الإعدادات'); return names[0]; }
  const hit = names.find((n) => n.toUpperCase() === v.toUpperCase());
  if (!hit) throw new AppError(`نوع المنتج التام «${v}» غير متكوّد أو معطّل`); return hit;
};
/** مراحل نوع إنتاج تحت مرحلة رئيسية (صب/تشطيب): المراحل الفرعية اللي اسمها فيه GRC أو GRP؛ ولو مفيش فرعية للنوع GRC بنرجع للمرحلة الرئيسية نفسها (توافق مع البيانات القديمة) */
async function kindStageIds(parentId, kind) {
  if (!parentId) return [];
  const subs = await all(`SELECT id FROM stages WHERE parent_id=? AND active=1 AND UPPER(name) LIKE ?`, parentId, `%${String(kind).toUpperCase()}%`);
  if (subs.length) return subs.map((s) => s.id);
  return String(kind).toUpperCase() === 'GRC' ? [parentId] : [];
}

/** مراحل GRG: مرحلة «صب GRG» المربوطة (أو المطابقة بالاسم) + فروعها النشطة. النوع ده ملوش تشطيب */
async function grgStageIds(cfg) {
  if (!cfg.grg_stage_id) return [];
  const kids = await all('SELECT id FROM stages WHERE parent_id=? AND active=1', cfg.grg_stage_id);
  return [cfg.grg_stage_id, ...kids.map((k) => k.id)];
}
const isGRG = (kind) => String(kind).toUpperCase() === 'GRG';

/** المواد المضافة لخلطة GRG (معيار لكل شيكارة جبس معيارية):
 *  لو الصنف مصروف فعلاً لصب GRG بنستخدم الفعلي؛ لو مش موجود ضمن الصب بيتحسب تلقائياً (الكمية المعيارية × التكلفة)
 *  وبيتخصم من كميات/تكلفة الغير مباشرة لنفس الشهر عشان ما يتحسبش مرتين */
async function grgAdditives(cfg, month, bags, castBlock) {
  const lines = [];
  for (const a of cfg.grg_additives || []) {
    const m = await get('SELECT m.id, m.name, u.name unit FROM materials m LEFT JOIN units u ON u.id=m.unit_id WHERE m.id=?', a.material_id);
    if (!m) continue;
    const expected = r4(bags * a.ratio);
    const act = castBlock?.materials.find((x) => Number(x.material_id) === a.material_id);
    const issued = num(act?.qty), auto = !(issued > 0);
    const ind = await get(`SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(amount),0) a FROM cost_lines WHERE substr(date,1,7)=? AND material_id=? AND cost_type='material' AND cost_class='indirect'`, month, a.material_id);
    const indQ = num(ind?.q), indA = num(ind?.a);
    const stockAvg = num(await val('SELECT SUM(value)/NULLIF(SUM(qty),0) FROM material_stock WHERE material_id=? AND qty>0', a.material_id));
    const unitCost = indQ > 0 ? indA / indQ : stockAvg;
    const dq = auto ? Math.min(expected, Math.max(indQ, 0)) : 0;
    lines.push({ material_id: a.material_id, name: m.name, unit: m.unit || '', ratio: a.ratio, expected_qty: expected, issued_qty: r4(issued), auto,
      qty: auto ? expected : r4(issued), unit_cost: r4(unitCost), amount: auto ? r2(expected * unitCost) : r2(num(act?.amount)),
      deduct_qty: r4(dq), deduct_amount: auto && indQ > 0 ? r2(indA * dq / indQ) : 0 });
  }
  return { lines, auto_total: r2(lines.filter((l) => l.auto).reduce((t, l) => t + l.amount, 0)), deduct_total: r2(lines.reduce((t, l) => t + l.deduct_amount, 0)) };
}

/** أسطر تكلفة مرحلة في شهر مجمّعة: أصناف بالصنف + أجور يومية + مرتبات شهرية + مصروفات مباشرة */
async function stageBlock(stageId, ids, month, projectId) {
  if (!stageId || !ids.length) return null;
  const inS = ids.map(() => '?').join(',');
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const rows = await all(`SELECT c.cost_type, c.source_type, c.material_id, m.name mname, u.name unit, SUM(c.qty) qty, SUM(c.amount) amt
    FROM cost_lines c LEFT JOIN materials m ON m.id=c.material_id LEFT JOIN units u ON u.id=m.unit_id
    WHERE substr(c.date,1,7)=? AND c.stage_id IN (${inS}) AND c.cost_class<>'transfer'${pw}
    GROUP BY c.cost_type, c.source_type, c.material_id, m.name, u.name`, month, ...ids, ...pp);
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
  // بنحسب الشهر كله (كل المشروعات) الأول عشان نوزّع القيم اللي من غير مشروع، وبعدها لو طالب مشروع معين بنفلتر
  const rows = await all(`SELECT COALESCE(c.project_id,0) pid, p.name pname,
      SUM(CASE WHEN c.cost_type='material' THEN c.amount ELSE 0 END) mat, SUM(CASE WHEN c.cost_type='labor' THEN c.amount ELSE 0 END) lab,
      SUM(CASE WHEN c.cost_type='expense' THEN c.amount ELSE 0 END) exp, SUM(c.amount) total
    FROM cost_lines c LEFT JOIN projects p ON p.id=c.project_id
    WHERE substr(c.date,1,7)=? AND c.stage_id=? AND c.cost_class<>'transfer' GROUP BY COALESCE(c.project_id,0), p.name ORDER BY total DESC`, month, stageId);
  let list = rows.map((r) => ({ project_id: r.pid, name: r.pname || 'غير محدد', material: r2(r.mat), labor: r2(r.lab), expense: r2(r.exp), total: r2(r.total), direct: r2(r.total), allocated: 0 }));
  // تكلفة القوالب اللي من غير مشروع بتتوزع على باقي المشروعات بنسبة تكلفة قوالب كل مشروع من إجمالي القوالب المحمّلة على مشروعات في الشهر
  const un = list.find((r) => r.project_id === 0);
  const base = list.filter((r) => r.project_id !== 0 && r.direct > 0);
  const baseSum = r2(base.reduce((t, r) => t + r.direct, 0));
  if (un && base.length && baseSum > 0 && (un.material || un.labor || un.expense)) {
    for (const f of ['material', 'labor', 'expense']) {
      let left = un[f];
      base.forEach((r, i) => { const part = i === base.length - 1 ? left : r2(un[f] * r.direct / baseSum); r[f] = r2(r[f] + part); left = r2(left - part); r.allocated = r2(r.allocated + part); });
    }
    base.forEach((r) => { r.total = r2(r.total + r.allocated); });
    list = list.filter((r) => r.project_id !== 0);
  }
  const total = r2(list.reduce((t, r) => t + r.total, 0));
  const by_project = projectId ? list.filter((r) => r.project_id === Number(projectId)) : list;
  return { stage_id: stageId, name: await val('SELECT name FROM stages WHERE id=?', stageId), by_project, total: projectId ? r2(by_project.reduce((t, r) => t + r.total, 0)) : total, allocated_unassigned: !!(un && base.length && baseSum > 0) };
}

/** كمية أساس المتر (أسمنت/بوليستر/جبس حسب النوع) المصروفة للصب في الشهر محوّلة للوحدة المعيارية (أسمنت: شيكارة 50 كجم) */
async function systemBags(cfg, kind, castIds, month, projectId) {
  if (!castIds.length) return { lines: [], bags: 0 };
  const bc = basisCfg(cfg, kind); const bs = basisOf(kind); const pc = patCond(kind);
  let cond, cp;
  if (bc.ids.length) { cond = `m.id IN (${bc.ids.map(() => '?').join(',')})`; cp = bc.ids; } else if (pc.sql) { cond = pc.sql; cp = pc.params; } else return { lines: [], bags: 0 };
  const pw = projectId ? ' AND c.project_id=?' : ''; const pp = projectId ? [projectId] : [];
  const rows = await all(`SELECT m.id, m.name, SUM(c.qty) qty FROM cost_lines c JOIN materials m ON m.id=c.material_id
    WHERE substr(c.date,1,7)=? AND c.stage_id IN (${castIds.map(() => '?').join(',')}) AND c.cost_type='material' AND c.cost_class<>'transfer' AND ${cond}${pw}
    GROUP BY m.id, m.name ORDER BY m.name`, month, ...castIds, ...cp, ...pp);
  const lines = rows.map((r) => { const kg = perUnitOf(kind, r, bc.factor); return { material_id: r.id, name: r.name, qty: r4(r.qty), kg, kg_guessed: isBagged(kind) && kgGuessed(r, bc.factor), std_bags: r4(r.qty * kg / bs.std) }; });
  return { lines, bags: r4(lines.reduce((t, l) => t + l.std_bags, 0)) };
}

export const getPeriod = async (month, projectId, kind = '') => await get('SELECT * FROM unit_cost_periods WHERE month=? AND project_id=? AND kind=?', month, projectId || 0, await kindOf(kind));

/** الحساب الحي من أسطر التكلفة + المدخلات المحفوظة (معدل الفرد). لا يقرأ الـ snapshot */
export async function computeLive(month, projectId = 0, inputs = null, kind = '') {
  kind = await kindOf(kind);
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح (YYYY-MM)');
  const cfg = await getConfig(); const saved = await getPeriod(month, 0, kind);   // معدل الفرد والإعدادات شهرية واحدة لكل المشروعات
  const spread = num(inputs?.spread_rate ?? saved?.spread_rate);
  const grg = isGRG(kind);   // GRG: مرحلة واحدة فقط (صب GRG) بدون تشطيب
  const castIds = grg ? await grgStageIds(cfg) : await kindStageIds(cfg.cast_stage_id, kind), finishIds = grg ? [] : await kindStageIds(cfg.finish_stage_id, kind);
  const [cast, finish, mold] = [await stageBlock(grg ? cfg.grg_stage_id : cfg.cast_stage_id, castIds, month, projectId), grg ? null : await stageBlock(cfg.finish_stage_id, finishIds, month, projectId), await moldBlock(cfg.mold_stage_id, month, projectId)];
  const sys = await systemBags(cfg, kind, castIds, month, projectId);
  const bags = sys.bags;   // الشكاير دايماً من المنصرف بالنظام (مفيش إدخال يدوي)
  const bs = basisOf(kind);
  const area = bs.divide ? (spread > 0 ? r2(bags / spread) : 0) : r2(bags * spread);   // GRP: كمية البوليستر ÷ معدل الفرد (كجم/م²)؛ غيره: الكمية × المعدل (م²/شيكارة)
  let additives = null;
  if (grg && cast) {
    additives = await grgAdditives(cfg, month, bags, cast);
    cast.auto_additives = additives.auto_total; cast.total = r2(cast.total + additives.auto_total);   // المضاف تلقائياً بيدخل في تكلفة صب GRG
  }
  if (cast) for (const m of cast.materials) m.per_bag = bags > 0 ? r4(m.qty / bags) : null;   // معيار الشيكارة
  const per = (b) => (b && area > 0 ? r2(b.total / area) : null);
  if (cast) cast.per_m2 = per(cast); if (finish) finish.per_m2 = per(finish);
  const unit_cost = { cast: cast?.per_m2 ?? null, finish: finish?.per_m2 ?? null, total: area > 0 ? r2((cast?.total || 0) / area + (finish?.total || 0) / area) : null };
  return { month, kind, project_id: projectId || 0, config: cfg, stage_ids: { cast: castIds, finish: finishIds },
    inputs: { cement_lines: sys.lines, bags_system: sys.bags, bags, spread_rate: spread, area, basis: { ...basisOf(kind), pats: undefined } },
    cast, finish, mold, additives, unit_cost, pool_total: r2((cast?.total || 0) + (finish?.total || 0)) };
}

/** الشيت الكامل: المعتمد بيرجع من الـ snapshot (ثابت) + تنبيه لو الأرقام الحية اختلفت بعد الاعتماد */
export async function getSheet(month, projectId = 0, kind = '') {
  kind = await kindOf(kind);
  const saved = await getPeriod(month, 0, kind);
  const live = await computeLive(month, projectId, null, kind);
  if (projectId) return { ...live, status: saved?.status === 'approved' ? 'approved_view' : saved ? 'draft' : 'new', project_view: true };   // عرض تحليلي لمشروع بنفس معدل الشهر
  if (saved?.status === 'approved' && saved.snapshot) {
    const snap = JSON.parse(saved.snapshot);
    const drift = snap.unit_cost?.total !== live.unit_cost.total || snap.pool_total !== live.pool_total;
    return { ...snap, kind, status: 'approved', approved_at: saved.approved_at, drift, live_unit_cost: live.unit_cost, live_pool_total: live.pool_total, config: live.config };
  }
  return { ...live, status: saved ? 'draft' : 'new' };
}

export async function savePeriod(b, user) {
  const month = b.month, pid = 0, kind = await kindOf(b.kind);   // المدخلات شهرية فقط (مش لكل مشروع)
  if (!MONTH_RE.test(month || '')) throw new AppError('الشهر غير صحيح');
  const spread = b.spread_rate === '' || b.spread_rate === null || b.spread_rate === undefined ? 0 : Number(b.spread_rate);
  if (!(spread >= 0) || spread > 100) throw new AppError(`${basisOf(kind).spread_label} غير صحيح`);
  const cur = await getPeriod(month, pid, kind);
  if (cur?.status === 'approved') throw new AppError('الشهر معتمد — أعد فتحه أولاً لتعديل المدخلات');
  if (cur) await run('UPDATE unit_cost_periods SET spread_rate=? WHERE id=?', spread, cur.id);
  else await run('INSERT INTO unit_cost_periods(month,project_id,kind,spread_rate,created_by) VALUES(?,?,?,?,?)', month, pid, kind, spread, user?.id ?? null);
  return await getSheet(month, pid, kind);
}

export async function approvePeriod(month, projectId, user, kind = '') {
  kind = await kindOf(kind); const pid = 0; const cur = await getPeriod(month, pid, kind);
  if (!cur) throw new AppError(`احفظ ${basisOf(kind).spread_label} للشهر أولاً`);
  if (cur.status === 'approved') throw new AppError('الشهر معتمد بالفعل');
  const live = await computeLive(month, pid, null, kind);
  if (!(live.inputs.spread_rate > 0)) throw new AppError(`أدخل ${basisOf(kind).spread_label} قبل الاعتماد`);
  if (!(live.inputs.bags > 0)) throw new AppError(`لا توجد كميات ${isCement(kind) ? 'أسمنت' : basisOf(kind).title.replace(/^ال/, '')} مصروفة للصب في هذا الشهر — تأكد من أصناف الأساس في «ربط المراحل والمواد»`);
  if (isGRG(kind)) {
    if (!live.stage_ids.cast.length) throw new AppError('اربط مرحلة «صب GRG» من «ربط المراحل والمواد»');
  } else if (!live.config.cast_stage_id || !live.config.finish_stage_id) throw new AppError('اربط مرحلتي الصب والتشطيب من إعدادات التكاليف');
  if (!isGRG(kind) && (!live.stage_ids.cast.length || !live.stage_ids.finish.length)) throw new AppError(`مفيش مراحل فرعية لنوع ${kind} تحت الصب والتشطيب — اسم المرحلة الفرعية لازم يحتوي على ${kind}`);
  await run(`UPDATE unit_cost_periods SET status='approved', snapshot=?, approved_by=?, approved_at=to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') WHERE id=?`, JSON.stringify(live), user?.id ?? null, cur.id);
  return await getSheet(month, pid, kind);
}
export async function reopenPeriod(month, projectId, kind = '') {
  kind = await kindOf(kind); const pid = 0; const cur = await getPeriod(month, pid, kind);
  if (!cur || cur.status !== 'approved') throw new AppError('الشهر غير معتمد');
  const used = await get(`SELECT p.name FROM costing_runs r JOIN projects p ON p.id=r.project_id WHERE r.month=? AND r.status='approved' LIMIT 1`, month);
  if (used) throw new AppError(`تكلفة المنتج التام لمشروع «${used.name}» معتمدة على سعر المتر ده — أعد فتحها من «تكاليف مشروعات» أولاً`);
  await run(`UPDATE unit_cost_periods SET status='draft', snapshot=NULL, approved_by=NULL, approved_at=NULL WHERE id=?`, cur.id);
  return await getSheet(month, pid, kind);
}

/** سجل الأشهر المحفوظة: المعتمد من الـ snapshot، والمسودة بالحساب الحي */
export async function history({ from, to } = {}) {
  const rows = await all(`SELECT month, project_id, kind FROM unit_cost_periods WHERE (?::text IS NULL OR month>=?) AND (?::text IS NULL OR month<=?) AND project_id=0 ORDER BY month DESC, kind, project_id`, from || null, from || null, to || null, to || null);
  const out = [];
  for (const r of rows) {
    const s = await getSheet(r.month, r.project_id, r.kind);
    out.push({ month: s.month, kind: r.kind, project_id: s.project_id, project_name: s.project_id ? await val('SELECT name FROM projects WHERE id=?', s.project_id) : 'كل المشاريع', status: s.status,
      bags: s.inputs.bags, spread_rate: s.inputs.spread_rate, area: s.inputs.area, cast_total: s.cast?.total ?? 0, finish_total: s.finish?.total ?? 0,
      cast_per_m2: s.unit_cost.cast, finish_per_m2: s.unit_cost.finish, unit_cost: s.unit_cost.total, drift: !!s.drift });
  }
  return out;
}
