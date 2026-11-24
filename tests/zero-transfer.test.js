// تحويل سقالات (مخزن «تحويل بدون تكلفة»): قيد بصفر + رجوع بقيد صفري، والمخازن العادية تفضل ترفض القيد الصفري
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, run, AppError, initSchema, insertRow } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js');
const { saveDoc } = await import('../server/lib/docs.js');
const { addMove, settle } = await import('../server/lib/stock.js');
await seedAll();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const U = { id: 1, username: 'test' };
const wh = await insertRow('warehouses', { code: 'WH-SC', name: 'مخزن سقالات', type: 'raw', zero_cost_transfer: 1 }, ['code', 'name', 'type', 'zero_cost_transfer']);
const wh2 = await insertRow('warehouses', { code: 'WH-NR', name: 'مخزن عادي', type: 'raw' }, ['code', 'name', 'type']);
const mat = await val('SELECT id FROM materials LIMIT 1');
const prj = await insertRow('projects', { code: 'P-T', name: 'مشروع' }, ['code', 'name']);
for (const w of [wh, wh2]) { await addMove({ date: '2026-11-01', warehouse_id: w, material_id: mat, direction: 'in', qty: 100, value: 0, doc_type: 'opening', doc_id: 0, line_id: 0 }); await settle([[w, mat]], { type: 'opening', id: 0 }); }

const out = await saveDoc('stock_issue', { date: '2026-11-24', kind: 'site', warehouse_id: wh, project_id: prj, lines: [{ material_id: mat, qty: 10 }] }, null, U);
const je = await get(`SELECT * FROM journal_entries WHERE source_type='issue' AND source_id=?`, out.id ?? out);
ok(!!je && /تحويل/.test(je.description), 'قيد صفري ظاهر وبيانه تحويل');
ok((await val('SELECT COUNT(*) FROM journal_lines WHERE entry_id=?', je.id)) === 2 && (await val('SELECT COALESCE(SUM(debit+credit),0) FROM journal_lines WHERE entry_id=?', je.id)) === 0, 'سطرين بصفر');
const back = await saveDoc('stock_issue', { date: '2026-11-30', kind: 'site_in', warehouse_id: wh, project_id: prj, lines: [{ material_id: mat, qty: 10 }] }, null, U);
ok(!!(await get(`SELECT 1 x FROM journal_entries WHERE source_type='issue' AND source_id=?`, back.id ?? back)), 'الوارد بقيد صفري');
let err = null; try { await saveDoc('stock_issue', { date: '2026-11-24', kind: 'site', warehouse_id: wh2, project_id: prj, lines: [{ material_id: mat, qty: 5 }] }, null, U); } catch (e) { err = e; }
ok(err instanceof AppError && /سطرين/.test(err.message), 'المخزن العادي لسه بيرفض القيد الصفري');
console.log(`zero-transfer: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
