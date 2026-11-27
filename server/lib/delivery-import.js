// ============================================================
//  استيراد تسليمات ٣ مشروعات من شيتات الأذون (مرة واحدة، وممكن تتكرر بأمان):
//   ١) بنود المشروع: اللي مش موجود (بنفس الاسم) في المشروع بيتضاف، واللي موجود مبيتكررش
//   ٢) مخزن الإنتاج التام (رصيد افتتاحي): كمية المسلَّم قبل ١٥/١١ — بدون تكلفة (القيمة المدخلة بتتحفظ زي ما هي)
//   ٣) أذون التسليم (كل الأذون) بتتسجل بتاريخ الإذن؛ أي إذن اتسجل قبل كده بيتخطى
// ملحوظة: بيتشغّل تلقائياً مرة واحدة عند تشغيل السيرفر (server/index.js) — مفيش زرار.
// ============================================================
import { readFileSync } from 'node:fs';
import { all, get, run, val, insertRow, AppError, num } from '../db.js';
import { nextNo, getSetting, setSetting } from './core.js';
import './phase3.js';   // بيسجّل DOCS.delivery_note
import { applyOpening, openingLocked } from './opening.js';
import { saveDoc } from './docs.js';

const SEED = JSON.parse(readFileSync(new URL('../seeds/delivery-seed.json', import.meta.url), 'utf8'));
export const CUTOFF = '2026-11-15';
const norm = (s) => String(s ?? '').replace(/[ةه]/g, 'ه').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
// كلمات تعرّف مشروع كل شيت في قاعدة البيانات
const KEYS = { 'مدرسه انطونيادس': ['انطونيادس'], 'ميادين طريق السويس': ['السويس', 'التوابل'], 'الشلالات': ['الشلالات'] };

async function findProject(sheetName) {
  const kws = (KEYS[sheetName] || [sheetName]).map(norm);
  const all_ = await all('SELECT id, code, name, client_id FROM projects');
  const hits = all_.filter((p) => kws.some((k) => norm(p.name).includes(k)));
  if (hits.length === 1) return hits[0];
  throw new AppError(hits.length ? `أكتر من مشروع بيطابق «${sheetName}»: ${hits.map((h) => h.name).join('، ')}` : `مشروع «${sheetName}» غير موجود في قاعدة البيانات (الكلمات: ${kws.join('، ')})`);
}

const SITE_NAME = { 'ميادين طريق السويس': 'التوابل عام' };   // الموقع المحدد لو المشروع له أكتر من موقع
async function siteFor(project, sheetName) {
  const sites = await all('SELECT id, name FROM sites WHERE project_id=? AND active=1 ORDER BY id', project.id);
  if (!sites.length) return null;
  if (sites.length === 1) return sites[0].id;
  const exact = SITE_NAME[sheetName] && sites.filter((x) => norm(x.name) === norm(SITE_NAME[sheetName]));
  if (exact?.length === 1) return exact[0].id;
  const kws = (KEYS[sheetName] || []).map(norm);
  const hit = sites.filter((s) => kws.some((k) => norm(s.name).includes(k)));
  if (hit.length === 1) return hit[0].id;
  throw new AppError(`المشروع له ${sites.length} مواقع ولم يتحدد الموقع تلقائياً: ${sites.map((s) => s.name).join('، ')}`);
}

export async function importDeliveries(user, { upTo = CUTOFF } = {}) {   // upTo: أذون التاريخ الأقل منه بس
  if (await openingLocked()) throw new AppError('الأرصدة الافتتاحية مقفلة — فك القفل الأول ثم أعد الاستيراد');
  const report = { projects: [], opening_date: null, applied: null, notes_created: 0, notes_skipped: 0, failed: [] };
  const units = await all('SELECT id, name FROM units'); const unitOf = (n) => units.find((u) => norm(u.name) === norm(n))?.id || null;
  const kinds = (await all('SELECT name FROM finished_types WHERE active=1')).map((k) => k.name);
  const kindOf = (name) => (/g\.?\s?r\.?\s?p/i.test(name) && kinds.includes('GRP')) ? 'GRP' : (kinds.includes('GRC') ? 'GRC' : (kinds[0] || 'GRC'));

  // --- ٠) تحقق من كل المشروعات قبل أي كتابة: لو أي مشروع مش متطابق/مش مربوط بعميل بنوقف من غير ما نغيّر حاجة ---
  const resolved = []; const errs = [];
  for (const sp of SEED) {
    try {
      const prj = await findProject(sp.project);
      if (!prj.client_id && !(await val('SELECT client_id FROM projects WHERE id=?', prj.id))) throw new AppError(`المشروع «${prj.name}» مش مربوط بعميل — حدد العميل في الإعدادات ← المشروعات`);
      resolved.push({ sp, prj, site_id: await siteFor(prj, sp.project) });
    } catch (e) { if (!(e instanceof AppError)) throw e; errs.push(`${sp.project}: ${e.message}`); }
  }
  if (errs.length) { report.aborted = true; report.errors = errs; report.projects = SEED.map((s) => ({ sheet: s.project, error: errs.find((x) => x.startsWith(s.project + ':')) || null })); return report; }

  // --- ١) البنود + رصيد المنتج التام الافتتاحي ---
  const prepared = [];
  for (const { sp, prj, site_id } of resolved) {
    const info = { sheet: sp.project, project: null, items_added: 0, items_existing: 0, error: null };
    report.projects.push(info);
    try {
      info.project = prj.name;
      const existing = await all('SELECT id, name FROM project_items WHERE project_id=?', prj.id);
      const byName = new Map(existing.map((i) => [norm(i.name), i.id]));
      const idOf = new Map(); const preQty = new Map();
      for (const it of sp.items) {
        let id = byName.get(norm(it.name));
        if (id) info.items_existing++;
        else {
          id = await insertRow('project_items', { code: await nextNo('project_item'), name: it.name, project_id: prj.id, unit_id: unitOf(it.unit), kind: kindOf(it.name) }, ['code', 'name', 'project_id', 'unit_id', 'kind']);
          byName.set(norm(it.name), id); info.items_added++;
        }
        idOf.set(norm(it.name), id);
        preQty.set(id, (preQty.get(id) || 0) + it.pre);
      }
      for (const [id, q] of preQty) {
        if (!(q > 0)) continue;
        const cur = await get('SELECT value FROM opening_fg_stock WHERE item_id=?', id);
        if (cur) await run('UPDATE opening_fg_stock SET qty=? WHERE item_id=?', q, id);   // القيمة اللي أدخلها المستخدم تفضل زي ما هي
        else await run('INSERT INTO opening_fg_stock(item_id, qty, value, note) VALUES(?,?,0,?)', id, q, 'مسلَّم قبل 15/11 (استيراد)');
      }
      prepared.push({ sp: { ...sp, notes: sp.notes.filter((n) => n.date < upTo) }, prj, site_id, idOf });
    } catch (e) { if (!(e instanceof AppError)) throw e; info.error = e.message; }
  }

  // --- ٢) تاريخ الافتتاح لازم يسبق أقدم إذن، وبعدين تطبيق الأرصدة ---
  const earliest = prepared.flatMap((p) => p.sp.notes.map((n) => n.date)).sort()[0];
  const od = await getSetting('opening_date');
  if (earliest && (!od || od > earliest)) { await setSetting('opening_date', earliest); report.opening_date = `اتغيّر من ${od || '—'} إلى ${earliest} (لازم يسبق أقدم إذن تسليم)`; }
  report.applied = await applyOpening(user);

  // --- ٣) أذون التسليم ---
  for (const { sp, prj, site_id, idOf } of prepared) {
    for (const n of sp.notes) {
      if (await get(`SELECT 1 FROM delivery_notes WHERE project_id=? AND manual_no=? AND date=? AND status<>'void'`, prj.id, n.no, n.date)) { report.notes_skipped++; continue; }
      try {
        await saveDoc('delivery_note', {
          date: n.date, project_id: prj.id, site_id, manual_no: n.no, vehicle_no: n.vehicle || null,
          lines: n.lines.map((l) => ({ item_id: idOf.get(norm(l.name)), qty: l.qty, notes: l.notes || null })),
        }, null, user);
        await run(`UPDATE delivery_notes SET legacy_ok=1 WHERE project_id=? AND manual_no=? AND date=?`, prj.id, n.no, n.date);   // أذون تاريخية: معتبرة معتمدة
        report.notes_created++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        report.failed.push({ project: prj.name, no: n.no, date: n.date, error: e.message });
      }
    }
  }
  return report;
}
