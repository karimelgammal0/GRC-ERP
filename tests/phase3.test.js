// المرحلة 3: إنتاج تام ← تشغيل التكلفة ← مخزن التام ← إذن تسليم (إيراد + تكلفة) ← مستخلص بخصومات
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, run, insertRow, AppError, initSchema } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js');
await seedAll();
const { saveDoc, voidDoc, getDoc } = await import('../server/lib/docs.js');
const { savePeriod, approvePeriod } = await import('../server/lib/costing.js');
const P3 = await import('../server/lib/phase3.js');
const { setSetting } = await import('../server/lib/core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const near = (a, b, m, t = 0.011) => ok(Math.abs(Number(a) - b) <= t, `${m}: got ${a}, expected ${b}`);
const throws = async (fn, re, m) => { try { await fn(); ok(false, `${m} — expected error`); } catch (e) { ok(e instanceof AppError && re.test(e.message), `${m} — got: ${e.message}`); } };
const U = { id: 1, username: 'test' };
const bal = async (code) => Number(await val(`SELECT COALESCE(SUM(l.debit-l.credit),0) FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code=?`, code));
const st = Object.fromEntries((await all('SELECT id,name FROM stages')).map((s) => [s.name, s.id]));
const unit = await val('SELECT id FROM units LIMIT 1');
const mat = async (code, name) => await insertRow('materials', { code, name, unit_id: unit }, ['code', 'name', 'unit_id']);
const cement = await mat('RM-P1', 'اسمنت ابيض 50 كجم');
const CL = ['date', 'source_type', 'source_id', 'cost_type', 'cost_class', 'project_id', 'stage_id', 'material_id', 'qty', 'amount'];
const client = await insertRow('clients', { code: 'C-P3', name: 'عميل المرحلة 3' }, ['code', 'name']);
const prj = await insertRow('projects', { code: 'PRJ-P3', name: 'مشروع ثلاثة' }, ['code', 'name']); await run('UPDATE projects SET client_id=? WHERE id=?', client, prj);
const line = (o) => insertRow('cost_lines', { source_id: 1, cost_class: 'direct', project_id: prj, ...o }, CL);
await line({ date: '2026-06-05', source_type: 'issue', cost_type: 'material', stage_id: st['الصب'], material_id: cement, qty: 100, amount: 10000 });
await line({ date: '2026-06-12', source_type: 'labor', cost_type: 'labor', stage_id: st['التشطيب'], qty: 1, amount: 2000 });
await line({ date: '2026-06-15', source_type: 'issue', cost_type: 'material', stage_id: st['القوالب'], material_id: cement, qty: 1, amount: 5000 });
await line({ date: '2026-06-30', source_type: 'expense', cost_type: 'expense', cost_class: 'indirect', project_id: null, stage_id: null, qty: 1, amount: 3000 });
await setSetting('profit_pct', 10);
const itA = await insertRow('project_items', { code: 'IT-A', name: 'أرش', project_id: prj, unit_id: unit }, ['code', 'name', 'project_id', 'unit_id']);
const itB = await insertRow('project_items', { code: 'IT-B', name: 'كورنيش', project_id: prj, unit_id: unit }, ['code', 'name', 'project_id', 'unit_id']);
await run('UPDATE project_items SET area_m2=2 WHERE id=?', itA); await run('UPDATE project_items SET area_m2=3 WHERE id=?', itB);

console.log('▶ سجل الإنتاج');
await throws(() => saveDoc('production_log', { date: '2026-06-10', project_id: prj, lines: [{ item_id: itA, qty: 0 }] }, null, U), /أكبر من صفر/, 'كمية صفر');
const other = await insertRow('projects', { code: 'PRJ-OT', name: 'مشروع تاني' }, ['code', 'name']);
await throws(() => saveDoc('production_log', { date: '2026-06-10', project_id: other, lines: [{ item_id: itA, qty: 1 }] }, null, U), /لا يتبع/, 'بند من مشروع تاني');
const log = await saveDoc('production_log', { date: '2026-06-10', project_id: prj, lines: [{ item_id: itA, qty: 10 }, { item_id: itB, qty: 10 }] }, null, U);
ok(log.no?.startsWith('PRD-'), 'ترقيم PRD'); ok(Number(log.lines[0].area_m2) === 2, 'متر القطعة اتثبّت على السطر');
let q = await P3.monthProduction('2026-06', prj); near(q.reduce((t, r) => t + Number(r.meters), 0), 50, 'أمتار الإنتاج');

console.log('▶ تشغيل التكلفة');
let r = await P3.computeRun('2026-06', prj); ok(r.problems.length > 0 && /اعتمد سعر متر/.test(r.problems[0]), 'لازم سعر المتر يتعتمد أولاً');
await throws(() => P3.approveRun('2026-06', prj, U), /اعتمد سعر متر/, 'منع الاعتماد قبل سعر المتر');
await savePeriod({ month: '2026-06', spread_rate: 1 }, U); await approvePeriod('2026-06', 0, U);
r = await P3.computeRun('2026-06', prj);
ok(r.problems.length === 0, 'مفيش مشاكل: ' + r.problems.join(' | '));
near(r.parts.pool_cast, 5000, 'صب بسعر المتر'); near(r.parts.pool_finish, 1000, 'تشطيب بسعر المتر'); near(r.parts.mold, 5000, 'قوالب'); near(r.parts.indirect, 3000, 'غير مباشر كله على المشروع الوحيد');
near(r.total, 14000, 'تكلفة المشروع'); near(r.per_meter, 280, 'تكلفة المتر على المشروع');
near(r.items.find((i) => i.item_id === itA).value, 5600, 'قيمة الأرش'); near(r.items.find((i) => i.item_id === itB).value, 8400, 'قيمة الكورنيش');
await throws(() => P3.saveRun('2026-06', prj, 99999), /المرحّل/, 'المرحّل أكبر من المتاح');
await P3.approveRun('2026-06', prj, U);
near(await bal('1222'), 14000, 'مخزن التام = 14000'); near(await bal('5910'), -3000, 'الأعباء المحمّلة (دائن)');
const tb = await get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); near(tb.d, Number(tb.c), 'القيود متوازنة', 0.001);
const fgA = await val('SELECT fg_material_id FROM project_items WHERE id=?', itA);
const sA = await get('SELECT qty,value,avg_cost FROM material_stock WHERE material_id=?', fgA); near(sA.qty, 10, 'رصيد الأرش 10'); near(sA.avg_cost, 560, 'متوسط الأرش');
await throws(() => saveDoc('production_log', { date: '2026-06-20', project_id: prj, lines: [{ item_id: itA, qty: 1 }] }, null, U), /معتمدة/, 'منع إنتاج في شهر معتمد');
await throws(() => voidDoc('production_log', log.id, U), /معتمدة/, 'منع إلغاء سجل في شهر معتمد');

console.log('▶ إذن التسليم');
await throws(() => saveDoc('delivery_note', { date: '2026-07-05', project_id: prj, lines: [{ item_id: itA, qty: 11 }] }, null, U), /رصيد|سالب|يكفي|غير كاف/, 'تسليم أكتر من الرصيد');
const d1 = await saveDoc('delivery_note', { date: '2026-07-05', project_id: prj, lines: [{ item_id: itA, qty: 5 }] }, null, U);
near(d1.total_cost, 2800, 'تكلفة التسليم من متوسط الكارت'); near(d1.total, 3080, 'السعر = التكلفة + 10%'); near(d1.lines[0].unit_price, 616, 'سعر القطعة');
near(await bal('5900'), 2800, 'تكلفة المبيعات'); near(await bal('4100'), -3080, 'الإيراد'); near(await bal('1240'), 3080, 'العملاء'); near(await bal('1222'), 11200, 'مخزن التام بعد التسليم');
await throws(() => P3.reopenRun('2026-06', prj), /./, 'إعادة فتح التشغيل بعد تسليم جزء بيرفض لو الرصيد هيبقى سالب').catch(() => {});
const d2 = await saveDoc('delivery_note', { date: '2026-07-05', project_id: prj, lines: [{ item_id: itA, qty: 2 }, { item_id: itB, qty: 1 }] }, null, U);
near(d2.total_cost, 1120 + 840, 'إذن تاني في نفس اليوم'); 

console.log('▶ المستخلص');
const dt = await insertRow('deduction_types', { code: 'DED-T1', name: 'محتجز ضمان أعمال', kind: 'deduction', method: 'percent', value: 5, account_id: await val(`SELECT id FROM accounts WHERE code='1234'`) }, ['code', 'name', 'kind', 'method', 'value', 'account_id']);
const avail = await P3.certifiableLines(prj, {}); ok(avail.length === 3, 'بنود التسليم المتاحة للمستخلص = 3');
const cert = await saveDoc('client_certificate', { date: '2026-07-31', project_id: prj, period_from: '2026-07-01', period_to: '2026-07-31', adjustments: [{ type_id: dt }],
  lines: avail.slice(0, 1).map((a) => ({ delivery_line_id: a.delivery_line_id })) }, null, U);
near(cert.gross, 3080, 'إجمالي المستخلص'); near(cert.deductions_total, 154, 'محتجز 5%'); near(cert.net, 2926, 'الصافي');
near(await bal('1234'), 154, 'المحتجز لدى العميل'); near(await bal('1240'), 3080 + (1960 * 1.1) - 154, 'رصيد العملاء بعد الخصم');
await throws(() => saveDoc('client_certificate', { date: '2026-07-31', project_id: prj, lines: [{ delivery_line_id: avail[0].delivery_line_id }] }, null, U), /داخل بالفعل/, 'بند داخل في مستخلص تاني');
await throws(() => voidDoc('delivery_note', d1.id, U), /المستخلص/, 'منع إلغاء إذن داخل في مستخلص');
ok((await P3.certifiableLines(prj, {})).length === 2, 'المتاح بعد المستخلص = 2');
await voidDoc('client_certificate', cert.id, U); ok((await P3.certifiableLines(prj, {})).length === 3, 'إلغاء المستخلص رجّع البنود'); near(await bal('1234'), 0, 'المحتجز اتلغى');

console.log('▶ إعادة التقييم وإعادة الفتح');
await voidDoc('delivery_note', d1.id, U); await voidDoc('delivery_note', d2.id, U);
near(await bal('5900'), 0, 'تكلفة المبيعات رجعت صفر'); near(await bal('1222'), 14000, 'المخزن رجع 14000');
await P3.reopenRun('2026-06', prj); near(await bal('1222'), 0, 'إعادة الفتح شالت التحميل'); near(await bal('5910'), 0, 'والأعباء المحمّلة');
const tb2 = await get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); near(tb2.d, Number(tb2.c), 'القيود متوازنة', 0.001);

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); process.exit(fail ? 1 : 0);
