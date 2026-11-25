// المرحلة 3 على طبقة HTTP: الصلاحيات والمسارات والتقارير
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { app } = await import('../server/index.js');
const { run, insertRow, get, all, val } = await import('../server/db.js');
const http = await import('node:http');
const server = http.createServer(app).listen(0); await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const call = async (method, path, body, cookie) => {
  const r = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j, cookie: sc ? sc.split(';')[0] : null };
};
await run('UPDATE users SET must_change=0');
let r = await call('POST', '/login', { username: 'admin', password: 'admin123' }); const A = r.cookie; ok(!!A, 'دخول');

console.log('▶ التكويد والإعدادات');
r = await call('GET', '/lookups', null, A);
ok(Array.isArray(r.json.deduction_types) && Array.isArray(r.json.fg_materials), 'lookups فيها الخصومات والمنتج التام');
const acc1234 = await val(`SELECT id FROM accounts WHERE code='1234'`);
r = await call('POST', '/m/deduction_types', { name: 'محتجز ضمان', kind: 'deduction', method: 'percent', value: 5, account_id: acc1234 }, A);
ok(r.status === 200 && r.json.code?.startsWith('DED-'), 'تكويد خصم: ' + JSON.stringify(r.json));
r = await call('PUT', '/settings', { profit_pct: 12 }, A); ok(r.status === 200 && r.json.profit_pct === '12', 'نسبة الربح');
r = await call('PUT', '/settings', { profit_pct: -3 }, A); ok(r.status === 400, 'نسبة ربح سالبة مرفوضة');
r = await call('GET', '/meta', null, A); ok(r.json.catalog.some((m) => m.id === 'sales') && r.json.catalog.some((m) => m.id === 'production'), 'الكتالوج فيه الموديولين');

console.log('▶ المسارات');
const prj = await insertRow('projects', { code: 'PRJ-H1', name: 'مشروع اتش' }, ['code', 'name']);
const unit = await val('SELECT id FROM units LIMIT 1');
r = await call('POST', '/m/project_items', { project_id: prj, name: 'بند اتش', unit_id: unit, area_m2: 2.25, kind: 'GRC' }, A); ok(r.status === 200 && Number(r.json.area_m2) === 2.25, 'بند بمتر مسطح');
const item = r.json.id;
r = await call('POST', '/doc/production_log', { date: '2026-06-10', project_id: prj, lines: [{ item_id: item, qty: 4 }] }, A); ok(r.status === 200 && r.json.no?.startsWith('PRD-'), 'تسجيل إنتاج');
r = await call('GET', '/doc/production_log?from=2026-06-01&to=2026-06-30', null, A); ok(r.status === 200 && r.json.length === 1 && Number(r.json[0].meters) === 9, 'قائمة الإنتاج بالأمتار');
r = await call('GET', '/costs/runs?month=2026-06', null, A); ok(r.status === 200 && r.json.length === 1 && r.json[0].status === 'new', 'نظرة الشهر');
r = await call('GET', `/costs/run?month=2026-06&project_id=${prj}`, null, A); ok(r.status === 200 && r.json.problems.length > 0, 'التشغيل فيه تنبيه سعر المتر');
r = await call('POST', '/costs/run/approve', { month: '2026-06', project_id: prj }, A); ok(r.status === 400, 'اعتماد قبل سعر المتر مرفوض');
r = await call('GET', '/p3/availability?project_id=' + prj, null, A); ok(r.status === 200 && Array.isArray(r.json), 'الرصيد المتاح');
r = await call('GET', '/reports/quantities?month=2026-06', null, A); ok(r.status === 200 && r.json.length === 1 && r.json[0].in_month === 4, 'تقرير الكميات');
r = await call('GET', '/reports/client-balances', null, A); ok(r.status === 200 && r.json.rows, 'أرصدة العملاء');
r = await call('GET', '/reports/profitability', null, A); ok(r.status === 200 && r.json.rows, 'الربحية');
r = await call('GET', '/reports/income-summary', null, A); ok(r.status === 200 && 'gross_profit' in r.json, 'قائمة الدخل فيها مجمل الربح');
r = await call('GET', '/reports/stock-balances', null, A); ok(r.status === 200 && !r.json.rows.some((x) => String(x.code).startsWith('FG-')), 'أرصدة الأصناف من غير المنتج التام');

console.log('▶ الصلاحيات');
const hash = (await get('SELECT pass_hash FROM users WHERE username=?', 'admin')).pass_hash;
const uid = await insertRow('users', { username: 'plain', name: 'عادي', pass_hash: hash, role: 'user', must_change: 0 }, ['username', 'name', 'pass_hash', 'role', 'must_change']);
r = await call('POST', '/login', { username: 'plain', password: 'admin123' }); const B = r.cookie;
for (const [m, p, b] of [['GET', '/doc/production_log'], ['GET', '/doc/delivery_note'], ['GET', '/doc/client_certificate'], ['GET', '/costs/runs?month=2026-06'], ['GET', '/p3/availability?project_id=1'], ['GET', '/reports/client-balances'], ['GET', '/reports/profitability'], ['GET', '/reports/quantities?month=2026-06'],
  ['POST', '/doc/production_log', { date: '2026-06-10', project_id: prj, lines: [{ item_id: item, qty: 1 }] }], ['POST', '/costs/run/approve', { month: '2026-06', project_id: prj }]]) {
  r = await call(m, p, b, B); ok(r.status === 403, `${m} ${p} ممنوع بدون صلاحية (${r.status})`);
}
console.log('▶ نوع المنتج التام');
r = await call('GET', '/m/finished_types', null, A); ok(r.status === 200 || r.status === 404, 'مسار الأنواع');
r = await call('GET', '/lookups', null, A); ok(Array.isArray(r.json.finished_types) && r.json.finished_types.map((x) => x.name).sort().join() === 'GRC,GRP', 'GRC وGRP متكوّدين تلقائياً');
r = await call('POST', '/m/finished_types', { name: 'grc' }, A); ok(r.status === 400, 'اسم مكرر مرفوض (حتى بحروف مختلفة)');
r = await call('POST', '/m/finished_types', { name: 'GRG' }, A); ok(r.status === 200 && r.json.code?.startsWith('FGT-'), 'كود نوع جديد: ' + JSON.stringify(r.json)); const grg = r.json.id;
r = await call('POST', '/m/project_items', { project_id: prj, name: 'بند جي', unit_id: unit, area_m2: 1, kind: 'ZZZ' }, A); ok(r.status === 400, 'بند بنوع غير متكوّد مرفوض');
r = await call('POST', '/m/project_items', { project_id: prj, name: 'بند جي ٢', unit_id: unit, area_m2: 1, kind: 'GRG' }, A); ok(r.status === 200 && r.json.kind === 'GRG', 'بند بالنوع الجديد');
r = await call('PUT', `/m/finished_types/${grg}`, { name: 'GRG2' }, A); ok(r.status === 400, 'مينفعش تغيير اسم نوع مستخدم');
r = await call('DELETE', `/m/finished_types/${grg}`, null, A); ok(r.status === 200 && r.json.deactivated === true, 'الحذف لنوع مستخدم بيعطّله');
r = await call('GET', '/costs/sheet?month=2026-06&kind=GRG', null, A); ok(r.status === 400, 'نوع معطّل مرفوض في تكلفة المتر');
console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); server.close(); process.exit(fail ? 1 : 0);
