import { Router } from 'express';
import { all, get, run, val, AppError, r2 } from '../db.js';
import { requestPending, ensureStartJob, DOCS, saveDoc, voidDoc, restoreDoc, getDoc, invoiceOpenAmount, VOUCHER_KINDS } from '../lib/docs.js';
import { stockOf } from '../lib/stock.js';
import { nextNo, peekNo, audit } from '../lib/core.js';
import { can, need, canModule, maskEmployees } from '../lib/perms.js';
import { insertRow } from '../db.js';
import { notePending, noteStartJob } from '../lib/phase3.js';

const MODULE_OF = {
  purchase_request: 'purchases', purchase_order: 'purchases', goods_receipt: 'purchases', purchase_invoice: 'purchases', purchase_return: 'purchases',
  stock_issue: 'inventory', stock_adjustment: 'inventory', labor_sheet: 'hr', labor_advance: 'hr', payroll: 'hr', voucher: 'finance', production_log: 'production', delivery_note: 'sales', client_certificate: 'sales',
};
export { canModule as canUse } from '../lib/perms.js';
const VOUCHER_PAGE = { supplier_payment: 'expenses', expense: 'expenses', disbursement: 'expenses', wage_payment: 'wages', custody_issue: 'custody', custody_return: 'custody', transfer: 'custody', receipt: 'other', payment_other: 'expenses', collection: 'other' };
const TYPE_PAGE = { purchase_request: 'purchases.requests', purchase_order: 'purchases.orders', goods_receipt: 'purchases.receipts', purchase_invoice: 'purchases.invoices', purchase_return: 'purchases.returns', stock_adjustment: 'inventory.adjustments', labor_sheet: 'hr.labor', labor_advance: 'hr.labor-advances', payroll: 'hr.payroll', production_log: 'production.log', delivery_note: 'sales.deliveries', client_certificate: 'sales.certificates' };
const ISSUE_PAGE = { production: 'inventory.issues', overhead: 'inventory.issues', site: 'inventory.site-transfers', site_in: 'inventory.site-transfers', return: 'inventory.returns' };
/** مفتاح صفحة المستند (حسب نوعه وكوده لو متعدد الصفحات) */
const pageKey = (type, kind) => (type === 'stock_issue' ? ISSUE_PAGE[kind] : type === 'voucher' ? (VOUCHER_PAGE[kind] ? `finance.${VOUCHER_PAGE[kind]}` : null) : TYPE_PAGE[type]);
const typePages = (type) => (type === 'stock_issue' ? [...new Set(Object.values(ISSUE_PAGE))] : type === 'voucher' ? [...new Set(Object.values(VOUCHER_PAGE))].map((x) => `finance.${x}`) : [TYPE_PAGE[type]]);
const MULTI = new Set(['stock_issue', 'voucher']);
const kindOf = async (type, id) => (MULTI.has(type) ? await val(`SELECT kind FROM ${DOCS[type].table} WHERE id=?`, id) : null);

function where(q, base = []) {
  const w = [...base]; const p = [];
  const eq = (col, key) => { if (q[key] !== undefined && q[key] !== '') { w.push(`${col}=?`); p.push(q[key]); } };
  if (q.from) { w.push('d.date>=?'); p.push(q.from); }
  if (q.to) { w.push('d.date<=?'); p.push(q.to); }
  eq('d.status', 'status'); eq('d.supplier_id', 'supplier_id'); eq('d.project_id', 'project_id'); eq('d.kind', 'kind');
  eq('d.client_id', 'client_id'); eq('d.warehouse_id', 'warehouse_id'); eq('d.site_id', 'site_id'); eq('d.treasury_id', 'treasury_id'); eq('d.custodian_id', 'custodian_id');
  if (q.src_kind === 'custody') w.push('d.custodian_id IS NOT NULL');
  else if (q.src_kind === 'bank' || q.src_kind === 'treasury') w.push(`d.treasury_id IN (SELECT id FROM treasuries WHERE type${q.src_kind === 'bank' ? '=' : '<>'}'bank')`);
  eq('d.treasury_id', 'bank_id');
  if (q.q) { w.push('d.no LIKE ?'); p.push(`%${q.q}%`); }
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
}

const PARTY_TABLE = { supplier: 'suppliers', expense: 'expense_categories', client: 'clients', employee: 'employees', custodian: 'custodians', account: 'accounts' };
/** أسماء الأطراف في سندات الصرف متعددة الأسطر (للعرض في القائمة) */
async function attachPartyText(rows) {
  const multi = rows.filter((r) => r.kind === 'disbursement' || r.kind === 'collection'); const ids = multi.map((r) => Number(r.id)); if (!ids.length) return;
  const ls = await all(`SELECT l.voucher_id, l.party_id, t.link FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id
    JOIN payment_types t ON v.kind='disbursement' AND t.id=l.payment_type_id WHERE l.voucher_id IN (${ids.join(',')})
    UNION ALL SELECT l.voucher_id, l.party_id, t.link FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id
    JOIN receipt_types t ON v.kind='collection' AND t.id=l.payment_type_id WHERE l.voucher_id IN (${ids.join(',')}) ORDER BY 1`);
  const names = {};
  for (const [link, tbl] of Object.entries(PARTY_TABLE)) names[link] = Object.fromEntries((await all(`SELECT id, name FROM ${tbl}`)).map((x) => [x.id, x.name]));
  const by = {}; for (const l of ls) (by[l.voucher_id] ||= []).push(names[l.link]?.[l.party_id] || '');
  for (const r of multi) r.party_text = (by[r.id] || []).filter(Boolean).join('، ');
}

const LISTS = {
  purchase_request: async (q) => { for (const x of await all('SELECT id FROM purchase_requests WHERE start_job IS NULL')) await ensureStartJob(x.id); const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT string_agg(a.job_name || ':' || COALESCE(a.user_name,''), '|' ORDER BY a.id) FROM purchase_request_approvals a WHERE a.request_id=d.id) approvals, pr.name project_name, sp.name supplier_name, COALESCE(re.name, d.requested_by) requested_by,
      (SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=d.id) n_lines FROM purchase_requests d LEFT JOIN projects pr ON pr.id=d.project_id LEFT JOIN suppliers sp ON sp.id=d.supplier_id LEFT JOIN employees re ON re.id=d.requested_by_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  purchase_order: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name,
      (SELECT COALESCE(SUM(qty*unit_price),0) FROM purchase_order_lines WHERE order_id=d.id) total FROM purchase_orders d JOIN suppliers s ON s.id=d.supplier_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  goods_receipt: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name, w.name warehouse_name,
      (SELECT COALESCE(SUM(qty*unit_price),0) FROM goods_receipt_lines WHERE receipt_id=d.id) total
      FROM goods_receipts d JOIN suppliers s ON s.id=d.supplier_id JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  purchase_invoice: async (q) => { const { sql, p } = where(q); const rows = await all(`SELECT d.*, s.name supplier_name, w.name warehouse_name,
      (SELECT COALESCE(SUM(amount),0) FROM voucher_allocations WHERE invoice_id=d.id) paid
      FROM purchase_invoices d JOIN suppliers s ON s.id=d.supplier_id JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p);
    return rows.map((r) => ({ ...r, open_amount: r.payment_type === 'cash' || r.status === 'void' ? 0 : r2(r.total - r.paid) })); },
  purchase_return: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name FROM purchase_returns d JOIN suppliers s ON s.id=d.supplier_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  stock_issue: async (q) => {
    const base = []; if (q.only === 'issues') base.push(`d.kind IN ('production','overhead')`); if (q.only === 'site_transfers') base.push(`d.kind IN ('site','site_in')`); if (q.only === 'returns') base.push(`d.kind='return'`);
    // «بدون»: إذن فيه سطر واحد على الأقل من غير مرحلة (ولا مرحلة في رأس الإذن)، وغير ملغي
    if (q.stage_id === 'none') base.push(`d.status<>'void' AND d.kind IN ('production','overhead') AND d.stage_id IS NULL AND EXISTS (SELECT 1 FROM stock_issue_lines x WHERE x.issue_id=d.id AND x.stage_id IS NULL)`);
    else if (q.stage_id) base.push(`(d.stage_id=${Number(q.stage_id)} OR EXISTS (SELECT 1 FROM stock_issue_lines x WHERE x.issue_id=d.id AND x.stage_id=${Number(q.stage_id)}))`); if (q.item_id) base.push(`(d.item_id=${Number(q.item_id)} OR EXISTS (SELECT 1 FROM stock_issue_lines x WHERE x.issue_id=d.id AND x.item_id=${Number(q.item_id)}))`);
    const { sql, p } = where(q, base);
    return await all(`SELECT d.*, pr.name project_name, COALESCE(st.name, (SELECT string_agg(DISTINCT sx.name, '، ') FROM stock_issue_lines x JOIN stages sx ON sx.id=x.stage_id WHERE x.issue_id=d.id)) stage_name, COALESCE(it.name, (SELECT string_agg(DISTINCT pi.name, '، ') FROM stock_issue_lines x JOIN project_items pi ON pi.id=x.item_id WHERE x.issue_id=d.id)) item_name, si.name site_name, COALESCE(rc.name, (SELECT string_agg(DISTINCT ex.name, '، ') FROM stock_issue_lines x JOIN employees ex ON ex.id=x.received_by_id WHERE x.issue_id=d.id), d.received_by) received_by,
      (SELECT COALESCE(SUM(total),0) FROM stock_issue_lines WHERE issue_id=d.id) total
      FROM stock_issues d LEFT JOIN employees rc ON rc.id=d.received_by_id LEFT JOIN projects pr ON pr.id=d.project_id LEFT JOIN project_items it ON it.id=d.item_id
      LEFT JOIN stages st ON st.id=d.stage_id LEFT JOIN sites si ON si.id=d.site_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  stock_adjustment: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, w.name warehouse_name,
      (SELECT COALESCE(SUM(value),0) FROM stock_adjustment_lines WHERE adjustment_id=d.id) net_value FROM stock_adjustments d JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  labor_sheet: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT COUNT(DISTINCT employee_id) FROM labor_sheet_lines WHERE sheet_id=d.id) n_lines FROM labor_sheets d ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  labor_advance: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, t.name treasury_name, c.name custodian_name, (SELECT COUNT(*) FROM labor_advance_lines WHERE advance_id=d.id) n_lines
      FROM labor_advances d LEFT JOIN treasuries t ON t.id=d.treasury_id LEFT JOIN custodians c ON c.id=d.custodian_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  payroll: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT COUNT(*) FROM payroll_lines WHERE run_id=d.id) n_lines FROM payroll_runs d ${sql} ORDER BY d.month DESC, d.id DESC LIMIT 500`, ...p); },
  production_log: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, pr.name project_name, (SELECT COALESCE(SUM(qty),0) FROM production_log_lines WHERE log_id=d.id) qty,
      (SELECT COALESCE(SUM(qty*area_m2),0) FROM production_log_lines WHERE log_id=d.id) meters, (SELECT COUNT(*) FROM production_log_lines WHERE log_id=d.id) n_lines
      FROM production_logs d JOIN projects pr ON pr.id=d.project_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  delivery_note: async (q) => { for (const x of await all('SELECT id FROM delivery_notes WHERE start_job IS NULL')) await noteStartJob(x.id); const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT string_agg(a.job_name || ':' || COALESCE(a.user_name,''), '|' ORDER BY a.id) FROM delivery_note_approvals a WHERE a.note_id=d.id) approvals, pr.name project_name, c.name client_name, st.name site_name FROM delivery_notes d JOIN projects pr ON pr.id=d.project_id LEFT JOIN clients c ON c.id=d.client_id LEFT JOIN sites st ON st.id=d.site_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  client_certificate: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, pr.name project_name, c.name client_name FROM client_certificates d JOIN projects pr ON pr.id=d.project_id JOIN clients c ON c.id=d.client_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  voucher: async (q) => { const base = []; if (q.only === 'expenses') base.push(`d.kind IN ('disbursement','expense','supplier_payment','payment_other')`); if (q.only === 'receipts') base.push(`d.kind IN ('collection','receipt')`); if (q.only === 'custody') base.push(`d.kind IN ('custody_issue','custody_return','transfer')`);
    const { sql, p } = where(q, base); const rows = await all(`SELECT d.*, s.name supplier_name, t.name treasury_name, t2.name to_treasury_name, c.name custodian_name, ec.name category_name, a.name account_name
      FROM vouchers d LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN treasuries t ON t.id=d.treasury_id LEFT JOIN treasuries t2 ON t2.id=d.to_treasury_id
      LEFT JOIN custodians c ON c.id=d.custodian_id LEFT JOIN expense_categories ec ON ec.id=d.category_id LEFT JOIN accounts a ON a.id=d.account_id
      ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); await attachPartyText(rows); return rows; },
};

export async function docRouter() {
  const r = Router();
  const known = (type) => { if (!DOCS[type]) throw new AppError('نوع المستند غير معروف', 404); };
  // action: null = عرض الصفحة، أو create / edit / void / close
  const allow = (req, type, kind, action) => {
    const pk = pageKey(type, kind); if (!pk) throw new AppError('نوع المستند غير معروف', 400);
    need(req.user, action ? `${pk}.${action}` : pk, 'ليس لديك صلاحية على هذا المستند أو الإجراء');
  };
  // ---- مسودات شاشات الإدخال (لكل مستخدم مسوداته بس) — لازم قبل مسارات /:type
  const draftType = (req, scope) => { const type = String(scope || '').split('|')[0]; known(type); if (!canModule(req.user, MODULE_OF[type])) throw new AppError('ليس لديك صلاحية على هذه الصفحة', 403); return type; };
  r.get('/drafts', async (req, res) => {
    draftType(req, req.query.scope);
    const rows = await all(`SELECT id, summary, updated_at, payload FROM doc_drafts WHERE user_id=? AND scope=? ORDER BY updated_at DESC, id DESC LIMIT 200`, req.user.id, String(req.query.scope));
    res.json(rows.map((x) => { let payload = {}; try { payload = JSON.parse(x.payload); } catch { /* مسودة تالفة */ } return { ...x, payload }; }));
  });
  r.post('/drafts', async (req, res) => {
    const { id, scope, summary, payload } = req.body || {}; draftType(req, scope);
    const body = JSON.stringify(payload || {}); if (body.length > 1_000_000) throw new AppError('المسودة كبيرة جداً', 400);
    if (id && await get('SELECT id FROM doc_drafts WHERE id=? AND user_id=?', Number(id), req.user.id)) {
      await run(`UPDATE doc_drafts SET payload=?, summary=?, updated_at=now() WHERE id=?`, body, summary || null, Number(id)); return res.json({ id: Number(id) });
    }
    const row = await get(`INSERT INTO doc_drafts (user_id, scope, summary, payload) VALUES (?,?,?,?) RETURNING id`, req.user.id, String(scope), summary || null, body);
    res.json({ id: Number(row.id) });
  });
  r.delete('/drafts/:id', async (req, res) => { await run('DELETE FROM doc_drafts WHERE id=? AND user_id=?', Number(req.params.id), req.user.id); res.json({ ok: true }); });
  r.get('/:type', async (req, res) => {
    known(req.params.type); const type = req.params.type;
    if (!can(req.user, typePages(type))) throw new AppError('ليس لديك صلاحية على هذه الصفحة', 403);
    const rows = await LISTS[type](req.query);
    res.json(MULTI.has(type) ? rows.filter((x) => can(req.user, pageKey(type, x.kind))) : rows);
  });
  r.get('/:type/:id', async (req, res) => {
    known(req.params.type);
    const d = await getDoc(req.params.type, Number(req.params.id)); if (!d) throw new AppError('المستند غير موجود', 404);
    allow(req, req.params.type, d.kind, null); res.json(d);
  });
  await r.post('/:type', async (req, res) => { known(req.params.type); allow(req, req.params.type, req.body.kind, 'create'); res.json(await saveDoc(req.params.type, req.body, null, req.user)); });
  r.put('/:type/:id', async (req, res) => {
    known(req.params.type); const id = Number(req.params.id); const kind = await kindOf(req.params.type, id);
    allow(req, req.params.type, kind, 'edit');
    if (MULTI.has(req.params.type) && req.body.kind && req.body.kind !== kind) allow(req, req.params.type, req.body.kind, 'edit');
    res.json(await saveDoc(req.params.type, req.body, id, req.user));
  });
  // اعتماد طلب الشراء: خطوة بخطوة بترتيب وظائف موديول المشتريات؛ الخطوة التالية لصاحب الوظيفة دي (أو مدير النظام)
  const holds = async (u, job) => u.role === 'admin' || !!await get(`SELECT 1 FROM user_jobs uj JOIN module_jobs m ON m.id=uj.job_id WHERE uj.user_id=? AND m.module='purchases' AND m.name=?`, u.id, job);
  await r.post('/purchase_request/:id/approve', async (req, res) => {
    const id = Number(req.params.id); const cur = await get('SELECT * FROM purchase_requests WHERE id=?', id);
    if (!cur) throw new AppError('الطلب غير موجود', 404); if (cur.status === 'void') throw new AppError('الطلب ملغي');
    const next = (await requestPending(id))[0];
    if (!next) throw new AppError('الطلب معتمد بالكامل');
    if (!await holds(req.user, next)) throw new AppError(`الخطوة التالية «${next}» — الاعتماد لصاحب الوظيفة دي فقط`, 403);
    const nm = await val('SELECT COALESCE(e.name, u.name) FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?', req.user.id);
    await run(`INSERT INTO purchase_request_approvals(request_id, job_name, user_id, user_name, at) VALUES(?,?,?,?, to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'))`, id, next, req.user.id, nm);
    await audit(req.user, 'approve', 'purchase_request', id, { no: cur.no, step: next }); res.json({ ok: true });
  });
  await r.post('/purchase_request/:id/unapprove', async (req, res) => {   // بيسحب آخر خطوة اعتماد بس
    const id = Number(req.params.id);
    const last = await get('SELECT * FROM purchase_request_approvals WHERE request_id=? ORDER BY id DESC LIMIT 1', id);
    if (!last) throw new AppError('مفيش اعتماد لسحبه');
    if (!await holds(req.user, last.job_name)) throw new AppError(`سحب الاعتماد لصاحب وظيفة «${last.job_name}» فقط`, 403);
    if (await val('SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=? AND ordered_qty>0', id)) throw new AppError('تم إصدار أمر توريد على الطلب — ألغِ أمر التوريد أولاً');
    await run('DELETE FROM purchase_request_approvals WHERE id=?', last.id);
    await audit(req.user, 'unapprove', 'purchase_request', id, { step: last.job_name }); res.json({ ok: true });
  });
  // اعتماد إذن التسليم: نفس فكرة طلب الشراء بوظائف موديول المبيعات
  const holdsSales = async (u, job) => u.role === 'admin' || !!await get(`SELECT 1 FROM user_jobs uj JOIN module_jobs m ON m.id=uj.job_id WHERE uj.user_id=? AND m.module='sales' AND m.name=?`, u.id, job);
  await r.post('/delivery_note/:id/approve', async (req, res) => {
    const id = Number(req.params.id); const cur = await get('SELECT * FROM delivery_notes WHERE id=?', id);
    if (!cur) throw new AppError('الإذن غير موجود', 404); if (cur.status === 'void') throw new AppError('الإذن ملغي');
    const next = (await notePending(id))[0];
    if (!next) throw new AppError('الإذن معتمد بالكامل');
    if (!await holdsSales(req.user, next)) throw new AppError(`الخطوة التالية «${next}» — الاعتماد لصاحب الوظيفة دي فقط`, 403);
    const nm = await val('SELECT COALESCE(e.name, u.name) FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?', req.user.id);
    await run(`INSERT INTO delivery_note_approvals(note_id, job_name, user_id, user_name, at) VALUES(?,?,?,?, to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'))`, id, next, req.user.id, nm);
    await audit(req.user, 'approve', 'delivery_note', id, { no: cur.no, step: next }); res.json({ ok: true });
  });
  await r.post('/delivery_note/:id/unapprove', async (req, res) => {
    const id = Number(req.params.id);
    const last = await get('SELECT * FROM delivery_note_approvals WHERE note_id=? ORDER BY id DESC LIMIT 1', id);
    if (!last) throw new AppError('مفيش اعتماد لسحبه');
    if (!await holdsSales(req.user, last.job_name)) throw new AppError(`سحب الاعتماد لصاحب وظيفة «${last.job_name}» فقط`, 403);
    if (await get(`SELECT 1 FROM client_certificate_lines cl JOIN client_certificates c ON c.id=cl.cert_id JOIN delivery_note_lines dl ON dl.id=cl.delivery_line_id WHERE dl.note_id=? AND c.status='posted' LIMIT 1`, id)) throw new AppError('الإذن داخل في مستخلص — ألغِ المستخلص أولاً');
    await run('DELETE FROM delivery_note_approvals WHERE id=?', last.id);
    await audit(req.user, 'unapprove', 'delivery_note', id, { step: last.job_name }); res.json({ ok: true });
  });
  await r.post('/:type/:id/void', async (req, res) => { known(req.params.type); const id = Number(req.params.id); allow(req, req.params.type, await kindOf(req.params.type, id), 'void'); res.json(await voidDoc(req.params.type, id, req.user)); });
  await r.post('/:type/:id/restore', async (req, res) => { known(req.params.type); const id = Number(req.params.id); allow(req, req.params.type, await kindOf(req.params.type, id), 'void'); res.json(await restoreDoc(req.params.type, id, req.user)); });
  await r.post('/:type/:id/reopen', async (req, res) => {
    known(req.params.type); const id = Number(req.params.id);
    const type = req.params.type; const D = DOCS[type];
    if (!D?.relock) throw new AppError('غير مدعوم');
    allow(req, type, await kindOf(type, id), 'reopen');
    const cur = await get(`SELECT * FROM ${D.table} WHERE id=?`, id); if (!cur) throw new AppError('المستند غير موجود', 404);
    if (cur.kind === 'return') throw new AppError('المرتجع غير مقفول');
    if (cur.status !== 'posted') throw new AppError('المستند ملغي');
    if (cur.reopened) throw new AppError('المستند مفتوح بالفعل');
    await run(`UPDATE ${D.table} SET reopened=1 WHERE id=?`, id); await audit(req.user, 'reopen', type, id, { no: cur.no });
    res.json(await getDoc(type, id));
  });
  await r.post('/:type/:id/close', async (req, res) => {
    known(req.params.type); allow(req, req.params.type, null, 'close');
    const t = { purchase_order: 'purchase_orders', purchase_request: 'purchase_requests' }[req.params.type];
    if (!t) throw new AppError('غير مدعوم');
    const cur = await get(`SELECT no, status FROM ${t} WHERE id=?`, Number(req.params.id)); if (!cur) throw new AppError('المستند غير موجود', 404);
    if (cur.status === 'void') throw new AppError('المستند ملغي');
    await run(`UPDATE ${t} SET status='closed' WHERE id=? AND status<>'void'`, Number(req.params.id)); await audit(req.user, 'close', req.params.type, Number(req.params.id), { no: cur.no, from: cur.status }); res.json({ ok: true });
  });
  return r;
}

/** استعلامات مساعدة لشاشات الإدخال (ربط المستندات ببعضها) */
export function helperRouter() {
  const r = Router();
  // المساعدات خاصة بشاشات المستندات: لازم المستخدم يكون له صلاحية على موديول مستندات واحد على الأقل
  r.use((req, res, next) => {
    if (!['inventory', 'purchases', 'hr', 'finance', 'accounts'].some((m) => canModule(req.user, m))) return res.status(403).json({ error: 'ليس لديك صلاحية' });
    next();
  });
  r.get('/request-lines', async (req, res) => res.json(await all(`SELECT l.*, m.name material_name, l.qty-l.ordered_qty remaining FROM purchase_request_lines l JOIN materials m ON m.id=l.material_id
      WHERE l.request_id=? AND l.qty-l.ordered_qty>0.000001`, req.query.request_id)));
  r.get('/open-requests', async (req, res) => { const rows = await all(`SELECT id,no,date FROM purchase_requests WHERE status IN ('open') ORDER BY id DESC`); const out = []; for (const x of rows) if (!(await requestPending(x.id)).length) out.push(x); res.json(out); });
  r.get('/open-orders', async (req, res) => res.json(await all(`SELECT id,no,date FROM purchase_orders WHERE supplier_id=? AND status IN ('open','partial') ORDER BY id DESC`, req.query.supplier_id)));
  r.get('/order-lines', async (req, res) => res.json(await all(`SELECT l.*, m.name material_name, l.qty-l.received_qty remaining FROM purchase_order_lines l JOIN materials m ON m.id=l.material_id
      WHERE l.order_id=? AND l.qty-l.received_qty>0.000001`, req.query.order_id)));
  r.get('/open-invoices', async (req, res) => {
    const rows = await all(`SELECT * FROM purchase_invoices WHERE supplier_id=? AND payment_type='credit' AND status='posted' ORDER BY date, id`, req.query.supplier_id);
    const out = []; for (const i of rows) { const open = await invoiceOpenAmount(i); if (open > 0.004) out.push({ id: i.id, no: i.no, date: i.date, due_date: i.due_date, total: i.total, open }); }
    res.json(out);
  });
  r.get('/issue-lines', async (req, res) => res.json(await all(`SELECT l.id, l.material_id, m.name material_name, l.qty, l.unit_cost,
      l.qty - COALESCE((SELECT SUM(x.qty) FROM stock_issue_lines x JOIN stock_issues i ON i.id=x.issue_id WHERE x.ref_line_id=l.id AND i.status='posted'),0) remaining
      FROM stock_issue_lines l JOIN materials m ON m.id=l.material_id WHERE l.issue_id=?`, req.query.issue_id)));
  r.get('/returnable-issues', async (req, res) => res.json(await all(`SELECT i.id, i.no, i.date, i.kind, p.name project_name FROM stock_issues i LEFT JOIN projects p ON p.id=i.project_id
      WHERE i.kind NOT IN ('return','site_in') AND i.status='posted' ORDER BY i.date DESC, i.id DESC LIMIT 300`)));
  // سلف العمال اليومية المصروفة داخل مدة معينة (مجمّعة لكل عامل) + بداية المدة الجديدة (اليوم التالي لنهاية آخر مدة)
  r.get('/labor-advances', async (req, res) => {
    const { from, to } = req.query;
    const rows = from && to ? await all(`SELECT l.employee_id, SUM(l.amount) amount FROM labor_advance_lines l JOIN labor_advances a ON a.id=l.advance_id
      WHERE a.status='posted' AND a.date>=? AND a.date<=? GROUP BY l.employee_id`, from, to) : [];
    const last = await val(`SELECT MAX(period_to) FROM labor_sheets WHERE status<>'void' AND period_to IS NOT NULL`);
    let next_from = null; if (last) { const d = new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); next_from = d.toISOString().slice(0, 10); }
    res.json({ rows: rows.map((r) => ({ employee_id: r.employee_id, amount: r2(r.amount) })), next_from });
  });
  // كشوف سلف العمال المعتمدة (بعمالها ومبالغهم) — لزرار «استيراد من كشوف السلف» في كشف اليومية
  r.get('/labor-advance-sheets', async (req, res) => {
    const sheets = await all(`SELECT id, no, date, total FROM labor_advances WHERE status='posted' ORDER BY date DESC, id DESC LIMIT 200`);
    const lines = sheets.length ? await all(`SELECT advance_id, employee_id, amount FROM labor_advance_lines WHERE advance_id IN (${sheets.map(() => '?').join(',')})`, ...sheets.map((s) => s.id)) : [];
    res.json(sheets.map((s) => ({ ...s, lines: lines.filter((l) => l.advance_id === s.id).map((l) => ({ employee_id: l.employee_id, amount: r2(l.amount) })) })));
  });
  r.get('/unpaid-wages', async (req, res) => res.json({
    sheets: await all(`SELECT id,no,date,total,paid_amount, total-paid_amount remaining FROM labor_sheets WHERE status='posted' AND total-paid_amount>0.004 ORDER BY date`),
    runs: await all(`SELECT id,no,month,net total,paid_amount, net-paid_amount remaining FROM payroll_runs WHERE status='posted' AND net-paid_amount>0.004 ORDER BY month`),
  }));
  // إضافة بند مشروع سريعة من شاشة الصرف — لصاحب صلاحية «إضافة بنود» (أو الإعدادات / المدير)
  r.post('/quick-item', async (req, res) => {
    need(req.user, ['inventory.issues.add_item', 'settings.project-items.create'], 'ليس لديك صلاحية إضافة بنود المشروعات');
    const b = req.body || {}; const name = String(b.name || '').trim();
    if (!name) throw new AppError('اسم البند مطلوب');
    const prj = await get('SELECT id, active FROM projects WHERE id=?', Number(b.project_id));
    if (!prj || !prj.active) throw new AppError('اختر مشروعاً صحيحاً');
    if (await get('SELECT 1 FROM project_items WHERE project_id=? AND LOWER(name)=LOWER(?) AND active=1', prj.id, name)) throw new AppError('فيه بند بنفس الاسم في المشروع ده');
    const unit = b.unit_id ? Number(b.unit_id) : null;
    if (unit && !await get('SELECT 1 FROM units WHERE id=?', unit)) throw new AppError('الوحدة غير موجودة');
    const qty = b.qty === undefined || b.qty === null || b.qty === '' ? null : Number(b.qty);
    if (qty !== null && !(qty >= 0)) throw new AppError('الكمية غير صحيحة');
    const code = await nextNo('project_item');
    const id = await insertRow('project_items', { code, name, project_id: prj.id, qty, unit_id: unit }, ['code', 'name', 'project_id', 'qty', 'unit_id']);
    await audit(req.user, 'create', 'project_items', id, { code, via: 'issue-screen' });
    res.json(await get('SELECT * FROM project_items WHERE id=?', id));
  });
  r.get('/stock', async (req, res) => res.json(await stockOf(Number(req.query.warehouse_id), Number(req.query.material_id))));
  // آخر سعر شراء للصنف (من فواتير الشراء واستلامات البضاعة المعتمدة)، بالوحدة الأساسية
  const lastPurchase = (materialId) => get(`SELECT unit_price, date, supplier_name FROM (
        SELECT l.unit_price, d.date, d.id, 1 src, s.name supplier_name FROM purchase_invoice_lines l JOIN purchase_invoices d ON d.id=l.invoice_id JOIN suppliers s ON s.id=d.supplier_id WHERE l.material_id=? AND d.status<>'void' AND l.unit_price>0
        UNION ALL
        SELECT l.unit_price, d.date, d.id, 0 src, s.name supplier_name FROM goods_receipt_lines l JOIN goods_receipts d ON d.id=l.receipt_id JOIN suppliers s ON s.id=d.supplier_id WHERE l.material_id=? AND d.status<>'void' AND l.unit_price>0
      ) x ORDER BY date DESC, src DESC, id DESC LIMIT 1`, materialId, materialId);
  r.get('/last-price', async (req, res) => res.json((await lastPurchase(req.query.material_id)) || null));
  // سعر مرجعي للصنف: آخر سعر شراء، ولو مفيش فمتوسط التكلفة من كارت الصنف (المخزن المحدد أو أي مخزن له رصيد)
  r.get('/price-hint', async (req, res) => {
    const mid = Number(req.query.material_id); if (!mid) return res.json(null);
    const last = await lastPurchase(mid);
    if (last && Number(last.unit_price) > 0) return res.json({ price: Number(last.unit_price), source: 'last', date: last.date, supplier_name: last.supplier_name });
    const wh = Number(req.query.warehouse_id) || 0;
    const avg = (wh ? await get('SELECT avg_cost FROM material_stock WHERE material_id=? AND warehouse_id=? AND avg_cost>0', mid, wh) : null) || await get('SELECT avg_cost FROM material_stock WHERE material_id=? AND avg_cost>0 ORDER BY qty DESC LIMIT 1', mid);
    res.json(avg ? { price: Number(avg.avg_cost), source: 'avg' } : null);
  });
  // الرقم المتوقع لمستند جديد (للعرض فقط — الرقم الفعلي بيتحجز عند الحفظ)
  r.get('/next-no', async (req, res) => res.json({ no: await peekNo(String(req.query.key || '')) }));
  r.get('/stock-all', async (req, res) => res.json(await all(`SELECT material_id, qty, value, avg_cost FROM material_stock WHERE warehouse_id=?`, req.query.warehouse_id)));
  r.get('/project-items', async (req, res) => res.json(await all(`SELECT id,code,name FROM project_items WHERE project_id=? AND active=1 ORDER BY code`, req.query.project_id)));
  r.get('/employee-rates', async (req, res) => res.json(maskEmployees(await all(`SELECT id, code, name, emp_type, daily_rate, monthly_salary, cost_class, default_stage_id FROM employees WHERE active=1 ORDER BY code`), req.user)));
  return r;
}
export { VOUCHER_KINDS };
