import { Router } from 'express';
import { all, get, run, val, tx, insertRow, updateRow, AppError, r2 } from '../db.js';
import { audit, assertOpenPeriod } from '../lib/core.js';
import { postJournal } from '../lib/gl.js';
import { chartRows, applyChart } from '../lib/coa.js';
import { MODULES, loadTemplates } from '../lib/templates.js';

export async function accountsRouter() {
  const r = Router();
  // ----- دليل الحسابات -----
  // استيراد دليل الحسابات من CSV (نفس شكل التصدير): تحديث/إضافة بالكود — مفيش حذف
  r.post('/accounts/import', async (req, res) => {
    if (req.user.role !== 'admin') throw new AppError('الاستيراد للمدير فقط', 403);
    const rows = chartRows(String(req.body.csv || ''));
    const out = await applyChart(rows, {}); await audit(req.user, 'import', 'accounts', null, out);
    res.json(out);
  });
  r.get('/accounts', async (req, res) => res.json(await all('SELECT * FROM accounts ORDER BY code')));
  await r.post('/accounts', async (req, res) => {
    const b = req.body;
    if (!b.code || !b.name || !b.type) throw new AppError('الكود والاسم والنوع مطلوبين');
    if (await get('SELECT 1 FROM accounts WHERE code=?', b.code)) throw new AppError('كود الحساب مستخدم');
    if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(b.type)) throw new AppError('نوع الحساب غير صحيح');
    if (b.parent_id) {
      const p = await get('SELECT * FROM accounts WHERE id=?', b.parent_id);
      if (!p) throw new AppError('الحساب الرئيسي غير موجود');
      if (p.postable && await val('SELECT COUNT(*) FROM journal_lines WHERE account_id=?', p.id)) throw new AppError('الحساب الرئيسي عليه حركات');
    }
    const id = await insertRow('accounts', { ...b, postable: b.postable ? 1 : 0 }, ['code', 'name', 'parent_id', 'type', 'postable']);
    if (b.parent_id) await run('UPDATE accounts SET postable=0 WHERE id=?', b.parent_id);
    await audit(req.user, 'create', 'accounts', id); res.json(await get('SELECT * FROM accounts WHERE id=?', id));
  });
  r.put('/accounts/:id', async (req, res) => {
    const id = Number(req.params.id); const b = req.body;
    if (b.code && await get('SELECT 1 FROM accounts WHERE code=? AND id<>?', b.code, id)) throw new AppError('كود الحساب مستخدم');
    if (b.postable === 0 || b.postable === false) if (await val('SELECT COUNT(*) FROM journal_lines WHERE account_id=?', id)) throw new AppError('الحساب عليه حركات ولا يمكن تحويله لرئيسي');
    await updateRow('accounts', id, { ...b, postable: b.postable === undefined ? undefined : (b.postable ? 1 : 0), active: b.active === undefined ? undefined : (b.active ? 1 : 0) }, ['code', 'name', 'type', 'postable', 'active', 'parent_id']);
    res.json(await get('SELECT * FROM accounts WHERE id=?', id));
  });
  r.delete('/accounts/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (await val('SELECT COUNT(*) FROM journal_lines WHERE account_id=?', id) || await val('SELECT COUNT(*) FROM accounts WHERE parent_id=?', id)
      || await val(`SELECT COUNT(*) FROM settings WHERE key LIKE 'acc_%' AND value=?`, String(id)) || await val('SELECT COUNT(*) FROM stages WHERE account_id=?', id) || await val('SELECT COUNT(*) FROM treasuries WHERE account_id=?', id))
      throw new AppError('الحساب مستخدم (حركات/فروع/ربط) ولا يمكن حذفه — عطّله بدلاً من ذلك');
    await run('DELETE FROM accounts WHERE id=?', id); res.json({ deleted: true });
  });

  // ----- الفترات المالية -----
  r.get('/periods', async (req, res) => res.json(await all('SELECT * FROM fiscal_periods ORDER BY start_date')));
  await r.post('/periods/generate', async (req, res) => {
    const y = Number(req.body.year); if (!(y >= 2000 && y <= 2100)) throw new AppError('سنة غير صحيحة');
    const mon = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    let n = 0;
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0'); const s = `${y}-${mm}-01`;
      if (await get('SELECT 1 FROM fiscal_periods WHERE start_date=?', s)) continue;
      await insertRow('fiscal_periods', { name: `${mon[m - 1]} ${y}`, start_date: s, end_date: `${y}-${mm}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}` }, ['name', 'start_date', 'end_date']); n++;
    }
    res.json({ created: n });
  });
  await r.post('/periods/:id/status', async (req, res) => {
    const st = req.body.status; if (!['open', 'closed'].includes(st)) throw new AppError('حالة غير صحيحة');
    await run('UPDATE fiscal_periods SET status=? WHERE id=?', st, Number(req.params.id)); await audit(req.user, st === 'closed' ? 'close_period' : 'open_period', 'fiscal_periods', Number(req.params.id));
    res.json({ ok: true });
  });

  // ----- القيود -----
  r.get('/journals', async (req, res) => {
    const w = ['1=1']; const p = [];
    if (req.query.from) { w.push('je.date>=?'); p.push(req.query.from); } if (req.query.to) { w.push('je.date<=?'); p.push(req.query.to); }
    if (req.query.type) { w.push('je.type=?'); p.push(req.query.type); }
    if (req.query.q) { w.push('(je.no LIKE ? OR je.description LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    res.json(await all(`SELECT je.*, (SELECT SUM(debit) FROM journal_lines WHERE entry_id=je.id) total FROM journal_entries je WHERE ${w.join(' AND ')} ORDER BY je.date DESC, je.id DESC LIMIT 1000`, ...p));
  });
  r.get('/journals/:id', async (req, res) => {
    const e = await get('SELECT * FROM journal_entries WHERE id=?', Number(req.params.id)); if (!e) throw new AppError('غير موجود', 404);
    e.lines = await all(`SELECT jl.*, a.code account_code, a.name account_name FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE entry_id=? ORDER BY jl.id`, e.id);
    res.json(e);
  });
  const saveManual = async (b, user, id) => await tx(async () => {
    if (!b.date) throw new AppError('التاريخ مطلوب');
    let no = null;
    if (id) {
      const old = await get('SELECT * FROM journal_entries WHERE id=?', id);
      if (!old) throw new AppError('غير موجود', 404);
      if (old.type === 'auto') throw new AppError('القيود التلقائية تتعدّل من المستند الأصلي');
      if (old.source_type === 'opening') throw new AppError('قيد الأرصدة الافتتاحية يتولّد من الإعدادات');
      await assertOpenPeriod(old.date); no = old.no; await run('DELETE FROM journal_entries WHERE id=?', id);
    }
    const lines = (b.lines || []).filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)));
    const eid = await postJournal({ date: b.date, type: 'manual', source_type: 'manual', description: b.description || '', lines, user, no });
    await audit(user, id ? 'edit' : 'create', 'journal', eid); return eid;
  });
  await r.post('/journals', async (req, res) => res.json({ id: await saveManual(req.body, req.user, null) }));
  r.put('/journals/:id', async (req, res) => res.json({ id: await saveManual(req.body, req.user, Number(req.params.id)) }));
  r.delete('/journals/:id', async (req, res) => {
    const e = await get('SELECT * FROM journal_entries WHERE id=?', Number(req.params.id)); if (!e) throw new AppError('غير موجود', 404);
    if (e.type !== 'manual') throw new AppError('يمكن حذف القيود اليدوية فقط — التلقائي يُلغى من مستنده');
    await assertOpenPeriod(e.date); await run('DELETE FROM journal_entries WHERE id=?', e.id); await audit(req.user, 'delete', 'journal', e.id); res.json({ deleted: true });
  });

  // ----- نماذج القيود -----
  r.get('/templates', async (req, res) => res.json({ modules: MODULES, items: await loadTemplates() }));
  const saveTemplate = async (b, id, user) => await tx(async () => {
    if (!String(b.name || '').trim()) throw new AppError('اسم النموذج مطلوب');
    if (!MODULES[b.module]) throw new AppError('اختر الموديول');
    const lines = (b.lines || []).filter((l) => l.account_id);
    if (lines.length < 2) throw new AppError('النموذج لازم يحتوي على سطرين على الأقل بحسابات من الدليل');
    if (!lines.some((l) => l.side === 'debit') || !lines.some((l) => l.side === 'credit')) throw new AppError('لازم يكون في طرف مدين وطرف دائن');
    for (const l of lines) {
      if (!['debit', 'credit'].includes(l.side)) throw new AppError('الجانب لازم مدين أو دائن');
      const a = await get('SELECT * FROM accounts WHERE id=?', l.account_id);
      if (!a) throw new AppError('حساب غير موجود في الدليل');
      if (!a.postable) throw new AppError(`الحساب ${a.code} ${a.name} حساب رئيسي لا يقبل حركة`);
    }
    if (id) {
      const t = await get('SELECT * FROM journal_templates WHERE id=?', id);
      if (!t) throw new AppError('غير موجود', 404); if (t.system) throw new AppError('نماذج النظام للعرض فقط');
      await updateRow('journal_templates', id, { name: b.name.trim(), module: b.module, description: b.description || '', active: b.active === undefined ? 1 : (b.active ? 1 : 0) }, ['name', 'module', 'description', 'active']);
      await run('DELETE FROM journal_template_lines WHERE template_id=?', id);
    } else {
      const n = (await val(`SELECT COUNT(*) FROM journal_templates WHERE system=0`)) + 1;
      let code = `U-${String(n).padStart(3, '0')}`; while (await get('SELECT 1 FROM journal_templates WHERE code=?', code)) code += 'x';
      id = await insertRow('journal_templates', { code, name: b.name.trim(), module: b.module, description: b.description || '', system: 0 }, ['code', 'name', 'module', 'description', 'system']);
    }
    let seq = 0;
    for (const l of lines) await insertRow('journal_template_lines', { template_id: id, seq: seq++, side: l.side, account_id: Number(l.account_id), label: l.label || null }, ['template_id', 'seq', 'side', 'account_id', 'label']);
    await audit(user, 'save', 'journal_template', id); return id;
  });
  await r.post('/templates', async (req, res) => { const id = await saveTemplate(req.body, null, req.user); res.json((await loadTemplates(id))[0]); });
  r.put('/templates/:id', async (req, res) => { const id = await saveTemplate(req.body, Number(req.params.id), req.user); res.json((await loadTemplates(id))[0]); });
  r.delete('/templates/:id', async (req, res) => {
    const t = await get('SELECT * FROM journal_templates WHERE id=?', Number(req.params.id)); if (!t) throw new AppError('غير موجود', 404);
    if (t.system) throw new AppError('نماذج النظام لا تُحذف'); await run('DELETE FROM journal_templates WHERE id=?', t.id); await audit(req.user, 'delete', 'journal_template', t.id); res.json({ deleted: true });
  });
  return r;
}
