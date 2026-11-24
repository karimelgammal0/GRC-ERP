// سلامة البيانات: مرتجع الشراء بالمتوسط (H4) + منع إلغاء سلفة اتخصمت (H3)
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, AppError, initSchema, insertRow } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js');
const { saveDoc, voidDoc } = await import('../server/lib/docs.js');
await seedAll();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const U = { id: 1, username: 'test' };
const bal = async (code) => Number(await val(`SELECT COALESCE(SUM(l.debit-l.credit),0) FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code=?`, code));

console.log('▶ H4: مرتجع الشراء بسعر مختلف عن المتوسط');
const sup = await insertRow('suppliers', { code: 'S-T1', name: 'مورد' }, ['code', 'name']);
const unit = await val('SELECT id FROM units ORDER BY id LIMIT 1') || await insertRow('units', { code: 'U-T', name: 'وحدة' }, ['code', 'name']);
const mat = await insertRow('materials', { code: 'M-T1', name: 'صنف مرتجع', unit_id: unit }, ['code', 'name', 'unit_id']);
const wh = await val('SELECT id FROM warehouses ORDER BY id LIMIT 1');
await saveDoc('goods_receipt', { date: '2026-11-05', supplier_id: sup, warehouse_id: wh, payment_type: 'credit', lines: [{ material_id: mat, qty: 20, unit_price: 10 }] }, null, U);
const ret = await saveDoc('purchase_return', { date: '2026-11-06', supplier_id: sup, warehouse_id: wh, lines: [{ material_id: mat, qty: 5, unit_price: 30 }] }, null, U);
const st = await get('SELECT qty,value,avg_cost FROM material_stock WHERE material_id=?', mat);
ok(Number(st.qty) === 15 && Number(st.value) === 150 && Number(st.avg_cost) === 10, `المتوسط فضل 10 (qty=${st.qty} value=${st.value} avg=${st.avg_cost})`);
ok(await bal('1221') === 150, 'المخزن (1221) = 150 = قيمة المخزون');
ok(await bal('2110') === -50, 'الموردين = 200 − 150 (سعر المورد للمرتجع)');
ok(await bal('5300') === -100, 'فرق السعر (100) خفّض التكلفة غير المباشرة');
const tb = await get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); ok(Number(tb.d) === Number(tb.c), 'القيود متوازنة');
await voidDoc('purchase_return', ret.id ?? ret, U);
const st2 = await get('SELECT qty,value FROM material_stock WHERE material_id=?', mat);
ok(Number(st2.qty) === 20 && Number(st2.value) === 200 && await bal('5300') === 0 && await bal('2110') === -200, 'إلغاء المرتجع رجّع كل حاجة');

console.log('▶ H3: سلفة عامل اتخصمت من كشف يومية');
const [s1] = (await all('SELECT id FROM stages ORDER BY seq LIMIT 1')).map((x) => x.id);
const emp = await insertRow('employees', { code: 'E-T9', name: 'عامل سلفة', emp_type: 'daily', cost_class: 'direct', daily_rate: 200 }, ['code', 'name', 'emp_type', 'cost_class', 'daily_rate']);
const tre = await val('SELECT id FROM treasuries ORDER BY id LIMIT 1');
const adv = await saveDoc('labor_advance', { date: '2026-11-07', treasury_id: tre, lines: [{ employee_id: emp, amount: 100 }] }, null, U);
const sh = await saveDoc('labor_sheet', { date: '2026-11-10', period_from: '2026-11-01', period_to: '2026-11-10', lines: [{ employee_id: emp, days: 3, stage_id: s1, advance: 100 }] }, null, U);
let err = null; try { await voidDoc('labor_advance', adv.id ?? adv, U); } catch (e) { err = e; }
ok(err instanceof AppError && /اتخصم/.test(err.message), 'منع إلغاء السلفة بعد خصمها: ' + (err?.message || 'اتلغت!'));
ok(await bal('1232') === 0, 'رصيد السلف = صفر (مفيش سالب)');
await voidDoc('labor_sheet', sh.id ?? sh, U);
await voidDoc('labor_advance', adv.id ?? adv, U);
ok(await bal('1232') === 0, 'بعد إلغاء الكشف ثم السلفة: الرصيد صفر');

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); process.exit(fail ? 1 : 0);
