import { Router } from 'express';
import { all, get, run, val, insertRow, updateRow, AppError } from '../db.js';
import { nextNo, audit } from '../lib/core.js';

const T = (k, l, t = 'text', extra = {}) => ({ k, l, t, ...extra });
const CLS = [['direct', 'مباشرة (مرحلة تصنيع)'], ['indirect', 'تكلفة غير مباشرة'], ['admin', 'مصروفات إدارية']];

/** مواصفات شاشات التكويد — الواجهة بتبني الفورم والجدول منها */
export const MASTERS = {
  units: { title: 'الوحدات', table: 'units', seq: 'unit', fields: [T('name', 'الاسم', 'text', { req: 1 })], cols: ['code', 'name'], used: [['materials', 'unit_id'], ['project_items', 'unit_id']] },
  material_categories: { title: 'فئات الخامات', table: 'material_categories', seq: 'material_category', fields: [T('name', 'الاسم', 'text', { req: 1 })], cols: ['code', 'name'], used: [['materials', 'category_id']] },
  materials: {
    title: 'الخامات (الأصناف)', table: 'materials', seq: 'material',
    fields: [T('name', 'اسم الخامة', 'text', { req: 1 }), T('category_id', 'الفئة', 'fk', { ref: 'material_categories' }), T('unit_id', 'وحدة القياس', 'fk', { ref: 'units', req: 1 }),
      T('min_qty', 'حد الطلب (تنبيه)', 'number'), T('notes', 'ملاحظات', 'textarea')],
    cols: ['code', 'name', 'category_id', 'unit_id', 'min_qty'],
    used: [['stock_moves', 'material_id'], ['purchase_request_lines', 'material_id'], ['purchase_order_lines', 'material_id'], ['goods_receipt_lines', 'material_id'], ['purchase_invoice_lines', 'material_id'], ['stock_issue_lines', 'material_id'], ['stock_adjustment_lines', 'material_id'], ['purchase_return_lines', 'material_id']],
  },
  warehouses: { title: 'المخازن', table: 'warehouses', seq: 'warehouse', fields: [T('name', 'الاسم', 'text', { req: 1 }), T('type', 'النوع', 'select', { options: [['raw', 'مخزن خامات'], ['finished', 'مخزن منتجات تامة (لاحقاً)']] })], cols: ['code', 'name', 'type'], used: [['stock_moves', 'warehouse_id']] },
  suppliers: {
    title: 'الموردين', table: 'suppliers', seq: 'supplier',
    fields: [T('name', 'اسم المورد', 'text', { req: 1 }), T('phone', 'الهاتف'), T('address', 'العنوان'), T('tax_no', 'الرقم الضريبي'), T('credit_days', 'مدة الائتمان (يوم)', 'number'), T('notes', 'ملاحظات', 'textarea')],
    cols: ['code', 'name', 'phone', 'credit_days'], used: [['purchase_invoices', 'supplier_id'], ['goods_receipts', 'supplier_id'], ['purchase_orders', 'supplier_id'], ['vouchers', 'supplier_id'], ['purchase_returns', 'supplier_id']],
  },
  projects: {
    title: 'المشروعات', table: 'projects', seq: 'project',
    fields: [T('name', 'اسم المشروع', 'text', { req: 1 }), T('client_id', 'العميل', 'fk', { ref: 'clients' }), T('start_date', 'تاريخ البدء', 'date'), T('end_date', 'تاريخ الانتهاء المتوقع', 'date'),
      T('status', 'الحالة', 'select', { options: [['active', 'جارٍ'], ['done', 'مكتمل'], ['hold', 'متوقف']] }), T('notes', 'ملاحظات', 'textarea')],
    cols: ['code', 'name', 'client_id', 'status'], used: [['project_items', 'project_id'], ['stock_issues', 'project_id'], ['cost_lines', 'project_id'], ['sites', 'project_id']],
  },
  project_items: {
    title: 'بنود المشروعات', table: 'project_items', seq: 'project_item',
    fields: [T('project_id', 'المشروع', 'fk', { ref: 'projects', req: 1 }), T('name', 'اسم البند', 'text', { req: 1 }), T('qty', 'الكمية', 'number'), T('unit_id', 'الوحدة', 'fk', { ref: 'units' }), T('notes', 'ملاحظات', 'textarea')],
    cols: ['code', 'name', 'project_id', 'qty', 'unit_id'], used: [['stock_issues', 'item_id'], ['cost_lines', 'item_id'], ['labor_sheet_lines', 'item_id']],
  },
  stages: {
    title: 'مراحل التصنيع', table: 'stages', seq: 'stage',
    fields: [T('name', 'اسم المرحلة', 'text', { req: 1 }), T('seq', 'الترتيب', 'number'), T('account_id', 'حساب إنتاج تحت التشغيل', 'fk', { ref: 'accounts', req: 1 })],
    cols: ['code', 'name', 'seq', 'account_id'], used: [['stock_issues', 'stage_id'], ['cost_lines', 'stage_id'], ['employees', 'default_stage_id'], ['labor_sheet_lines', 'stage_id']],
  },
  sites: {
    title: 'المواقع', table: 'sites', seq: 'site',
    fields: [T('name', 'اسم الموقع', 'text', { req: 1 }), T('project_id', 'المشروع', 'fk', { ref: 'projects' }), T('address', 'العنوان')],
    cols: ['code', 'name', 'project_id', 'address'], used: [['stock_issues', 'site_id'], ['cost_lines', 'site_id']],
  },
  treasuries: {
    title: 'الخزن والبنوك', table: 'treasuries', seq: 'treasury',
    fields: [T('name', 'الاسم', 'text', { req: 1 }), T('type', 'النوع', 'select', { options: [['cash', 'خزينة نقدية'], ['bank', 'حساب بنكي']] }), T('account_id', 'حساب الأستاذ', 'fk', { ref: 'accounts', req: 1 })],
    cols: ['code', 'name', 'type', 'account_id'], used: [['vouchers', 'treasury_id'], ['vouchers', 'to_treasury_id'], ['purchase_invoices', 'treasury_id']],
  },
  custodians: {
    title: 'أصحاب العهد', table: 'custodians', seq: 'custodian',
    fields: [T('employee_id', 'الموظف (صاحب العهدة)', 'fk', { ref: 'employees' }), T('name', 'الاسم (يُؤخذ من الموظف لو فاضي)', 'text', { req: 1 }), T('phone', 'الهاتف')],
    cols: ['code', 'name', 'employee_id', 'phone'], used: [['vouchers', 'custodian_id'], ['purchase_invoices', 'custodian_id']],
  },
  clients: {
    title: 'العملاء', table: 'clients', seq: 'client',
    fields: [T('name', 'اسم العميل', 'text', { req: 1 }), T('phone', 'الهاتف'), T('address', 'العنوان'), T('tax_no', 'الرقم الضريبي'), T('notes', 'ملاحظات', 'textarea')],
    cols: ['code', 'name', 'phone', 'tax_no'], used: [['projects', 'client_id']],
  },
  expense_categories: {
    title: 'فئات المصروفات', table: 'expense_categories', seq: 'expense_category',
    fields: [T('name', 'الاسم', 'text', { req: 1 }), T('cost_class', 'التصنيف', 'select', { options: CLS }), T('account_id', 'حساب المصروف (غير المباشر والإداري)', 'fk', { ref: 'accounts' })],
    cols: ['code', 'name', 'cost_class', 'account_id'], used: [['vouchers', 'category_id'], ['cost_lines', 'category_id']],
  },
  employees: {
    title: 'العاملين', table: 'employees', seq: 'employee',
    fields: [T('name', 'الاسم', 'text', { req: 1 }), T('emp_type', 'نوع العمالة', 'select', { options: [['daily', 'يومية'], ['monthly', 'شهرية']] }),
      T('cost_class', 'تصنيف التكلفة', 'select', { options: CLS }), T('default_stage_id', 'المرحلة الافتراضية (للمباشرة)', 'fk', { ref: 'stages' }),
      T('daily_rate', 'أجر اليوم', 'number'), T('monthly_salary', 'المرتب الشهري', 'number'), T('job_title', 'الوظيفة/الحرفة'), T('phone', 'الهاتف'), T('hire_date', 'تاريخ التعيين', 'date')],
    cols: ['code', 'name', 'emp_type', 'cost_class', 'default_stage_id', 'daily_rate', 'monthly_salary'], used: [['labor_sheet_lines', 'employee_id'], ['payroll_lines', 'employee_id']],
  },
};

const allowed = (M) => ['code', 'active', ...M.fields.map((f) => f.k)];

function clean(M, body, isNew) {
  const o = {};
  for (const f of M.fields) {
    let v = body[f.k];
    if (v === undefined) continue;
    if (v === '' || v === null) v = null;
    else if (f.t === 'number' || f.t === 'fk') v = Number(v);
    if (f.req && (v === null || v === undefined || Number.isNaN(v))) throw new AppError(`الحقل «${f.l}» مطلوب`);
    o[f.k] = v;
  }
  if (isNew) for (const f of M.fields) if (f.req && (o[f.k] === undefined)) throw new AppError(`الحقل «${f.l}» مطلوب`);
  if (body.active !== undefined) o.active = body.active ? 1 : 0;
  return o;
}

async function extraChecks(name, o, id) {
  if (name === 'employees') {
    const cur = id ? await get('SELECT * FROM employees WHERE id=?', id) : {};
    const m = { ...cur, ...o };
    if (m.cost_class === 'direct' && !m.default_stage_id) throw new AppError('العامل بتكلفة مباشرة لازم له مرحلة افتراضية');
  }
  if (name === 'expense_categories') {
    const cur = id ? await get('SELECT * FROM expense_categories WHERE id=?', id) : {};
    const m = { ...cur, ...o };
    if (m.cost_class !== 'direct' && !m.account_id) throw new AppError('فئات المصروفات غير المباشرة والإدارية لازم تتربط بحساب');
  }
  if (name === 'treasuries' || name === 'stages') {
    const a = o.account_id && await get('SELECT postable FROM accounts WHERE id=?', o.account_id);
    if (o.account_id && (!a || !a.postable)) throw new AppError('اختر حساب فرعي (يقبل قيود)');
  }
}

// صاحب العهدة: لو اتحدد موظف ولم يُكتب اسم، الاسم بيتاخد من الموظف
async function prefill(name, body) {
  if (name === 'custodians' && body.employee_id && !String(body.name || '').trim()) body.name = await val('SELECT name FROM employees WHERE id=?', Number(body.employee_id)) || '';
}
export async function masterRouter() {
  const r = Router();
  // القراءة للكل (الشاشات محتاجة القوائم)؛ الكتابة لصلاحية الإعدادات (والعاملين تتاح للموارد البشرية)
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.user.role === 'admin') return next();
    const mods = JSON.parse(req.user.modules || '[]');
    const mod = req.path.startsWith('/employees') ? 'hr' : 'settings';
    if (mods.includes(mod) || (mod === 'hr' && mods.includes('settings'))) return next();
    res.status(403).json({ error: 'ليس لديك صلاحية على التكويد' });
  });
  r.get('/:name', async (req, res) => {
    const M = MASTERS[req.params.name]; if (!M) throw new AppError('غير موجود', 404);
    res.json(await all(`SELECT * FROM ${M.table} ORDER BY code`));
  });
  await r.post('/:name', async (req, res) => {
    const M = MASTERS[req.params.name]; if (!M) throw new AppError('غير موجود', 404);
    await prefill(req.params.name, req.body);
    const o = clean(M, req.body, true); await extraChecks(req.params.name, o, null);
    const code = (req.body.code || '').trim() || await nextNo(M.seq);
    if (await get(`SELECT 1 FROM ${M.table} WHERE code=?`, code)) throw new AppError(`الكود ${code} مستخدم من قبل`);
    const id = await insertRow(M.table, { ...o, code }, allowed(M));
    await audit(req.user, 'create', M.table, id, { code });
    res.json(await get(`SELECT * FROM ${M.table} WHERE id=?`, id));
  });
  r.put('/:name/:id', async (req, res) => {
    const M = MASTERS[req.params.name]; if (!M) throw new AppError('غير موجود', 404);
    const id = Number(req.params.id);
    if (!await get(`SELECT 1 FROM ${M.table} WHERE id=?`, id)) throw new AppError('غير موجود', 404);
    await prefill(req.params.name, req.body);
    const o = clean(M, req.body, false); await extraChecks(req.params.name, o, id);
    if (req.body.code !== undefined) {
      const code = String(req.body.code).trim();
      if (!code) throw new AppError('الكود لا يمكن أن يكون فارغاً');
      if (await get(`SELECT 1 FROM ${M.table} WHERE code=? AND id<>?`, code, id)) throw new AppError(`الكود ${code} مستخدم من قبل`);
      o.code = code;
    }
    await updateRow(M.table, id, o, allowed(M));
    await audit(req.user, 'edit', M.table, id);
    res.json(await get(`SELECT * FROM ${M.table} WHERE id=?`, id));
  });
  r.delete('/:name/:id', async (req, res) => {
    const M = MASTERS[req.params.name]; if (!M) throw new AppError('غير موجود', 404);
    const id = Number(req.params.id);
    let used = false; for (const [t, c] of M.used || []) if (await val(`SELECT COUNT(*) FROM ${t} WHERE ${c}=?`, id) > 0) { used = true; break; }
    if (used) { await run(`UPDATE ${M.table} SET active=0 WHERE id=?`, id); await audit(req.user, 'deactivate', M.table, id); return res.json({ deactivated: true, message: 'الكود مستخدم في حركات — تم تعطيله بدلاً من حذفه' }); }
    await run(`DELETE FROM ${M.table} WHERE id=?`, id); await audit(req.user, 'delete', M.table, id);
    res.json({ deleted: true });
  });
  return r;
}
