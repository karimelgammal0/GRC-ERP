import { all, get, run, val, AppError } from '../db.js';

// ---------- الإعدادات ----------
export const getSetting = async (k, d = null) => { const v = await val('SELECT value FROM settings WHERE key=?', k); return v === undefined || v === null ? d : v; };
export const setSetting = async (k, v) => await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v === null ? null : String(v));
export const allSettings = async () => Object.fromEntries((await all('SELECT key,value FROM settings')).map((r) => [r.key, r.value]));

export const ACC_KEYS = {
  acc_inventory_raw: 'مخزون الأصناف',
  acc_ap: 'الموردين (دائنون)',
  acc_vat_in: 'ضريبة القيمة المضافة — مدخلات',
  acc_wages_payable: 'أجور ومرتبات مستحقة',
  acc_deductions_payable: 'استقطاعات العاملين',
  acc_employee_advances: 'سلف العاملين',
  acc_ar: 'العملاء (مدينون)',
  acc_custody: 'العهد',
  acc_opening_equity: 'أرصدة افتتاحية (حقوق ملكية)',
  acc_site_transfer: 'أصناف محولة للمواقع',
  acc_overhead_materials: 'أصناف تشغيل غير مباشرة',
  acc_indirect_labor: 'أجور مباشرة (أجور عمال ومرتبات تشغيل)',
  acc_admin_labor: 'مرتبات وأجور إدارية',
  acc_fg: 'مخزن المنتجات التامة',
  acc_cogs: 'تكلفة المبيعات',
  acc_revenue: 'إيرادات المبيعات (توريد)',
  acc_vat_out: 'ضريبة القيمة المضافة — مبيعات',
  acc_stock_materials: 'مواد مخزنية (مستهلكة في الإنتاج)',
};
export async function acc(key) {
  const id = Number(await getSetting(key));
  if (!id) throw new AppError(`حساب «${ACC_KEYS[key] || key}» غير مربوط — اربطه من الحسابات ← ربط الحسابات`);
  const a = await get('SELECT name, postable FROM accounts WHERE id=?', id);
  if (a && !a.postable) throw new AppError(`ربط «${ACC_KEYS[key] || key}» بيشاور على الحساب «${a.name}» وهو حساب رئيسي لا يقبل قيود — غيّره من الحسابات ← ربط الحسابات واختار حساب فرعي`);
  return id;
}

// ---------- الترقيم ----------
export async function nextNo(key) {
  const s = await get('SELECT * FROM sequences WHERE key=?', key);
  if (!s) throw new AppError(`ترقيم غير معرّف: ${key}`, 500);
  const table = SEQ_TABLE[key];
  for (;;) {
    const no = `${s.prefix}${String((await get('SELECT next_no FROM sequences WHERE key=?', key)).next_no).padStart(s.padding, '0')}`;
    await run('UPDATE sequences SET next_no=next_no+1 WHERE key=?', key);
    if (!table || !await get(`SELECT 1 FROM ${table.t} WHERE ${table.c}=?`, no)) return no;
  }
}
/** الرقم القادم لترقيم معيّن بدون ما يتحجز (للعرض على الشاشة قبل الحفظ) — نفس منطق nextNo */
export async function peekNo(key) {
  const s = await get('SELECT * FROM sequences WHERE key=?', key);
  if (!s) return null;
  const table = SEQ_TABLE[key];
  for (let n = Number(s.next_no), i = 0; i < 1000; n++, i++) {
    const no = `${s.prefix}${String(n).padStart(s.padding, '0')}`;
    if (!table || !await get(`SELECT 1 FROM ${table.t} WHERE ${table.c}=?`, no)) return no;
  }
  return null;
}
// جدول/عمود الفحص عشان مفيش تكرار لو في كود اتكتب يدوي
const SEQ_TABLE = {
  unit: { t: 'units', c: 'code' }, material_category: { t: 'material_categories', c: 'code' },
  material: { t: 'materials', c: 'code' }, warehouse: { t: 'warehouses', c: 'code' },
  supplier: { t: 'suppliers', c: 'code' }, project: { t: 'projects', c: 'code' },
  project_item: { t: 'project_items', c: 'code' }, stage: { t: 'stages', c: 'code' },
  site: { t: 'sites', c: 'code' }, fg_type: { t: 'finished_types', c: 'code' }, treasury: { t: 'treasuries', c: 'code' },
  custodian: { t: 'custodians', c: 'code' }, expense_category: { t: 'expense_categories', c: 'code' },
  employee: { t: 'employees', c: 'code' }, payment_type: { t: 'payment_types', c: 'code' }, receipt_type: { t: 'receipt_types', c: 'code' },
  purchase_request: { t: 'purchase_requests', c: 'no' }, purchase_order: { t: 'purchase_orders', c: 'no' },
  goods_receipt: { t: 'goods_receipts', c: 'no' }, purchase_invoice: { t: 'purchase_invoices', c: 'no' },
  purchase_return: { t: 'purchase_returns', c: 'no' }, stock_issue: { t: 'stock_issues', c: 'no' },
  stock_return: { t: 'stock_issues', c: 'no' }, stock_site_in: { t: 'stock_issues', c: 'no' }, stock_adjustment: { t: 'stock_adjustments', c: 'no' },
  labor_sheet: { t: 'labor_sheets', c: 'no' }, labor_advance: { t: 'labor_advances', c: 'no' }, payroll: { t: 'payroll_runs', c: 'no' },
  journal: { t: 'journal_entries', c: 'no' },
  production_log: { t: 'production_logs', c: 'no' }, delivery_note: { t: 'delivery_notes', c: 'no' }, client_certificate: { t: 'client_certificates', c: 'no' },
  deduction_type: { t: 'deduction_types', c: 'code' },
  v_supplier_payment: { t: 'vouchers', c: 'no' }, v_expense: { t: 'vouchers', c: 'no' }, v_wage_payment: { t: 'vouchers', c: 'no' },
  v_custody_issue: { t: 'vouchers', c: 'no' }, v_custody_return: { t: 'vouchers', c: 'no' }, v_transfer: { t: 'vouchers', c: 'no' },
  v_receipt: { t: 'vouchers', c: 'no' }, v_payment_other: { t: 'vouchers', c: 'no' },
};

export const DEFAULT_SEQUENCES = [
  ['unit', 'الوحدات', 'UN-', 3], ['material_category', 'فئات الأصناف', 'MC-', 3], ['material', 'الأصناف', 'RM-', 4],
  ['warehouse', 'المخازن', 'WH-', 2], ['supplier', 'الموردين', 'SUP-', 4], ['project', 'المشروعات', 'PRJ-', 3],
  ['project_item', 'بنود المشروعات', 'BND-', 4], ['stage', 'المراحل', 'STG-', 2], ['site', 'المواقع', 'SITE-', 3], ['fg_type', 'أنواع المنتج التام', 'FGT-', 2],
  ['treasury', 'الخزن والبنوك', 'TR-', 2], ['custodian', 'العهد', 'CUS-', 3], ['client', 'العملاء', 'CL-', 3], ['expense_category', 'المصروفات', 'EXC-', 3],
  ['employee', 'العاملين', 'EMP-', 4], ['payment_type', 'أنواع المدفوعات', 'PT-', 3], ['receipt_type', 'أنواع المقبوضات', 'RT-', 3],
  ['purchase_request', 'طلبات الشراء', 'PR-', 5], ['purchase_order', 'أوامر التوريد', 'PO-', 5], ['goods_receipt', 'إذون الاستلام', 'GRN-', 5],
  ['purchase_invoice', 'فواتير الشراء', 'PINV-', 5], ['purchase_return', 'مرتجعات المشتريات', 'PRT-', 5],
  ['stock_issue', 'إذون الصرف', 'ISS-', 5], ['stock_return', 'مرتجعات الصرف', 'RTN-', 5], ['stock_site_in', 'تحويلات واردة من مواقع', 'TIN-', 5], ['stock_adjustment', 'جرد وتسوية', 'ADJ-', 5],
  ['labor_sheet', 'كشوف اليوميات', 'LAB-', 5], ['labor_advance', 'سلف عمال يومية', 'LADV-', 5], ['payroll', 'كشوف الرواتب', 'PAYR-', 5], ['journal', 'قيود اليومية', 'JE-', 6],
  ['v_supplier_payment', 'سداد موردين', 'SP-', 5], ['v_expense', 'سندات مصروفات', 'EXP-', 5], ['v_wage_payment', 'صرف أجور', 'WP-', 5],
  ['v_custody_issue', 'صرف عهدة', 'CI-', 5], ['v_custody_return', 'رد عهدة', 'CR-', 5], ['v_transfer', 'تحويل بين الخزن', 'TRF-', 5],
  ['v_receipt', 'سندات قبض', 'RCV-', 5], ['v_payment_other', 'سندات صرف أخرى', 'PYO-', 5],
  ['production_log', 'سجلات الإنتاج التام', 'PRD-', 5], ['delivery_note', 'أذون تسليم للعميل', 'DLV-', 5], ['client_certificate', 'مستخلصات العملاء', 'CERT-', 4], ['deduction_type', 'الخصومات والإضافات', 'DED-', 3],
];

// ---------- الفترات المالية ----------
export async function periodOf(date) {
  return await get('SELECT * FROM fiscal_periods WHERE ? BETWEEN start_date AND end_date', date);
}
export async function assertOpenPeriod(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new AppError('التاريخ غير صحيح');
  const p = await periodOf(date);
  if (!p) throw new AppError(`لا توجد فترة مالية تشمل التاريخ ${date} — أضفها من الحسابات ← الفترات المالية`);
  if (p.status === 'closed') throw new AppError(`الفترة المالية «${p.name}» مقفلة — لا يمكن تسجيل أو تعديل أو إلغاء حركة بتاريخ ${date}`);
  return p;
}

// ---------- سجل التدقيق ----------
export async function audit(user, action, entity, entityId, details) {
  await run('INSERT INTO audit_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,?,?,?,?)',
    user?.id ?? null, user?.username ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const needFields = (o, fields) => {
  for (const [k, label] of Object.entries(fields)) if (o[k] === undefined || o[k] === null || o[k] === '') throw new AppError(`الحقل «${label}» مطلوب`);
};
