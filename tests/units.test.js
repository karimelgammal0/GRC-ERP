// اختبار الوحدات الفرعية ومعدل التحويل: الشيكارة = 50 كجم
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { initSchema, insertRow, get, AppError } = await import('../server/db.js');
await initSchema();
const { checkUnitConversion } = await import('../server/routes/masters.js');
const { entryUnits, toBaseQty } = await import('../public/js/units.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const throws = async (fn, re, m) => { try { await fn(); ok(false, `${m} — expected error`); } catch (e) { ok(e instanceof AppError && re.test(e.message), `${m} — got: ${e.message}`); } };

const kg = await insertRow('units', { code: 'U-KG', name: 'كجم' }, ['code', 'name']);
const bag = await insertRow('units', { code: 'U-BAG', name: 'شيكارة' }, ['code', 'name']);
const ton = await insertRow('units', { code: 'U-TON', name: 'طن' }, ['code', 'name']);

console.log('▶ التحقق عند الحفظ');
const o1 = { sub_unit_id: kg, sub_factor: 50 }; await checkUnitConversion(o1, bag); ok(true, 'شيكارة = 50 كجم مقبول');
await throws(() => checkUnitConversion({ sub_unit_id: kg }, bag), /معاً/, 'وحدة فرعية من غير معدل');
await throws(() => checkUnitConversion({ sub_unit_id: kg, sub_factor: 0 }, bag), /أكبر من صفر/, 'معدل صفر');
await throws(() => checkUnitConversion({ sub_unit_id: kg, sub_factor: -3 }, bag), /أكبر من صفر/, 'معدل سالب');
await throws(() => checkUnitConversion({ sub_unit_id: bag, sub_factor: 2 }, bag), /نفس الوحدة/, 'وحدة فرعية = نفسها');
await throws(() => checkUnitConversion({ sub_unit_id: 99999, sub_factor: 2 }, bag), /غير موجودة/, 'وحدة فرعية غير موجودة');
const o2 = { name: 'x' }; await checkUnitConversion(o2, kg); ok(o2.sub_unit_id === null && o2.sub_factor === null, 'من غير فرعية = null');

await get('SELECT 1');
await (await import('../server/db.js')).run('UPDATE units SET sub_unit_id=?, sub_factor=? WHERE id=?', kg, 50, bag);
await throws(() => checkUnitConversion({ sub_unit_id: bag, sub_factor: 0.02 }, kg), /دائري/, 'تحويل دائري شيكارة↔كجم');
await (await import('../server/db.js')).run('UPDATE units SET sub_unit_id=?, sub_factor=? WHERE id=?', kg, 1000, ton);

console.log('▶ وحدات الإدخال');
const units = (await (await import('../server/db.js')).all('SELECT * FROM units ORDER BY id'));
const kgOpts = entryUnits(units, kg);                       // خامة بالكيلو → تقدر تدخل بالشيكارة والطن
ok(kgOpts[0].id === kg && kgOpts[0].toBase === 1, 'وحدة الخامة أولاً');
ok(kgOpts.find((o) => o.id === bag)?.toBase === 50 && kgOpts.find((o) => o.id === ton)?.toBase === 1000, 'شيكارة=50 وطن=1000 لخامة بالكيلو');
const bagOpts = entryUnits(units, bag);                      // خامة بالشيكارة → تقدر تدخل بالكيلو
ok(bagOpts.length === 2 && bagOpts[1].id === kg && Math.abs(bagOpts[1].toBase - 0.02) < 1e-12, 'خامة بالشيكارة: كجم = 1/50');
ok(entryUnits(units, 99999).length === 0, 'خامة بوحدة غير موجودة');
ok(toBaseQty(3, 50) === 150, '3 شيكارة = 150 كجم');
ok(toBaseQty(125, 1 / 50) === 2.5, '125 كجم = 2.5 شيكارة');
ok(toBaseQty(0.3, 3) === 0.9, 'من غير ضجيج الفاصلة العائمة');
ok(toBaseQty('', 50) === 0 || toBaseQty('abc', 50) === null, 'مدخل غير صالح');

console.log(`\n${fail ? '✗' : '✓'} الوحدات: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
