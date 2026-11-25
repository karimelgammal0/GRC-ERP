// ============================================================
//  نظام الصلاحيات: موديول ← صفحة ← إجراء (زرار)
//   مفتاح الصفحة:   module.page            (يعني: يشوف الصفحة)
//   مفتاح الإجراء:  module.page.action     (يعني: يضغط الزرار)
//  المدير (role=admin) عنده كل شيء دايماً. باقي المستخدمين: users.perms (JSON).
//  المستخدم القديم (perms=NULL) بيتحوّل تلقائياً من الموديولات اللي كان واخدها.
// ============================================================
import { AppError } from '../db.js';

const DOC = [['create', 'إنشاء'], ['edit', 'تعديل'], ['void', 'إلغاء']];
const CRUD = [['create', 'إضافة'], ['edit', 'تعديل'], ['delete', 'حذف']];
const P = (id, title, actions = []) => ({ id, title, actions });

export const CATALOG = [
  { id: 'dashboard', title: 'لوحة التحكم', pages: [P('home', 'نظرة عامة')] },
  { id: 'inventory', title: 'المخازن', pages: [
    P('issues', 'صرف للإنتاج والتشغيل', [...DOC, ['add_item', 'إضافة بند مشروع من الشاشة'], ['reopen', 'إعادة فتح إذن معتمد للتعديل']]), P('site-transfers', 'تحويلات المواقع', [...DOC, ['reopen', 'إعادة فتح إذن معتمد للتعديل']]), P('returns', 'مرتجع للمخزن', DOC), P('adjustments', 'جرد وتسويات', DOC),
    P('balances', 'أرصدة المخزون'), P('stock-card', 'كارت الصنف'), P('moves', 'حركة المخزون')] },
  { id: 'purchases', title: 'المشتريات', pages: [
    P('requests', 'طلبات الشراء', [...DOC, ['close', 'إغلاق']]), P('orders', 'أوامر التوريد', [...DOC, ['close', 'إغلاق الأمر']]), P('receipts', 'إذونات الاستلام', DOC), P('invoices', 'فواتير الشراء', DOC),
    P('returns', 'مرتجعات الشراء', DOC), P('supplier-statement', 'كشف حساب مورد'), P('supplier-balances', 'أرصدة الموردين')] },
  { id: 'hr', title: 'الموارد البشرية', pages: [P('labor', 'يوميات العمالة', [...DOC, ['reopen', 'إعادة فتح كشف معتمد للتعديل']]), P('labor-advances', 'سلف عمال يومية', DOC), P('payroll', 'الرواتب الشهرية', DOC)] },
  { id: 'finance', title: 'الإدارة المالية', pages: [
    P('treasuries', 'أرصدة الخزن والعهد'), P('custody', 'سندات العهد والتحويلات', DOC), P('expenses', 'سندات المدفوعات (مصروفات وسداد موردين)', DOC), P('other', 'سندات المقبوضات', DOC),
    P('wages', 'صرف الأجور', DOC), P('custody-statement', 'كشف حساب عهد'), P('treasury-statement', 'كشف حساب خزينة (من أرصدة الخزن)')] },
  { id: 'accounts', title: 'الحسابات', pages: [
    P('chart', 'دليل الحسابات', [...CRUD, ['import', 'استيراد CSV']]), P('periods', 'الفترات المالية', [['generate', 'إنشاء فترات سنة'], ['toggle', 'قفل / فتح فترة']]),
    P('journals', 'قيود اليومية', CRUD), P('templates', 'نماذج القيود', CRUD), P('account-links', 'ربط الحسابات', [['edit', 'تعديل الربط']]), P('sequences', 'ترقيم المستندات', [['edit', 'تعديل']])] },
  { id: 'production', title: 'الإنتاج التام', pages: [P('log', 'سجل الإنتاج التام', DOC), P('quantities', 'كميات الإنتاج التام')] },
  { id: 'sales', title: 'المبيعات والمستخلصات', pages: [P('deliveries', 'إذونات تسليم للعملاء', DOC), P('certificates', 'مستخلصات العملاء', DOC), P('fg-stock', 'مخزن المنتجات التامة'), P('client-balances', 'أرصدة العملاء وأعمار الديون'), P('client-statement', 'كشف حساب عميل'), P('profitability', 'ربحية المشروعات')] },
  { id: 'costs', title: 'تكاليف', pages: [
    P('unit-cost', 'تكلفة المتر GRC / GRP', [['save', 'حفظ المدخلات'], ['approve', 'اعتماد الشهر'], ['reopen', 'إعادة فتح شهر معتمد']]), P('history', 'سجل أسعار المتر'), P('projects-cost', 'تكاليف مشروعات (تكلفة المنتج التام)', [['save', 'حفظ المرحّل'], ['approve', 'اعتماد تكلفة المنتج التام'], ['reopen', 'إعادة فتح تشغيل معتمد']]), P('config', 'ربط المراحل والأسمنت', [['edit', 'تعديل']])] },
  { id: 'reports', title: 'التقارير', pages: [
    P('hub', 'كل التقارير'), P('project-stage', 'تكلفة المشاريع × المراحل'), P('stage-project', 'تكلفة المراحل × المشاريع'), P('project-analysis', 'تحليل مشروع (بنود)'), P('material-usage', 'استهلاك الأصناف'),
    P('factory-cost', 'تكاليف المصنع (مباشرة/غير مباشرة/إدارية)'), P('cost-detail', 'تفاصيل التكاليف'), P('expenses', 'المصروفات'), P('labor', 'العمالة'), P('trial-balance', 'ميزان المراجعة'), P('ledger', 'كشف حساب أستاذ'), P('income', 'قائمة الدخل')] },
  { id: 'settings', title: 'الإعدادات', pages: [
    P('general', 'عام (بيانات الشركة)', [['edit', 'تعديل']]), P('opening', 'الأرصدة الافتتاحية', [['edit', 'حفظ وتطبيق'], ['lock', 'قفل نهائي'], ['unlock', 'فك القفل']]),
    P('materials', 'الأصناف', CRUD), P('categories', 'فئات الأصناف', CRUD), P('units', 'وحدات القياس', CRUD), P('warehouses', 'المخازن', CRUD), P('clients', 'العملاء', CRUD), P('projects', 'المشروعات', CRUD),
    P('project-items', 'بنود المشروعات', CRUD), P('deduction-types', 'الخصومات والإضافات (للمستخلص)', CRUD), P('stages', 'مراحل التصنيع', CRUD), P('sites', 'المواقع', CRUD), P('suppliers', 'الموردين', CRUD), P('treasuries', 'الخزن والبنوك', CRUD),
    P('custodians', 'العهد', CRUD), P('expense-cats', 'المصروفات', CRUD), P('payment-types', 'أنواع المدفوعات', CRUD), P('receipt-types', 'أنواع المقبوضات', CRUD), P('employees', 'العاملين', CRUD)] },
];

export const PAGE_KEYS = CATALOG.flatMap((m) => m.pages.map((p) => `${m.id}.${p.id}`));
export const ALL_KEYS = CATALOG.flatMap((m) => m.pages.flatMap((p) => [`${m.id}.${p.id}`, ...p.actions.map(([a]) => `${m.id}.${p.id}.${a}`)]));
const ALL_SET = new Set(ALL_KEYS);

// كانت للمدير فقط في النظام القديم — مبتتمنحش تلقائياً للمستخدم القديم
const LEGACY_EXCLUDE = new Set(['settings.general.edit', 'settings.opening.edit', 'settings.opening.lock', 'settings.opening.unlock', 'accounts.sequences.edit', 'accounts.chart.import', 'accounts.account-links.edit', 'inventory.issues.add_item', 'inventory.issues.reopen', 'inventory.site-transfers.reopen', 'hr.labor.reopen']);

export function userPerms(u) {
  if (!u) return new Set();
  if (u.role === 'admin') return new Set(ALL_KEYS);
  let p = null;
  try { p = u.perms ? JSON.parse(u.perms) : null; } catch { p = null; }
  // الترقيم اتنقل من الإعدادات للحسابات: نحافظ على صلاحيات المستخدمين المحفوظة بالمفتاح القديم
  if (Array.isArray(p)) return new Set(p.map((k) => k.replace(/^settings\.sequences/, 'accounts.sequences').replace(/^finance\.supplier-payments/, 'finance.expenses').replace(/^finance\.transfers/, 'finance.custody')).filter((k) => ALL_SET.has(k)));
  const mods = JSON.parse(u.modules || '[]'); const out = new Set();
  for (const k of ALL_KEYS) if (mods.includes(k.split('.')[0]) && !LEGACY_EXCLUDE.has(k)) out.add(k);
  if (mods.includes('perm_add_items')) out.add('inventory.issues.add_item');
  return out;
}
/** مفتاح واحد أو مصفوفة (أي واحد منها يكفي) */
export const can = (u, key) => { if (u?.role === 'admin') return true; const s = userPerms(u); return (Array.isArray(key) ? key : [key]).some((k) => s.has(k)); };
export const canModule = (u, mod) => u?.role === 'admin' || [...userPerms(u)].some((k) => k.startsWith(mod + '.'));
/** المرتبات والأجور اليومية: لا تُعرض إلا لمن عنده صلاحية على الموارد البشرية أو كود العاملين */
export const canSeeSalaries = (u) => can(u, ['hr.labor', 'hr.payroll', 'hr.employees', 'settings.employees']);
export const maskEmployees = (rows, u) => (canSeeSalaries(u) ? rows : rows.map((r) => ({ ...r, daily_rate: 0, monthly_salary: 0 })));
export const need = (u, key, msg = 'ليس لديك صلاحية لهذا الإجراء') => { if (!can(u, key)) throw new AppError(msg, 403); };
/** يطبّع قائمة جاية من الواجهة: مفاتيح معروفة فقط، وأي إجراء يستلزم مفتاح صفحته */
export function cleanPerms(list) {
  const s = new Set((Array.isArray(list) ? list : []).filter((k) => ALL_SET.has(k)));
  for (const k of [...s]) { const parts = k.split('.'); if (parts.length === 3) s.add(parts.slice(0, 2).join('.')); }
  return [...s];
}
export const modulesOf = (perms) => [...new Set(perms.map((k) => k.split('.')[0]))];
