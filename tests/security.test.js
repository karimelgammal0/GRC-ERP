// اختبار طبقة HTTP: الطابور، تغيير كلمة المرور الإجباري، حد المحاولات، صلاحيات القراءة
process.env.DATABASE_URL = ''; process.env.PGLITE_MEMORY = '1'; process.env.NO_LISTEN = '1';
const { app } = await import('../server/index.js');
const { run, insertRow, get } = await import('../server/db.js');
const { hashPassword } = await import('../server/lib/seed.js');
const http = await import('node:http');

const server = http.createServer(app).listen(0); await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const call = async (method, path, body, cookie) => {
  const r = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j, cookie: sc ? sc.split(';')[0] : null, setCookie: sc };
};

console.log('▶ تسجيل الدخول وتغيير كلمة المرور الإجباري');
let r = await call('POST', '/login', { username: 'admin', password: 'admin123' });
ok(r.status === 200 && r.cookie, 'دخول الافتراضي');
const adminCookie = r.cookie;
r = await call('GET', '/m/units', null, adminCookie);
ok(r.status === 403 && r.json?.must_change === true, 'الطلبات محظورة قبل تغيير كلمة المرور: ' + r.status);
r = await call('GET', '/me', null, adminCookie); ok(r.status === 200, '/me مسموح');
r = await call('POST', '/change-password', { old_password: 'admin123', new_password: 'Strong#123' }, adminCookie); ok(r.status === 200, 'تغيير كلمة المرور');
r = await call('GET', '/m/units', null, adminCookie); ok(r.status === 200, 'بعد التغيير الطلبات تشتغل');

console.log('▶ حد محاولات الدخول');
let last;
for (let i = 0; i < 8; i++) last = await call('POST', '/login', { username: 'ghost', password: 'x' });
ok(last.status === 401, 'المحاولة 8 لسه 401');
last = await call('POST', '/login', { username: 'ghost', password: 'x' });
ok(last.status === 429, 'بعد 8 محاولات: 429 — got ' + last.status);
r = await call('POST', '/login', { username: 'admin', password: 'Strong#123' }); ok(r.status === 200, 'مستخدم تاني مش متأثر');

console.log('▶ الطابور: عميل فصل وهو مستني');
{
  const { writeQueue } = await import('../server/lib/queue.js');
  const express = (await import('express')).default;
  const qa = express(); qa.use(writeQueue());
  const log = [];
  qa.post('/slow', (req, res) => setTimeout(() => { log.push('slow'); res.json({ ok: 1 }); }, 400));
  qa.post('/fast', (req, res) => { log.push('fast'); res.json({ ok: 1 }); });
  const qs = http.createServer(qa).listen(0); await new Promise((r) => qs.on('listening', r));
  const qb = `http://127.0.0.1:${qs.address().port}`;
  const p1 = fetch(qb + '/slow', { method: 'POST' });                       // بيمسك الدور
  await new Promise((r) => setTimeout(r, 50));
  const ctrl = new AbortController();
  const p2 = fetch(qb + '/fast', { method: 'POST', signal: ctrl.signal }).catch(() => {});  // مستني في الطابور
  await new Promise((r) => setTimeout(r, 50)); ctrl.abort(); await p2;      // العميل فصل
  const p3 = Promise.race([fetch(qb + '/fast', { method: 'POST' }).then((r) => r.status), new Promise((r) => setTimeout(() => r('HUNG'), 3000))]);
  ok((await p1).status === 200, 'الطلب البطيء خلص');
  ok(await p3 === 200, 'الطلب بعد فصل المستني اتنفّذ (مش HUNG)');
  ok(log.join(',') === 'slow,fast', 'الترتيب محفوظ والمفصول ما اتنفّذش: ' + log.join(','));
  qs.close();
}

console.log('▶ صلاحيات القراءة');
const uid = await insertRow('users', { username: 'viewer', name: 'مشاهد', pass_hash: hashPassword('Viewer#123'), role: 'user', perms: JSON.stringify(['inventory.balances']), modules: JSON.stringify(['inventory']), must_change: 0 }, ['username', 'name', 'pass_hash', 'role', 'perms', 'modules', 'must_change']);
await insertRow('employees', { code: 'E-T1', name: 'عامل اختبار', emp_type: 'daily', daily_rate: 300, monthly_salary: 9000 }, ['code', 'name', 'emp_type', 'daily_rate', 'monthly_salary']);
r = await call('POST', '/login', { username: 'viewer', password: 'Viewer#123' }); const vc = r.cookie; ok(!!vc, 'دخول المشاهد');
r = await call('GET', '/m/employees', null, vc); ok(r.status === 200 && r.json.every((e) => e.monthly_salary === 0 && e.daily_rate === 0), 'المرتبات مخفية عن المشاهد');
r = await call('GET', '/lookups', null, vc); ok(r.json.employees.every((e) => e.monthly_salary === 0), '/lookups بتخفي المرتبات');
r = await call('GET', '/helpers/employee-rates', null, vc); ok(r.status === 200 && r.json.every((e) => e.monthly_salary === 0), 'employee-rates بتخفي المرتبات');
r = await call('GET', '/reports/dashboard', null, vc); ok(r.status === 403, 'لوحة التحكم محتاجة صلاحية: ' + r.status);
r = await call('GET', '/m/employees', null, adminCookie); ok(r.json.some((e) => e.monthly_salary === 9000), 'المدير يشوف المرتبات');
await run('UPDATE users SET perms=?, modules=? WHERE id=?', JSON.stringify(['dashboard']), JSON.stringify(['dashboard']), uid);
r = await call('GET', '/helpers/employee-rates', null, vc); ok(r.status === 403, 'helpers محتاجة موديول مستندات: ' + r.status);

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
server.close(); process.exit(fail ? 1 : 0);
