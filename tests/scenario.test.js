// اختبار سيناريو كامل على قاعدة مؤقتة: شراء → استلام → فواتير → صرف → تكلفة → عمالة → سندات → تقارير
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
process.env.DATABASE_URL = ''; // الاختبار دايماً على Postgres مضمّن في الذاكرة، مش على Supabase
process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, run, r2, AppError, initSchema } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js');
const { saveDoc, voidDoc } = await import('../server/lib/docs.js');
const { applyOpening, lockOpening } = await import('../server/lib/opening.js');
const { setSetting, acc, getSetting } = await import('../server/lib/core.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', msg); } };
const near = (a, b, msg, tol = 0.011) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
const throws = async (fn, re, msg) => { try { await fn(); ok(false, `${msg} — expected error`); } catch (e) { ok(e instanceof AppError && (!re || re.test(e.message)), `${msg} — got: ${e.message}`); } };
const section = (t) => console.log('\n▶', t);
const U = { id: 1, username: 'test' };

await seedAll();
const wh = await val(`SELECT id FROM warehouses LIMIT 1`);
const stage = Object.fromEntries((await all('SELECT id,code,name FROM stages ORDER BY seq')).map((s, i) => [['mold', 'cast', 'fin'][i], s.id]));
const mat = async (name) => await val('SELECT id FROM materials WHERE name=?', name);
const glBal = async (code) => await val(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code=?`, code);
const stockTotal = async () => await val('SELECT COALESCE(SUM(value),0) FROM material_stock');

section('1) الأرصدة الافتتاحية من الشيت');
const openSum = r2(await val('SELECT SUM(value) FROM opening_stock WHERE qty>0'));
const res = await applyOpening(U);
near(await stockTotal(), openSum, 'قيمة المخزون بعد الافتتاحي = مجموع الشيت');
near(await glBal('1221'), openSum, 'حساب المخزون في الأستاذ = قيمة المخزون');
near(await glBal('3400'), -openSum, 'مقابل الأرصدة الافتتاحية');
// تعديل الكمية الافتتاحية قبل القفل ثم إعادة التطبيق
const cement = await mat('اسمنت ابيض *50ك'); const before = await get('SELECT * FROM opening_stock WHERE material_id=?', cement);
await run('UPDATE opening_stock SET qty=120, value=12000 WHERE material_id=?', cement);
await applyOpening(U);
near((await get('SELECT qty,value,avg_cost FROM material_stock WHERE material_id=?', cement)).avg_cost, 100, 'متوسط الاسمنت بعد التعديل = 100');
near(await glBal('1221'), r2(openSum - before.value + 12000), 'الأستاذ اتحدّث بعد إعادة التطبيق');
await lockOpening(U);
await throws(async () => await applyOpening(U), /مقفلة/, 'لا يمكن تعديل الافتتاحي بعد القفل');
const openStockTotal = await stockTotal();

section('2) التكويد: مشروع + بند + موقع + مورد');
const sup = (await get(`SELECT id FROM suppliers LIMIT 1`)).id; const sup2 = (await get(`SELECT id FROM suppliers WHERE id<>? LIMIT 1`, sup)).id;
const prj = (await get(`SELECT id FROM projects LIMIT 1`)).id; const prj2 = (await get(`SELECT id FROM projects WHERE id<>? LIMIT 1`, prj)).id;
await run(`INSERT INTO project_items(code,name,project_id) VALUES('BND-T1','واجهة A',?),('BND-T2','واجهة B',?),('BND-T3','بند مشروع آخر',?)`, prj, prj, prj2);
const item1 = await val(`SELECT id FROM project_items WHERE code='BND-T1'`), item2 = await val(`SELECT id FROM project_items WHERE code='BND-T2'`), itemOther = await val(`SELECT id FROM project_items WHERE code='BND-T3'`);
await run(`INSERT INTO sites(code,name,project_id) VALUES('SITE-T1','موقع تجريبي',?)`, prj); const site = await val(`SELECT id FROM sites WHERE code='SITE-T1'`);
const treasury = (await get(`SELECT id FROM treasuries LIMIT 1`)).id; const cust = (await get(`SELECT id FROM custodians LIMIT 1`)).id;
// خامة جديدة صفر الرصيد لاختبار المتوسط المرجح بدقة
await run(`INSERT INTO materials(code,name,unit_id) VALUES('RM-T1','خامة اختبار',(SELECT id FROM units LIMIT 1))`); const T1 = await mat('خامة اختبار');

section('3) طلب شراء → أمر شراء → استلام جزئي → فاتورة مطابقة');
const pr = await saveDoc('purchase_request', { date: '2026-11-02', requested_by: 'المخزن', lines: [{ material_id: T1, qty: 100 }] }, null, U);
const po = await saveDoc('purchase_order', { date: '2026-11-02', supplier_id: sup, request_id: pr.id, payment_type: 'credit', lines: [{ material_id: T1, qty: 100, unit_price: 10, request_line_id: pr.lines[0].id }] }, null, U);
ok((await get('SELECT status FROM purchase_requests WHERE id=?', pr.id)).status === 'ordered', 'حالة الطلب بقت «تم الأمر»');
await throws(async () => await saveDoc('purchase_order', { date: '2026-11-02', supplier_id: sup, request_id: pr.id, lines: [{ material_id: T1, qty: 5, unit_price: 10, request_line_id: pr.lines[0].id }] }, null, U), /المتبقي/, 'أمر شراء زيادة عن الطلب');
const grn1 = await saveDoc('goods_receipt', { date: '2026-11-03', supplier_id: sup, warehouse_id: wh, order_id: po.id, lines: [{ material_id: T1, qty: 40, order_line_id: po.lines[0].id }] }, null, U);
near(grn1.lines[0].unit_price, 10, 'سعر الاستلام اتسحب من الأمر');
ok((await get('SELECT status FROM purchase_orders WHERE id=?', po.id)).status === 'partial', 'الأمر «استلام جزئي»');
near((await get('SELECT qty,avg_cost FROM material_stock WHERE material_id=?', T1)).qty, 40, 'رصيد الخامة 40');
near(await glBal('2140'), -400, 'استلامات غير مفوترة 400 دائن');
await throws(async () => await saveDoc('goods_receipt', { date: '2026-11-03', supplier_id: sup, warehouse_id: wh, order_id: po.id, lines: [{ material_id: T1, qty: 61, order_line_id: po.lines[0].id }] }, null, U), /المتبقي/, 'استلام زيادة عن الأمر');
// فاتورة مطابقة للاستلام بسعر 11 + نقل 40 + ضريبة 14%
const inv1 = await saveDoc('purchase_invoice', { date: '2026-11-04', supplier_id: sup, warehouse_id: wh, payment_type: 'credit', freight: 40, vat_percent: 14, discount: 0,
  lines: [{ material_id: T1, qty: 40, unit_price: 11, grn_line_id: grn1.lines[0].id }] }, null, U);
near(inv1.subtotal, 440, 'إجمالي الفاتورة'); near(inv1.vat_amount, 61.6, 'الضريبة 14% على 440'); near(inv1.total, 541.6, 'الإجمالي = 440 + 40 نقل + 61.6');
// التكلفة الفعلية 480 (440+40) بدل 400 → المتوسط 12
near((await get('SELECT value,avg_cost FROM material_stock WHERE material_id=?', T1)).avg_cost, 12, 'المتوسط بعد تحميل الفرق والنقل = 12');
near(await glBal('2140'), 0, 'الاستلامات غير المفوترة اتصفّت');
near(await glBal('2110'), -541.6, 'الموردين 541.6 دائن (مع بقية أرصدة المورد)');
await throws(async () => await voidDoc('goods_receipt', grn1.id, U), /فاتورة/, 'لا يمكن إلغاء استلام مفوتر');

section('4) فاتورة مباشرة آجلة + نقدية من الخزينة + نقدية من عهدة (متوسط مرجح)');
const invB = await saveDoc('purchase_invoice', { date: '2026-11-05', supplier_id: sup, warehouse_id: wh, payment_type: 'credit', lines: [{ material_id: T1, qty: 60, unit_price: 15 }] }, null, U);
// 40 × 12 = 480 + 60 × 15 = 900 → 1380 / 100 = 13.8
near((await get('SELECT qty,avg_cost,value FROM material_stock WHERE material_id=?', T1)).avg_cost, 13.8, 'المتوسط المرجح 13.8');
const invC = await saveDoc('purchase_invoice', { date: '2026-11-05', supplier_id: sup2, warehouse_id: wh, payment_type: 'cash', treasury_id: treasury, lines: [{ material_id: T1, qty: 100, unit_price: 20 }] }, null, U);
// (1380 + 2000) / 200 = 16.9
near((await get('SELECT avg_cost FROM material_stock WHERE material_id=?', T1)).avg_cost, 16.9, 'المتوسط بعد النقدي 16.9');
near(await glBal('1211'), -2000, 'الخزينة نقصت 2000');
const invD = await saveDoc('purchase_invoice', { date: '2026-11-05', supplier_id: sup2, warehouse_id: wh, payment_type: 'cash', custodian_id: cust, lines: [{ material_id: T1, qty: 10, unit_price: 17 }] }, null, U);
near(await glBal('1213'), -170, 'العهدة نقصت 170');
await throws(async () => await saveDoc('purchase_invoice', { date: '2026-11-05', supplier_id: sup2, warehouse_id: wh, payment_type: 'cash', lines: [{ material_id: T1, qty: 1, unit_price: 1 }] }, null, U), /مصدر دفع/, 'الشراء النقدي بدون مصدر');
// الآن: 210 وحدة، قيمة 3380+170 = 3550 → متوسط 16.9048
const st0 = await get('SELECT qty,value,avg_cost FROM material_stock WHERE material_id=?', T1);
near(st0.qty, 210, 'رصيد 210'); near(st0.value, 3550, 'قيمة 3550');

section('5) الصرف على مشروع + بند + مرحلة');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-06', kind: 'production', warehouse_id: wh, project_id: prj, lines: [{ material_id: T1, qty: 1 }] }, null, U), /المشروع والبند والمرحلة/, 'الصرف بدون بند ومرحلة');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-06', kind: 'production', warehouse_id: wh, project_id: prj, item_id: itemOther, stage_id: stage.cast, lines: [{ material_id: T1, qty: 1 }] }, null, U), /لا يتبع المشروع/, 'بند من مشروع آخر');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-06', kind: 'production', warehouse_id: wh, project_id: prj, item_id: item1, stage_id: stage.cast, lines: [{ material_id: T1, qty: 999 }] }, null, U), /لا يكفي/, 'صرف أكبر من الرصيد');
const iss1 = await saveDoc('stock_issue', { date: '2026-11-06', kind: 'production', warehouse_id: wh, project_id: prj, item_id: item1, stage_id: stage.cast, lines: [{ material_id: T1, qty: 50 }] }, null, U);
near(iss1.lines[0].unit_cost, 16.9048, 'تكلفة الصرف = المتوسط', 0.001); near(iss1.lines[0].total, r2(50 * 3550 / 210), 'قيمة الصرف');
const iss2 = await saveDoc('stock_issue', { date: '2026-11-07', kind: 'production', warehouse_id: wh, project_id: prj, item_id: item2, stage_id: stage.mold, lines: [{ material_id: T1, qty: 20 }] }, null, U);
const iss3 = await saveDoc('stock_issue', { date: '2026-11-07', kind: 'site', warehouse_id: wh, project_id: prj, site_id: site, lines: [{ material_id: T1, qty: 10 }] }, null, U);
// التحويل لموقع: الموقع مطلوب بس لو المشروع متكود له مواقع
await run(`INSERT INTO sites(code,name,project_id) VALUES('SITE-T2','موقع مشروع تاني',?)`, prj2); const site2 = await val(`SELECT id FROM sites WHERE code='SITE-T2'`);
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-07', kind: 'site', warehouse_id: wh, project_id: prj, lines: [{ material_id: T1, qty: 1 }] }, null, U), /اختر الموقع/, 'مشروع له مواقع من غير اختيار موقع');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-07', kind: 'site', warehouse_id: wh, project_id: prj, site_id: site2, lines: [{ material_id: T1, qty: 1 }] }, null, U), /لا يتبع المشروع/, 'موقع تابع لمشروع تاني');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-07', kind: 'site', warehouse_id: wh, lines: [{ material_id: T1, qty: 1 }] }, null, U), /المشروع/, 'تحويل لموقع من غير مشروع');
const prj3 = (await get(`SELECT id FROM projects WHERE id NOT IN (?,?) AND NOT EXISTS (SELECT 1 FROM sites WHERE project_id=projects.id) LIMIT 1`, prj, prj2))?.id;
if (prj3) {
  const nosite = await saveDoc('stock_issue', { date: '2026-11-07', kind: 'site', warehouse_id: wh, project_id: prj3, site_id: site, lines: [{ material_id: T1, qty: 1 }] }, null, U);
  ok(!(await val('SELECT site_id FROM stock_issues WHERE id=?', nosite.id)), 'مشروع من غير مواقع: الموقع بيتساب فاضي');
  await voidDoc('stock_issue', nosite.id, U);
} else ok(false, 'لازم يكون فيه مشروع تالت في البيانات الأساسية');
const iss4 = await saveDoc('stock_issue', { date: '2026-11-07', kind: 'overhead', warehouse_id: wh, lines: [{ material_id: T1, qty: 5 }] }, null, U);
const avgNow = r2(3550 / 210);
near((await get('SELECT avg_cost FROM material_stock WHERE material_id=?', T1)).avg_cost, 16.9048, 'الصرف لا يغيّر المتوسط', 0.001);
near((await get('SELECT qty FROM material_stock WHERE material_id=?', T1)).qty, 125, 'الرصيد بعد الصرف 125');
// ربط التكلفة بالأستاذ
const cl = async (w) => await val(`SELECT COALESCE(SUM(amount),0) FROM cost_lines WHERE ${w}`);
near(await cl(`project_id=${prj} AND stage_id=${stage.cast} AND item_id=${item1}`), iss1.lines[0].total, 'تكلفة المشروع/البند/مرحلة الصب');
near(await glBal('1224'), iss1.lines[0].total, 'حساب إنتاج تحت التشغيل — الصب');
near(await glBal('1223'), iss2.lines[0].total, 'حساب القوالب');
near(await glBal('5200'), iss3.lines[0].total, 'خامات محولة للمواقع'); near(await glBal('5300'), iss4.lines[0].total, 'غير مباشر');
near(await cl(`cost_class='indirect'`), iss4.lines[0].total, 'تكلفة غير مباشرة بدون مشروع');

section('6) حركة بأثر رجعي → إعادة تقييم الصرف');
// استلام بتاريخ قبل الصرف بسعر مرتفع (تغيّر المتوسط وقت الصرف)
await saveDoc('purchase_invoice', { date: '2026-11-05', supplier_id: sup, warehouse_id: wh, payment_type: 'credit', lines: [{ material_id: T1, qty: 10, unit_price: 100 }] }, null, U);
const iss1b = await get('SELECT * FROM stock_issue_lines WHERE issue_id=?', iss1.id);
ok(iss1b.unit_cost > 20, `تكلفة الصرف القديم اتحدثت (${iss1b.unit_cost})`);
near(await cl(`project_id=${prj} AND stage_id=${stage.cast}`), iss1b.total, 'التكلفة في التقرير اتحدثت');
near(await glBal('1224'), iss1b.total, 'القيد اتحدّث');
// الاتساق: قيمة المخزون = حساب 1201 دائماً
near(await stockTotal(), await glBal('1221'), 'قيمة المخزون = الأستاذ بعد إعادة التقييم');
// إلغاء الفاتورة بأثر رجعي يرجع الأرقام
const lastInv = (await get(`SELECT id FROM purchase_invoices ORDER BY id DESC LIMIT 1`)).id; await voidDoc('purchase_invoice', lastInv, U);
near((await get('SELECT unit_cost FROM stock_issue_lines WHERE issue_id=?', iss1.id)).unit_cost, 16.9048, 'رجعت التكلفة بعد الإلغاء', 0.001);
near(await stockTotal(), await glBal('1221'), 'الاتساق بعد الإلغاء');

section('7) مرتجع صرف / إلغاء / حماية');
const ret = await saveDoc('stock_issue', { date: '2026-11-08', kind: 'return', ref_issue_id: iss2.id, lines: [{ ref_line_id: iss2.lines[0].id, qty: 5 }] }, null, U);
near(ret.lines[0].unit_cost, iss2.lines[0].unit_cost, 'المرتجع بنفس تكلفة الصرف الأصلي', 0.001);
near(await cl(`project_id=${prj} AND stage_id=${stage.mold}`), r2(iss2.lines[0].total * 15 / 20), 'تكلفة المرحلة نقصت بالمرتجع');
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-08', kind: 'return', ref_issue_id: iss2.id, lines: [{ ref_line_id: iss2.lines[0].id, qty: 16 }] }, null, U), /المتاح إرجاعه/, 'مرتجع أكبر من المصروف');
await throws(async () => await voidDoc('stock_issue', iss2.id, U), /مرتجع/, 'إلغاء صرف عليه مرتجع');
await voidDoc('stock_issue', ret.id, U);
await voidDoc('stock_issue', iss2.id, U);
near(await cl(`stage_id=${stage.mold}`), 0, 'تكلفة القوالب صفر بعد الإلغاء');
// تعديل إذن صرف (كمية)
const iss1e = await saveDoc('stock_issue', { date: '2026-11-06', kind: 'production', warehouse_id: wh, project_id: prj, item_id: item1, stage_id: stage.cast, lines: [{ material_id: T1, qty: 30 }] }, iss1.id, U);
near(iss1e.lines[0].qty, 30, 'تعديل الكمية'); near((await get('SELECT qty FROM material_stock WHERE material_id=?', T1)).qty, 165, 'الرصيد بعد التعديل (إلغاء 20 + تخفيض 20)');
near(await stockTotal(), await glBal('1221'), 'الاتساق بعد التعديل');

section('8) الجرد والتسوية');
const adj = await saveDoc('stock_adjustment', { date: '2026-11-09', warehouse_id: wh, lines: [{ material_id: T1, counted_qty: 140 }] }, null, U);
near(adj.lines[0].diff_qty, -25, 'عجز 25'); ok(adj.lines[0].value < 0, 'قيمة العجز سالبة');
near(await glBal('5300'), iss4.lines[0].total - adj.lines[0].value, 'عجز الجرد في الأستاذ (مواد غير مباشرة)'); near(await cl("source_type='adjustment'"), -adj.lines[0].value, 'عجز الجرد في التكلفة'); near(await stockTotal(), await glBal('1221'), 'الاتساق بعد الجرد');

section('9) سداد الموردين وكشف الحساب');
const openInv = invB.id;
const pay = await saveDoc('voucher', { date: '2026-11-10', kind: 'supplier_payment', supplier_id: sup, treasury_id: treasury, amount: 1000, allocations: [{ invoice_id: openInv, amount: 900 }, { invoice_id: inv1.id, amount: 100 }] }, null, U);
near((await get('SELECT total FROM purchase_invoices WHERE id=?', openInv)).total - 900, 0, 'فاتورة B اتسددت بالكامل');
await throws(async () => await voidDoc('purchase_invoice', openInv, U), /سداد/, 'إلغاء فاتورة مسددة');
await throws(async () => await saveDoc('voucher', { date: '2026-11-10', kind: 'supplier_payment', supplier_id: sup, treasury_id: treasury, amount: 5000, allocations: [{ invoice_id: openInv, amount: 5000 }] }, null, U), /المتبقي/, 'سداد أكبر من المتبقي');
const { reportRouter } = await import('../server/routes/reports.js');
const stmt = await all(`SELECT jl.debit, jl.credit FROM journal_lines jl WHERE jl.account_id=? AND jl.supplier_id=?`, await acc('acc_ap'), sup);
const supBal = r2(stmt.reduce((s, x) => s + x.credit - x.debit, 0));
near(supBal, r2(541.6 + 900 - 1000), 'رصيد المورد = فواتير − سداد');
await voidDoc('voucher', pay.id, U);
near(r2((await all(`SELECT jl.debit, jl.credit FROM journal_lines jl WHERE jl.account_id=? AND jl.supplier_id=?`, await acc('acc_ap'), sup)).reduce((s, x) => s + x.credit - x.debit, 0)), 1441.6, 'إلغاء السند رجّع الرصيد');

section('10) العمالة والمرتبات والمصروفات والعهد');
const eDaily = saveDoc && await get(`SELECT 1`) && (async () => { await run(`INSERT INTO employees(code,name,emp_type,daily_rate,cost_class,default_stage_id) VALUES('EMP-T1','عامل صب','daily',200,'direct',?),('EMP-T2','سائق','daily',150,'indirect',NULL),('EMP-T3','مهندس','monthly',0,'direct',?),('EMP-T4','محاسب','monthly',0,'admin',NULL)`, stage.cast, stage.mold); await run(`UPDATE employees SET monthly_salary=6000 WHERE code='EMP-T3'`); await run(`UPDATE employees SET monthly_salary=5000 WHERE code='EMP-T4'`); return true; })();
const E = async (c) => await val('SELECT id FROM employees WHERE code=?', c);
await throws(async () => await saveDoc('labor_sheet', { date: '2026-11-10', lines: [{ employee_id: await E('EMP-T1'), days: 1 }] }, null, U), /مرحلة/, 'عمالة مباشرة بدون مرحلة');
const sheet = await saveDoc('labor_sheet', { date: '2026-11-10', lines: [
  { employee_id: await E('EMP-T1'), days: 1, project_id: prj, item_id: item1, stage_id: stage.cast },
  { employee_id: await E('EMP-T1'), days: 0.5, rate: 220, project_id: prj, item_id: item2, stage_id: stage.cast },
  { employee_id: await E('EMP-T2'), days: 1 }] }, null, U);
near(sheet.total, 200 + 110 + 150, 'إجمالي اليومية');
near(await cl(`cost_type='labor' AND stage_id=${stage.cast}`), 310, 'عمالة مرحلة الصب'); near(await glBal('5100'), 150, 'أجور غير مباشرة');
near(await glBal('2130'), -460, 'أجور مستحقة');
const pr1 = await saveDoc('payroll', { month: '2026-11', date: '2026-11-30', lines: [
  { employee_id: await E('EMP-T3'), base: 6000, additions: 500, deductions: 100, allocations: [{ project_id: prj, item_id: item1, stage_id: stage.mold, percent: 60 }, { project_id: prj, item_id: item2, stage_id: stage.cast, percent: 40 }] },
  { employee_id: await E('EMP-T4'), base: 5000 }] }, null, U);
near(pr1.gross, 11500, 'إجمالي المرتبات'); near(pr1.net, 11400, 'الصافي');
near(await cl(`cost_type='labor' AND item_id=${item1} AND stage_id=${stage.mold}`), 3900, 'توزيع 60% من 6500'); near(await glBal('6100'), 5000, 'مرتبات إدارية');
await throws(async () => await saveDoc('payroll', { month: '2026-11', date: '2026-11-30', lines: [{ employee_id: await E('EMP-T4'), base: 5000 }] }, null, U), /نفس الشهر/, 'راتب مكرر لنفس الشهر');
const wp = await saveDoc('voucher', { date: '2026-11-11', kind: 'wage_payment', treasury_id: treasury, amount: 460, wage_links: [{ sheet_id: sheet.id, amount: 460 }] }, null, U);
near((await get('SELECT paid_amount FROM labor_sheets WHERE id=?', sheet.id)).paid_amount, 460, 'الكشف اتسدد');
await throws(async () => await voidDoc('labor_sheet', sheet.id, U), /صرف أجور/, 'إلغاء كشف مسدد');
const ex = await saveDoc('voucher', { date: '2026-11-11', kind: 'expense', category_id: await val(`SELECT id FROM expense_categories WHERE cost_class='direct'`), custodian_id: cust, amount: 300, project_id: prj, item_id: item1, stage_id: stage.cast, description: 'نقل قوالب' }, null, U);
near(await cl(`cost_type='expense' AND stage_id=${stage.cast}`), 300, 'مصروف مباشر على مرحلة'); near(await glBal('1213'), -170 - 300, 'العهدة نقصت بالمصروف');
const ci = await saveDoc('voucher', { date: '2026-11-12', kind: 'custody_issue', treasury_id: treasury, custodian_id: cust, amount: 1000 }, null, U);
near(await glBal('1213'), 530, 'صرف عهدة 1000');
const adminEx = await saveDoc('voucher', { date: '2026-11-12', kind: 'expense', category_id: await val(`SELECT id FROM expense_categories WHERE name='إيجارات'`), treasury_id: treasury, amount: 2000 }, null, U);
near(await cl(`cost_class='admin'`), 7000, 'مصروف إداري (إيجار 2000 + مرتب 5000)');
await saveDoc('voucher', { date: '2026-11-12', kind: 'transfer', treasury_id: treasury, to_treasury_id: (await get(`SELECT id FROM treasuries WHERE id<>?`, treasury)).id, amount: 500 }, null, U);

section('11) الفترات المالية والتكامل المحاسبي');
await run(`UPDATE fiscal_periods SET status='closed' WHERE name LIKE 'نوفمبر%'`);
await throws(async () => await saveDoc('stock_issue', { date: '2026-11-15', kind: 'overhead', warehouse_id: wh, lines: [{ material_id: T1, qty: 1 }] }, null, U), /مقفلة/, 'فترة مقفلة');
await throws(async () => await voidDoc('voucher', ci.id, U), /مقفلة/, 'إلغاء في فترة مقفلة');
await run(`UPDATE fiscal_periods SET status='open'`);
const tb = (await all(`SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines`))[0];
near(tb.d, tb.c, 'ميزان المراجعة متزن (إجمالي المدين = الدائن)');
near(await stockTotal(), await glBal('1221'), 'مخزون الخامات = الأستاذ');
const wipAndCost = await glBal('1223') + await glBal('1224') + await glBal('1225') + await glBal('5200') + await glBal('5300') + await glBal('5100') + await glBal('6100') + await glBal('6200') + await glBal('5400') + await glBal('5500') + await glBal('5600') + await glBal('6300') + await glBal('6400') + await glBal('6500');
near(await cl('1=1'), r2(wipAndCost), 'مجموع جدول التكلفة = مجموع حسابات التكلفة في الأستاذ');
ok((await all('SELECT * FROM stock_moves WHERE bal_qty < -0.0000001')).length === 0, 'لا يوجد رصيد سالب في الدفتر');
// كل صف دفتر: الرصيد التراكمي صحيح
const moves = await all(`SELECT * FROM stock_moves WHERE material_id=? ORDER BY date, ord, id`, T1); let q = 0, v = 0, bad = 0;
for (const m of moves) { if (m.direction === 'in') { q += m.qty; v += m.value; } else { q -= m.qty; v -= m.value; } if (Math.abs(q - m.bal_qty) > 1e-6 || Math.abs(v - m.bal_value) > 0.02) bad++; }
ok(bad === 0, 'الأرصدة التراكمية في كارت الصنف سليمة');

section('12) التقارير');
const app = (await import('../server/index.js')).app;
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const api = async (p) => { const r = await fetch(base + p, { headers: { cookie } }); const j = await r.json(); if (!r.ok) throw new Error(p + ' → ' + j.error); return j; };
const piv = await api('/api/reports/cost-pivot?row=project&col=stage');
const pname = await val('SELECT name FROM projects WHERE id=?', prj); const prow = piv.rows.find((x) => x.name === pname);
ok(prow && prow.total > 0, 'مصفوفة المشروع × المرحلة فيها بيانات');
near(piv.totals.total, await cl('1=1'), 'إجمالي المصفوفة = جدول التكلفة');
const piv2 = await api('/api/reports/cost-pivot?row=stage&col=project');
near(piv2.totals.total, piv.totals.total, 'مرحلة × مشروع نفس الإجمالي');
const card = await api(`/api/reports/stock-card?material_id=${T1}`);
ok(card.moves.length > 5, 'كارت الصنف'); near(card.closing.qty, 140, 'رصيد كارت الصنف = 140');
const bal = await api('/api/reports/stock-balances?hide_zero=1'); near(bal.total_value, await stockTotal(), 'تقييم المخزون = الأرصدة');
const bal2 = await api(`/api/reports/stock-balances?as_of=2026-11-04&hide_zero=1`); ok(bal2.rows.length > 0, 'أرصدة المخزن في تاريخ سابق');
const tbr = await api('/api/reports/trial-balance'); near(tbr.totals.debit, tbr.totals.credit, 'ميزان المراجعة من التقرير متزن');
const ss = await api(`/api/reports/supplier-statement?supplier_id=${sup}`); near(ss.closing, 1441.6, 'كشف حساب المورد');
const tr = await api('/api/reports/treasury-balances'); ok(tr.length === 2, 'أرصدة الخزن');
const dash = await api('/api/reports/dashboard'); near(dash.stock_value, await stockTotal(), 'لوحة التحكم');
const lk = await api('/api/lookups'); ok(lk.materials.length >= 102 && lk.accounts.length > 30, 'القوائم المرجعية');
server.close();

console.log(`\n${fail ? '✗' : '✓'} ${pass} اختبار نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
