// استيراد تسليمات المشروعات الثلاثة: بنود + رصيد افتتاحي (كميات فقط) + أذون، وإعادة التشغيل بدون تكرار
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, run, insertRow, initSchema } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js'); await seedAll();
const { importDeliveries } = await import('../server/lib/delivery-import.js');
const { setSetting } = await import('../server/lib/core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const client = await insertRow('clients', { code: 'C-I', name: 'عميل' }, ['code', 'name']);
for (const [c, n] of [['I2', 'التوابل'], ['I3', 'الشلالات']]) await insertRow('projects', { code: c, name: n }, ['code', 'name']);
await run('UPDATE projects SET client_id=?', client);
await setSetting('opening_date', '2026-11-15');
const U = { id: 1, username: 'test' };
const r = await importDeliveries(U);
ok(r.projects.every((p) => !p.error), 'كل المشاريع اتطابقت: ' + JSON.stringify(r.projects));
ok(r.opening_date && (await val(`SELECT value FROM settings WHERE key='opening_date'`)) === '2026-09-03', 'تاريخ الافتتاح اتقدّم لأقدم إذن');
const fgq = Number(await val('SELECT COALESCE(SUM(qty),0) FROM opening_fg_stock'));
ok(fgq === 281 + 1220 + 23, 'كميات الافتتاح = المسلَّم قبل 15/11: ' + fgq);
ok(Number(await val('SELECT COALESCE(SUM(value),0) FROM opening_fg_stock')) === 0, 'مفيش تكلفة');
const pre = await val(`SELECT COUNT(*) FROM delivery_notes WHERE date<'2026-11-15'`);
ok(Number(pre) > 0, 'أذون ما قبل 15/11 اتسجلت: ' + pre);
// أذون بعد 15/11 مالهاش رصيد → لازم تتبلّغ كفشل (مش تتسجل برصيد سالب)
ok(r.failed.length > 0 && r.failed.every((f) => /لا يكفي|إنتاج تام/.test(f.error)), 'أذون بدون رصيد اتبلّغت: ' + JSON.stringify(r.failed.slice(0, 2)));
// رصيد المسلَّم قبل 15/11 = صفر بعد الأذون
const bal = Number(await val(`SELECT COALESCE(SUM(s.qty),0) FROM material_stock s JOIN materials m ON m.id=s.material_id WHERE m.fg_item_id IS NOT NULL`));
ok(bal >= 0, 'مفيش رصيد سالب: ' + bal);
// إعادة التشغيل: مفيش بنود ولا أذون مكررة
const n1 = Number(await val('SELECT COUNT(*) FROM delivery_notes')), i1 = Number(await val('SELECT COUNT(*) FROM project_items'));
const r2_ = await importDeliveries(U);
ok(Number(await val('SELECT COUNT(*) FROM project_items')) === i1, 'البنود مبتتكررش');
ok(Number(await val('SELECT COUNT(*) FROM delivery_notes')) === n1 && r2_.notes_skipped === n1, 'الأذون مبتتكررش');
console.log(`  ${r.notes_created} إذن اتسجل، ${r.failed.length} فشل`);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
