import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, val, tx, insertRow, updateRow, AppError, r2 } from '../db.js';
import { allSettings, setSetting, ACC_KEYS, audit, getSetting, DEFAULT_SEQUENCES } from '../lib/core.js';
import { applyOpening, lockOpening, unlockOpening, openingLocked } from '../lib/opening.js';
import { MASTERS, withLinks } from './masters.js';
import { hashPassword, checkPassword } from '../lib/seed.js';
import { COST_CLASS, VOUCHER_KINDS } from '../lib/docs.js';

export const MODULES = [
  ['dashboard', 'لوحة التحكم'], ['settings', 'الإعدادات'], ['inventory', 'مخازن المواد الخام'], ['purchases', 'المشتريات'],
  ['hr', 'الموارد البشرية'], ['finance', 'الإدارة المالية'], ['accounts', 'الحسابات'], ['reports', 'التقارير'],
  ['perm_add_items', 'صلاحية: إضافة بنود المشروعات من شاشة الصرف'],
];
const adminOnly = (req) => { if (req.user.role !== 'admin') throw new AppError('للمدير فقط', 403); };

export async function authRoutes() {
  const r = Router();
  await r.post('/login', async (req, res) => {
    const u = await get('SELECT * FROM users WHERE username=? AND active=1', String(req.body.username || '').trim());
    if (!u || !checkPassword(String(req.body.password || ''), u.pass_hash)) throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
    const token = crypto.randomBytes(24).toString('hex');
    await run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, u.id);
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
    await audit(u, 'login', 'users', u.id);
    res.json({ ok: true });
  });
  return r;
}

export async function systemRouter() {
  const r = Router();
  await r.post('/logout', async (req, res) => { await run('DELETE FROM sessions WHERE token=?', req.token); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
  r.get('/me', (req, res) => { const { pass_hash, ...u } = req.user; res.json({ ...u, modules: JSON.parse(u.modules || '[]') }); });
  await r.post('/change-password', async (req, res) => {
    const { old_password, new_password } = req.body;
    if (!checkPassword(String(old_password || ''), req.user.pass_hash)) throw new AppError('كلمة المرور الحالية غير صحيحة');
    if (String(new_password || '').length < 6) throw new AppError('كلمة المرور الجديدة قصيرة (6 أحرف على الأقل)');
    await run('UPDATE users SET pass_hash=?, must_change=0 WHERE id=?', hashPassword(new_password), req.user.id); res.json({ ok: true });
  });

  // تعريفات تستعملها الواجهة لبناء الشاشات
  r.get('/meta', async (req, res) => res.json({
    masters: MASTERS, modules: MODULES, cost_class: COST_CLASS, voucher_kinds: VOUCHER_KINDS, acc_keys: ACC_KEYS,
    settings: await allSettings(), opening_locked: await openingLocked(),
  }));
  r.get('/lookups', async (req, res) => {
    // بالتوازي: ~25 استعلام ورا بعض كانوا بيضربوا زمن الذهاب والإياب لقاعدة البيانات في كل مرة
    const jobs = [...Object.entries(MASTERS).map(([k, M]) => [k, `SELECT * FROM ${M.table} ORDER BY code`]),
      ['accounts', 'SELECT id,code,name,type,postable,active,parent_id FROM accounts ORDER BY code'],
      ['periods', 'SELECT * FROM fiscal_periods ORDER BY start_date']];
    const rows = await Promise.all(jobs.map(([, q]) => all(q)));
    const out = Object.fromEntries(jobs.map(([k], i) => [k, rows[i]]));
    out.warehouses = await withLinks('warehouses', out.warehouses);
    res.json(out);
  });

  // ----- إعدادات عامة وربط الحسابات والترقيم -----
  r.put('/settings', async (req, res) => {
    adminOnly(req);
    const ok = ['company_name', 'currency', 'opening_date', 'allow_negative_stock', ...Object.keys(ACC_KEYS)];
    for (const [k, v] of Object.entries(req.body)) {
      if (!ok.includes(k)) continue;
      if (k === 'opening_date' && await openingLocked()) throw new AppError('الأرصدة الافتتاحية مقفلة');
      if (k.startsWith('acc_')) { const a = await get('SELECT postable FROM accounts WHERE id=?', Number(v)); if (!a || !a.postable) throw new AppError(`اختر حساب فرعي لـ «${ACC_KEYS[k]}»`); }
      await setSetting(k, v);
    }
    await audit(req.user, 'settings', 'settings', 0, Object.keys(req.body)); res.json(await allSettings());
  });
  r.get('/sequences', async (req, res) => { const ord = DEFAULT_SEQUENCES.map((x) => x[0]); const rows = await all('SELECT * FROM sequences'); res.json(rows.sort((a, b) => (ord.indexOf(a.key) + 1 || 999) - (ord.indexOf(b.key) + 1 || 999) || a.key.localeCompare(b.key))); });
  r.put('/sequences/:key', async (req, res) => {
    adminOnly(req);
    const b = req.body; const cur = await get('SELECT * FROM sequences WHERE key=?', req.params.key); if (!cur) throw new AppError('غير موجود', 404);
    await run('UPDATE sequences SET prefix=?, padding=?, next_no=? WHERE key=?', String(b.prefix ?? cur.prefix), Math.min(10, Math.max(1, Number(b.padding ?? cur.padding))), Math.max(1, Number(b.next_no ?? cur.next_no)), req.params.key);
    res.json(await get('SELECT * FROM sequences WHERE key=?', req.params.key));
  });

  // ----- الأرصدة الافتتاحية -----
  r.get('/opening', async (req, res) => res.json({
    locked: await openingLocked(), date: await getSetting('opening_date'),
    applied: !!await get(`SELECT 1 FROM journal_entries WHERE source_type='opening'`),
    stock: await all(`SELECT m.id material_id, m.code, m.name, u.name unit, COALESCE(o.qty,0) qty, COALESCE(o.value,0) value, o.source, o.note
                FROM materials m JOIN units u ON u.id=m.unit_id LEFT JOIN opening_stock o ON o.material_id=m.id WHERE m.active=1 ORDER BY m.code`),
    suppliers: await all('SELECT id, code, name, opening_balance FROM suppliers WHERE active=1 ORDER BY code'),
    treasuries: await all('SELECT id, code, name, opening_balance FROM treasuries WHERE active=1 ORDER BY code'),
    custodians: await all('SELECT id, code, name, opening_balance FROM custodians WHERE active=1 ORDER BY code'),
  }));
  r.put('/opening', async (req, res) => {
    adminOnly(req);
    if (await openingLocked()) throw new AppError('الأرصدة الافتتاحية مقفلة');
    await tx(async () => {
      const b = req.body;
      for (const s of b.stock || []) {
        const qty = Number(s.qty) || 0, value = Number(s.value) || 0;
        if (qty < 0 || value < 0) throw new AppError('الكمية والقيمة الافتتاحية لا يمكن أن تكون سالبة');
        if (qty === 0 && value > 0) throw new AppError('قيمة بدون كمية — صحّح الصف');
        await run(`INSERT INTO opening_stock(material_id,qty,value,source,note) VALUES(?,?,?,?,?)
             ON CONFLICT(material_id) DO UPDATE SET qty=excluded.qty, value=excluded.value, source=CASE WHEN excluded.source IS NOT NULL THEN excluded.source ELSE source END`,
          s.material_id, qty, r2(value), s.source ?? 'معدّل يدوياً', s.note ?? null);
      }
      for (const [key, table] of [['suppliers', 'suppliers'], ['treasuries', 'treasuries'], ['custodians', 'custodians']])
        for (const x of b[key] || []) await run(`UPDATE ${table} SET opening_balance=? WHERE id=?`, r2(Number(x.opening_balance) || 0), x.id);
      if (b.date) await setSetting('opening_date', b.date);
    });
    res.json({ ok: true });
  });
  await r.post('/opening/apply', async (req, res) => { adminOnly(req); res.json(await applyOpening(req.user)); });
  await r.post('/opening/lock', async (req, res) => { adminOnly(req); await lockOpening(req.user); res.json({ ok: true }); });
  await r.post('/opening/unlock', async (req, res) => { adminOnly(req); await unlockOpening(req.user); res.json({ ok: true }); });

  // ----- المستخدمون -----
  r.get('/users', async (req, res) => { adminOnly(req); res.json((await all('SELECT id,username,name,role,modules,active FROM users ORDER BY id')).map((u) => ({ ...u, modules: JSON.parse(u.modules) }))); });
  await r.post('/users', async (req, res) => {
    adminOnly(req); const b = req.body;
    if (!b.username || !b.name || String(b.password || '').length < 6) throw new AppError('الاسم واسم المستخدم وكلمة مرور (6 أحرف+) مطلوبين');
    if (await get('SELECT 1 FROM users WHERE username=?', b.username)) throw new AppError('اسم المستخدم مستخدم');
    const id = await insertRow('users', { username: b.username.trim(), name: b.name, pass_hash: hashPassword(b.password), role: b.role === 'admin' ? 'admin' : 'user', modules: JSON.stringify(b.modules || []), must_change: 1 }, ['username', 'name', 'pass_hash', 'role', 'modules', 'must_change']);
    res.json({ id });
  });
  r.put('/users/:id', async (req, res) => {
    adminOnly(req); const b = req.body; const id = Number(req.params.id);
    const o = { name: b.name, role: b.role, active: b.active === undefined ? undefined : (b.active ? 1 : 0), modules: b.modules ? JSON.stringify(b.modules) : undefined };
    if (id === req.user.id && (o.active === 0 || (o.role && o.role !== 'admin'))) throw new AppError('لا يمكنك تعطيل نفسك أو سحب صلاحيات المدير منك');
    if (b.password) { if (String(b.password).length < 6) throw new AppError('كلمة المرور قصيرة'); o.pass_hash = hashPassword(b.password); o.must_change = 1; }
    await updateRow('users', id, o, ['name', 'role', 'active', 'modules', 'pass_hash', 'must_change']); res.json({ ok: true });
  });
  r.get('/audit', async (req, res) => { adminOnly(req); res.json(await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500')); });
  return r;
}
