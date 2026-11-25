// مسودات شاشات الإدخال: حفظ/تحديث/عرض/حذف، وعزلها بين المستخدمين والصلاحيات
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { app } = await import('../server/index.js');
const { run, insertRow, get, val } = await import('../server/db.js');
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
let r = await call('POST', '/login', { username: 'admin', password: 'admin123' }); const A = r.cookie;
const scope = 'stock_adjustment|inventory.adjustments';

console.log('▶ المسودات');
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, A); ok(r.status === 200 && r.json.length === 0, 'قائمة فاضية في الأول');
r = await call('POST', '/doc/drafts', { scope, summary: '2 بند', payload: { date: '2026-11-25', warehouse_id: 1, lines: [{ material_id: 5, counted_qty: 3 }] } }, A);
ok(r.status === 200 && r.json.id > 0, 'حفظ مسودة جديدة'); const d1 = r.json.id;
r = await call('POST', '/doc/drafts', { id: d1, scope, summary: '3 بند', payload: { date: '2026-11-25', lines: [{ material_id: 5 }, { material_id: 6 }, { material_id: 7 }] } }, A);
ok(r.status === 200 && r.json.id === d1, 'التحديث بيحافظ على نفس المسودة');
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, A);
ok(r.json.length === 1 && r.json[0].summary === '3 بند' && r.json[0].payload.lines.length === 3, 'العرض بالمحتوى المحدّث');
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent('stock_issue|inventory.issues')}`, null, A); ok(r.json.length === 0, 'كل شاشة ليها مسوداتها');
r = await call('POST', '/doc/drafts', { scope: 'نوع_غلط|x', payload: {} }, A); ok(r.status === 404, 'نوع مستند غير معروف مرفوض');

const hash = (await get('SELECT pass_hash FROM users WHERE username=?', 'admin')).pass_hash;
await insertRow('users', { username: 'u2', name: 'يوزر', pass_hash: hash, role: 'user', must_change: 0, perms: JSON.stringify(['inventory.adjustments', 'inventory.adjustments.create']), modules: JSON.stringify(['inventory']) }, ['username', 'name', 'pass_hash', 'role', 'must_change', 'perms', 'modules']);
await insertRow('users', { username: 'u3', name: 'بدون', pass_hash: hash, role: 'user', must_change: 0, perms: JSON.stringify(['hr.labor']), modules: JSON.stringify(['hr']) }, ['username', 'name', 'pass_hash', 'role', 'must_change', 'perms', 'modules']);
r = await call('POST', '/login', { username: 'u2', password: 'admin123' }); const B = r.cookie;
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, B); ok(r.status === 200 && r.json.length === 0, 'المستخدم مبيشوفش مسودات غيره');
r = await call('POST', '/doc/drafts', { id: d1, scope, summary: 'تعديل غيره', payload: { x: 1 } }, B); const d2 = r.json?.id;
ok(r.status === 200 && d2 !== d1, 'تحديث مسودة مستخدم تاني بيعمل مسودة جديدة مش بيكتب فوقها');
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, A); ok(r.json.length === 1 && r.json[0].summary === '3 بند', 'مسودة الأدمن سليمة');
r = await call('DELETE', `/doc/drafts/${d1}`, null, B); r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, A); ok(r.json.length === 1, 'مستخدم تاني مبيقدرش يحذف مسودتي');
r = await call('POST', '/login', { username: 'u3', password: 'admin123' }); const C = r.cookie;
r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, C); ok(r.status === 403, 'بدون صلاحية الموديول ممنوع');
r = await call('DELETE', `/doc/drafts/${d1}`, null, A); r = await call('GET', `/doc/drafts?scope=${encodeURIComponent(scope)}`, null, A); ok(r.json.length === 0, 'حذف المسودة');
console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); server.close(); process.exit(fail ? 1 : 0);
