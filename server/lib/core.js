import { all, get, run, val, AppError } from '../db.js';

// ---------- الإعدادات ----------
export const getSetting = async (k, d = null) => { const v = await val('SELECT value FROM settings WHERE key=?', k); return v === undefined || v === null ? d : v; };
export const setSetting = async (k, v) => await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v === null ? null : String(v));
export const allSettings = async () => Object.fromEntries((await all('SELECT key,value FROM settings')).map((r) => [r.key, r.value]));

export const ACC_KEYS = {
  acc_inventory_raw: 'مخزون الخامات',
  acc_ap: 'الموردين (دائنون)',
  acc_grni: 'استلامات غير مفوترة',
  acc_vat_in: 'ضريبة القيمة المضافة — مدخلات',
  acc_wages_payable: 'أجور ومرتبات مستحقة',
  acc_deductions_payable: 'استقطاعات العاملين',
  acc_custody: 'العهد',
  acc_opening_equity: 'أرصدة افتتاحية (حقوق ملكية)',
  acc_site_transfer: 'خامات محولة للمواقع',
  acc_overhead_materials: 'خامات تشغيل غير مباشرة',
  acc_indirect_labor: 'أجور غير مباشرة',
  acc_admin_labor: 'مرتبات وأجور إدارية',
};
export async function acc(key) {
  const id = Number(await getSetting(key));
  if (!id) throw new AppError(`حساب «${ACC_KEYS[key] || key}» غير مربوط — اربطه من الإعدادات ← ربط الحسابات`);
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
// جدول/عمود الفحص عشان مفيش تكرار لو في كود اتكتب يدوي
const SEQ_TABLE = {
  unit: { t: 'units', c: 'code' }, material_category: { t: 'material_categories', c: 'code' },
  material: { t: 'materials', c: 'code' }, warehouse: { t: 'warehouses', c: 'code' },
  supplier: { t: 'suppliers', c: 'code' }, project: { t: 'projects', c: 'code' },
  project_item: { t: 'project_items', c: 'code' }, stage: { t: 'stages', c: 'code' },
  site: { t: 'sites', c: 'code' }, treasury: { t: 'treasuries', c: 'code' },
  custodian: { t: 'custodians', c: 'code' }, expense_category: { t: 'expense_categories', c: 'code' },
  employee: { t: 'employees', c: 'code' },
  purchase_request: { t: 'purchase_requests', c: 'no' }, purchase_order: { t: 'purchase_orders', c: 'no' },
  goods_receipt: { t: 'goods_receipts', c: 'no' }, purchase_invoice: { t: 'purchase_invoices', c: 'no' },
  purchase_return: { t: 'purchase_returns', c: 'no' }, stock_issue: { t: 'stock_issues', c: 'no' },
  stock_return: { t: 'stock_issues', c: 'no' }, stock_adjustment: { t: 'stock_adjustments', c: 'no' },
  labor_sheet: { t: 'labor_sheets', c: 'no' }, payroll: { t: 'payroll_runs', c: 'no' },
  journal: { t: 'journal_entries', c: 'no' },
  v_supplier_payment: { t: 'vouchers', c: 'no' }, v_expense: { t: 'vouchers', c: 'no' }, v_wage_payment: { t: 'vouchers', c: 'no' },
  v_custody_issue: { t: 'vouchers', c: 'no' }, v_custody_return: { t: 'vouchers', c: 'no' }, v_transfer: { t: 'vouchers', c: 'no' },
  v_receipt: { t: 'vouchers', c: 'no' }, v_payment_other: { t: 'vouchers', c: 'no' },
};

export const DEFAULT_SEQUENCES = [
  ['unit', 'الوحدات', 'UN-', 3], ['material_category', 'فئات الخامات', 'MC-', 3], ['material', 'الخامات', 'RM-', 4],
  ['warehouse', 'المخازن', 'WH-', 2], ['supplier', 'الموردين', 'SUP-', 4], ['project', 'المشروعات', 'PRJ-', 3],
  ['project_item', 'بنود المشروعات', 'BND-', 4], ['stage', 'المراحل', 'STG-', 2], ['site', 'المواقع', 'SITE-', 3],
  ['treasury', 'الخزن والبنوك', 'TR-', 2], ['custodian', 'العهد', 'CUS-', 3], ['client', 'العملاء', 'CL-', 3], ['expense_category', 'المصروفات', 'EXC-', 3],
  ['employee', 'العاملين', 'EMP-', 4],
  ['purchase_request', 'طلبات الشراء', 'PR-', 5], ['purchase_order', 'أوامر الشراء', 'PO-', 5], ['goods_receipt', 'إذون الاستلام', 'GRN-', 5],
  ['purchase_invoice', 'فواتير الشراء', 'PINV-', 5], ['purchase_return', 'مرتجعات المشتريات', 'PRT-', 5],
  ['stock_issue', 'إذون الصرف', 'ISS-', 5], ['stock_return', 'مرتجعات الصرف', 'RTN-', 5], ['stock_adjustment', 'جرد وتسوية', 'ADJ-', 5],
  ['labor_sheet', 'كشوف اليوميات', 'LAB-', 5], ['payroll', 'مسيرات الرواتب', 'PAYR-', 5], ['journal', 'قيود اليومية', 'JE-', 6],
  ['v_supplier_payment', 'سداد موردين', 'SP-', 5], ['v_expense', 'سندات مصروفات', 'EXP-', 5], ['v_wage_payment', 'صرف أجور', 'WP-', 5],
  ['v_custody_issue', 'صرف عهدة', 'CI-', 5], ['v_custody_return', 'رد عهدة', 'CR-', 5], ['v_transfer', 'تحويل بين الخزن', 'TRF-', 5],
  ['v_receipt', 'سندات قبض', 'RCV-', 5], ['v_payment_other', 'سندات صرف أخرى', 'PYO-', 5],
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
