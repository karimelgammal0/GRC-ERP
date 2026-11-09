import { Router } from 'express';
import { all, get, run, val, AppError, r2 } from '../db.js';
import { DOCS, saveDoc, voidDoc, getDoc, invoiceOpenAmount, VOUCHER_KINDS } from '../lib/docs.js';
import { stockOf } from '../lib/stock.js';
import { nextNo, audit } from '../lib/core.js';
import { insertRow } from '../db.js';

const MODULE_OF = {
  purchase_request: 'purchases', purchase_order: 'purchases', goods_receipt: 'purchases', purchase_invoice: 'purchases', purchase_return: 'purchases',
  stock_issue: 'inventory', stock_adjustment: 'inventory', labor_sheet: 'hr', payroll: 'hr', voucher: 'finance',
};
export const canUse = (user, mod) => user.role === 'admin' || (JSON.parse(user.modules || '[]')).includes(mod);

function where(q, base = []) {
  const w = [...base]; const p = [];
  const eq = (col, key) => { if (q[key] !== undefined && q[key] !== '') { w.push(`${col}=?`); p.push(q[key]); } };
  if (q.from) { w.push('d.date>=?'); p.push(q.from); }
  if (q.to) { w.push('d.date<=?'); p.push(q.to); }
  eq('d.status', 'status'); eq('d.supplier_id', 'supplier_id'); eq('d.project_id', 'project_id'); eq('d.kind', 'kind');
  eq('d.warehouse_id', 'warehouse_id'); eq('d.site_id', 'site_id'); eq('d.treasury_id', 'treasury_id'); eq('d.custodian_id', 'custodian_id');
  if (q.q) { w.push('d.no LIKE ?'); p.push(`%${q.q}%`); }
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
}

const LISTS = {
  purchase_request: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, pr.name project_name, COALESCE(re.name, d.requested_by) requested_by,
      (SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=d.id) n_lines FROM purchase_requests d LEFT JOIN projects pr ON pr.id=d.project_id LEFT JOIN employees re ON re.id=d.requested_by_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  purchase_order: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name,
      (SELECT COALESCE(SUM(qty*unit_price),0) FROM purchase_order_lines WHERE order_id=d.id) total FROM purchase_orders d JOIN suppliers s ON s.id=d.supplier_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  goods_receipt: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name, w.name warehouse_name,
      (SELECT COALESCE(SUM(qty*unit_price),0) FROM goods_receipt_lines WHERE receipt_id=d.id) total,
      (SELECT COALESCE(SUM(qty-invoiced_qty),0) FROM goods_receipt_lines WHERE receipt_id=d.id) uninvoiced_qty
      FROM goods_receipts d JOIN suppliers s ON s.id=d.supplier_id JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  purchase_invoice: async (q) => { const { sql, p } = where(q); const rows = await all(`SELECT d.*, s.name supplier_name, w.name warehouse_name,
      (SELECT COALESCE(SUM(amount),0) FROM voucher_allocations WHERE invoice_id=d.id) paid
      FROM purchase_invoices d JOIN suppliers s ON s.id=d.supplier_id JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p);
    return rows.map((r) => ({ ...r, open_amount: r.payment_type === 'cash' || r.status === 'void' ? 0 : r2(r.total - r.paid) })); },
  purchase_return: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name FROM purchase_returns d JOIN suppliers s ON s.id=d.supplier_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  stock_issue: async (q) => {
    const base = []; if (q.only === 'issues') base.push(`d.kind IN ('production','overhead')`); if (q.only === 'site_transfers') base.push(`d.kind='site'`); if (q.only === 'returns') base.push(`d.kind='return'`);
    if (q.stage_id) base.push(`d.stage_id=${Number(q.stage_id)}`); if (q.item_id) base.push(`d.item_id=${Number(q.item_id)}`);
    const { sql, p } = where(q, base);
    return await all(`SELECT d.*, pr.name project_name, it.name item_name, st.name stage_name, si.name site_name, COALESCE(rc.name, d.received_by) received_by,
      (SELECT COALESCE(SUM(total),0) FROM stock_issue_lines WHERE issue_id=d.id) total
      FROM stock_issues d LEFT JOIN employees rc ON rc.id=d.received_by_id LEFT JOIN projects pr ON pr.id=d.project_id LEFT JOIN project_items it ON it.id=d.item_id
      LEFT JOIN stages st ON st.id=d.stage_id LEFT JOIN sites si ON si.id=d.site_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  stock_adjustment: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, w.name warehouse_name,
      (SELECT COALESCE(SUM(value),0) FROM stock_adjustment_lines WHERE adjustment_id=d.id) net_value FROM stock_adjustments d JOIN warehouses w ON w.id=d.warehouse_id ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  labor_sheet: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT COUNT(*) FROM labor_sheet_lines WHERE sheet_id=d.id) n_lines FROM labor_sheets d ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
  payroll: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, (SELECT COUNT(*) FROM payroll_lines WHERE run_id=d.id) n_lines FROM payroll_runs d ${sql} ORDER BY d.month DESC, d.id DESC LIMIT 500`, ...p); },
  voucher: async (q) => { const { sql, p } = where(q); return await all(`SELECT d.*, s.name supplier_name, t.name treasury_name, t2.name to_treasury_name, c.name custodian_name, ec.name category_name, a.name account_name
      FROM vouchers d LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN treasuries t ON t.id=d.treasury_id LEFT JOIN treasuries t2 ON t2.id=d.to_treasury_id
      LEFT JOIN custodians c ON c.id=d.custodian_id LEFT JOIN expense_categories ec ON ec.id=d.category_id LEFT JOIN accounts a ON a.id=d.account_id
      ${sql} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...p); },
};

export async function docRouter() {
  const r = Router();
  const guard = (req, type) => {
    if (!DOCS[type]) throw new AppError('نوع المستند غير معروف', 404);
    if (!canUse(req.user, MODULE_OF[type])) throw new AppError('ليس لديك صلاحية على هذا الموديول', 403);
  };
  r.get('/:type', async (req, res) => { guard(req, req.params.type); res.json(await LISTS[req.params.type](req.query)); });
  r.get('/:type/:id', async (req, res) => {
    guard(req, req.params.type);
    const d = await getDoc(req.params.type, Number(req.params.id)); if (!d) throw new AppError('المستند غير موجود', 404); res.json(d);
  });
  await r.post('/:type', async (req, res) => { guard(req, req.params.type); res.json(await saveDoc(req.params.type, req.body, null, req.user)); });
  r.put('/:type/:id', async (req, res) => { guard(req, req.params.type); res.json(await saveDoc(req.params.type, req.body, Number(req.params.id), req.user)); });
  await r.post('/:type/:id/void', async (req, res) => { guard(req, req.params.type); res.json(await voidDoc(req.params.type, Number(req.params.id), req.user)); });
  await r.post('/:type/:id/close', async (req, res) => {
    guard(req, req.params.type);
    const t = { purchase_order: 'purchase_orders', purchase_request: 'purchase_requests' }[req.params.type];
    if (!t) throw new AppError('غير مدعوم');
    await run(`UPDATE ${t} SET status='closed' WHERE id=? AND status<>'void'`, Number(req.params.id)); res.json({ ok: true });
  });
  return r;
}

/** استعلامات مساعدة لشاشات الإدخال (ربط المستندات ببعضها) */
export function helperRouter() {
  const r = Router();
  r.get('/request-lines', async (req, res) => res.json(await all(`SELECT l.*, m.name material_name, l.qty-l.ordered_qty remaining FROM purchase_request_lines l JOIN materials m ON m.id=l.material_id
      WHERE l.request_id=? AND l.qty-l.ordered_qty>0.000001`, req.query.request_id)));
  r.get('/open-requests', async (req, res) => res.json(await all(`SELECT id,no,date FROM purchase_requests WHERE status IN ('open') ORDER BY id DESC`)));
  r.get('/open-orders', async (req, res) => res.json(await all(`SELECT id,no,date FROM purchase_orders WHERE supplier_id=? AND status IN ('open','partial') ORDER BY id DESC`, req.query.supplier_id)));
  r.get('/order-lines', async (req, res) => res.json(await all(`SELECT l.*, m.name material_name, l.qty-l.received_qty remaining FROM purchase_order_lines l JOIN materials m ON m.id=l.material_id
      WHERE l.order_id=? AND l.qty-l.received_qty>0.000001`, req.query.order_id)));
  r.get('/uninvoiced-grn-lines', async (req, res) => res.json(await all(`SELECT gl.id, gl.material_id, gl.unit_price, gl.qty-gl.invoiced_qty remaining, gr.no receipt_no, gr.date, m.name material_name
      FROM goods_receipt_lines gl JOIN goods_receipts gr ON gr.id=gl.receipt_id JOIN materials m ON m.id=gl.material_id
      WHERE gr.supplier_id=? AND gr.status='posted' AND gl.qty-gl.invoiced_qty>0.000001 ORDER BY gr.date, gl.id`, req.query.supplier_id)));
  r.get('/open-invoices', async (req, res) => {
    const rows = await all(`SELECT * FROM purchase_invoices WHERE supplier_id=? AND payment_type='credit' AND status='posted' ORDER BY date, id`, req.query.supplier_id);
    const out = []; for (const i of rows) { const open = await invoiceOpenAmount(i); if (open > 0.004) out.push({ id: i.id, no: i.no, date: i.date, due_date: i.due_date, total: i.total, open }); }
    res.json(out);
  });
  r.get('/issue-lines', async (req, res) => res.json(await all(`SELECT l.id, l.material_id, m.name material_name, l.qty, l.unit_cost,
      l.qty - COALESCE((SELECT SUM(x.qty) FROM stock_issue_lines x JOIN stock_issues i ON i.id=x.issue_id WHERE x.ref_line_id=l.id AND i.status='posted'),0) remaining
      FROM stock_issue_lines l JOIN materials m ON m.id=l.material_id WHERE l.issue_id=?`, req.query.issue_id)));
  r.get('/returnable-issues', async (req, res) => res.json(await all(`SELECT i.id, i.no, i.date, i.kind, p.name project_name FROM stock_issues i LEFT JOIN projects p ON p.id=i.project_id
      WHERE i.kind<>'return' AND i.status='posted' ORDER BY i.date DESC, i.id DESC LIMIT 300`)));
  r.get('/unpaid-wages', async (req, res) => res.json({
    sheets: await all(`SELECT id,no,date,total,paid_amount, total-paid_amount remaining FROM labor_sheets WHERE status='posted' AND total-paid_amount>0.004 ORDER BY date`),
    runs: await all(`SELECT id,no,month,net total,paid_amount, net-paid_amount remaining FROM payroll_runs WHERE status='posted' AND net-paid_amount>0.004 ORDER BY month`),
  }));
  // إضافة بند مشروع سريعة من شاشة الصرف — لصاحب صلاحية «إضافة بنود» (أو الإعدادات / المدير)
  r.post('/quick-item', async (req, res) => {
    if (!canUse(req.user, 'perm_add_items') && !canUse(req.user, 'settings')) throw new AppError('ليس لديك صلاحية إضافة بنود المشروعات', 403);
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
  r.get('/stock-all', async (req, res) => res.json(await all(`SELECT material_id, qty, value, avg_cost FROM material_stock WHERE warehouse_id=?`, req.query.warehouse_id)));
  r.get('/project-items', async (req, res) => res.json(await all(`SELECT id,code,name FROM project_items WHERE project_id=? AND active=1 ORDER BY code`, req.query.project_id)));
  r.get('/employee-rates', async (req, res) => res.json(await all(`SELECT id, code, name, emp_type, daily_rate, monthly_salary, cost_class, default_stage_id FROM employees WHERE active=1 ORDER BY code`)));
  return r;
}
export { VOUCHER_KINDS };
