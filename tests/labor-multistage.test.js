// العامل الواحد في أكتر من مرحلة: أجر واحد، سلفة مرة واحدة، صافي على مستوى العامل، ومشروع اختياري
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { all, get, val, AppError, initSchema, insertRow } = await import('../server/db.js');
await initSchema();
const { seedAll } = await import('../server/lib/seed.js');
const { saveDoc } = await import('../server/lib/docs.js');
await seedAll();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const U = { id: 1, username: 'test' };
const [s1, s2] = (await all('SELECT id FROM stages ORDER BY seq LIMIT 2')).map((x) => x.id);
const emp = await insertRow('employees', { code: 'E-T1', name: 'عامل تجربة', emp_type: 'daily', cost_class: 'direct', daily_rate: 200 }, ['code', 'name', 'emp_type', 'cost_class', 'daily_rate']);
const sh = await saveDoc('labor_sheet', { date: '2026-11-24', period_from: '2026-11-01', period_to: '2026-11-15', lines: [
  { employee_id: emp, days: 3, stage_id: s1, advance: 100 },
  { employee_id: emp, days: 2, ot_days: 1, stage_id: s2, advance: 50, rate: 999, other_additions: 30, other_deductions: 10 },
] }, null, U);
const id = sh.id ?? sh;
const ls = await all('SELECT * FROM labor_sheet_lines WHERE sheet_id=? ORDER BY id', id);
ok(ls.length === 2 && ls.every((l) => Number(l.rate) === 200), 'نفس الأجر على كل أسطر العامل');
ok(Number(ls[0].advance) === 150 && Number(ls[1].advance) === 0 && Number(ls[0].other_additions) === 30 && Number(ls[1].other_additions) === 0 && Number(ls[0].other_deductions) === 10, 'السلفة والإضافات والخصومات مجمّعة على أول سطر');
ok(Number(await val('SELECT total FROM labor_sheets WHERE id=?', id)) === 1070, 'إجمالي الكشف = 6 أيام × 200 + 30 − 10 − 150');
const cl = await all(`SELECT stage_id, amount FROM cost_lines WHERE source_type='labor' AND source_id=? ORDER BY id`, id);
ok(cl.length === 2 && Number(cl[0].amount) === 630 && Number(cl[1].amount) === 600 && cl[0].stage_id !== cl[1].stage_id, 'تكلفة كل مرحلة منفصلة، ومن غير مشروع');
const jl = await all('SELECT j.debit, j.credit FROM journal_lines j JOIN journal_entries e ON e.id=j.entry_id WHERE e.source_type=? AND e.source_id=?', 'labor', id);
ok(jl.reduce((a, x) => a + Number(x.debit) - Number(x.credit), 0) === 0 && jl.every((x) => Number(x.debit) >= 0 && Number(x.credit) >= 0), 'القيد متزن');
console.log(`labor-multistage: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
