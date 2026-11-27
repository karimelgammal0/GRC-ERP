// اعتماد طلب الشراء: مفيش أمر توريد إلا بعد اعتماد مدير المشتريات، وأي تعديل بيسحب الاعتماد
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, run, insertRow, AppError, initSchema } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js'); await seedAll();
const { saveDoc } = await import('../server/lib/docs.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const U = { id: 1, username: 'test' };
const unit = await val('SELECT id FROM units LIMIT 1');
const mat = await insertRow('materials', { code: 'RM-AP', name: 'صنف اعتماد', unit_id: unit }, ['code', 'name', 'unit_id']);
const sup = await insertRow('suppliers', { code: 'S-AP', name: 'مورد' }, ['code', 'name']);
const req = await saveDoc('purchase_request', { date: '2026-11-20', lines: [{ material_id: mat, qty: 10 }] }, null, U);
const mk = (o = {}) => saveDoc('purchase_order', { date: '2026-11-21', supplier_id: sup, request_id: req.id, lines: [{ material_id: mat, qty: 4, unit_price: 5, request_line_id: req.lines[0].id }], ...o }, null, U);
try { await mk(); ok(false, 'لازم يترفض قبل الاعتماد'); } catch (e) { ok(e instanceof AppError && /بانتظار/.test(e.message), 'رفض قبل الاعتماد: ' + e.message); }
const { requestSteps } = await import('../server/lib/docs.js');
const steps = await requestSteps(); ok(steps.length >= 2, 'السلسلة من وظائف المشتريات: ' + steps.join(' ← '));
const approveAll = async (id) => { for (const j of steps) await run(`INSERT INTO purchase_request_approvals(request_id, job_name, user_id, user_name, at) VALUES(?,?,1,'x','t')`, id, j); };
await approveAll(req.id);
const po = await mk(); ok(po && po.id, 'أمر التوريد اتعمل بعد الاعتماد');
// تعديل طلب معتمد (من غير أوامر) يسحب الاعتماد
const req2 = await saveDoc('purchase_request', { date: '2026-11-20', lines: [{ material_id: mat, qty: 3 }] }, null, U);
await approveAll(req2.id);
await saveDoc('purchase_request', { date: '2026-11-20', lines: [{ material_id: mat, qty: 5 }] }, req2.id, U);
ok(Number(await val('SELECT COUNT(*) FROM purchase_request_approvals WHERE request_id=?', req2.id)) === 0, 'التعديل سحب الاعتمادات');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
