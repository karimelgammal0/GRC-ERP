// ترحيل دليل الحسابات الموجود في قاعدة البيانات إلى الدليل الجديد (seed/chart-of-accounts.csv)
// مع الحفاظ على القيود والربط (الحسابات بتتغيّر أكوادها وأسماؤها بس). آمن للتكرار.
import { applyChart, readChartFile, LEGACY_RENAMES } from './lib/coa.js';
import { initSchema, closeDb, MODE } from './db.js';
import { getSetting, setSetting } from './lib/core.js';
await initSchema();
// الترحيل من الأكواد القديمة بيتم مرة واحدة فقط (علامة coa_version)، وبعدها التطبيق بيكون تحديث بالكود
const done = (await getSetting('coa_version')) === 'v2';
const r = await applyChart(readChartFile(), done ? {} : { rename: LEGACY_RENAMES, prune: true });
await setSetting('coa_version', 'v2');
console.log(`تم تطبيق دليل الحسابات (${MODE === 'postgres' ? 'Supabase' : 'محلي'}): أُضيف ${r.added} — تحدّث ${r.updated} — حُذف ${r.removed} — أُوقف ${r.stopped}`);
await closeDb();
