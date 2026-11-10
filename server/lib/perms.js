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
  { id: 'inventory', title: 'مخازن المواد الخام', pages: [
    P('issues', 'صرف للإنتاج والتشغيل', [...DOC, ['add_item', 'إضافة بند مشروع من الشاشة']]), P('site-transfers', 'التحويل للمواقع', DOC), P('returns', 'مرتجع للمخزن', DOC), P('adjustments', 'جرد وتسويات', DOC),
    P('balances', 'أرصدة المخزون'), P('stock-card', 'كارت الصنف'), P('moves', 'حركة المخزون')] },
  { id: 'purchases', title: 'المشتريات', pages: [
    P('requests', 'طلبات الشراء', [...DOC, ['close', 'إغلاق']]), P('orders', 'أوامر الشراء', [...DOC, ['close', 'إغلاق الأمر']]), P('receipts', 'إذونات الاستلام', DOC), P('invoices', 'فواتير الشراء', DOC),
    P('returns', 'مرتجعات الشراء', DOC), P('supplier-statement', 'كشف حساب مورد'), P('supplier-balances', 'أرصدة الموردين')] },
  { id: 'hr', title: 'الموارد البشرية', pages: [P('employees', 'العاملين', CRUD), P('labor', 'يوميات العمالة', DOC), P('payroll', 'الرواتب الشهرية', DOC)] },
  { id: 'finance', title: 'الإدارة المالية', pages: [
    P('treasuries', 'الخزن والعهد (الأرصدة)'), P('supplier-payments', 'سداد الموردين', DOC), P('expenses', 'سندات المصروفات', DOC), P('wages', 'صرف الأجور', DOC), P('custody', 'سندات العهد', DOC),
    P('transfers', 'تحويلات بين الخزن', DOC), P('other', 'سندات قبض/صرف أخرى', DOC), P('treasury-statement', 'كشف خزينة'), P('custody-statement', 'كشف عهدة')] },
  { id: 'accounts', title: 'الحسابات', pages: [
    P('chart', 'دليل الحسابات', [...CRUD, ['import', 'استيراد CSV']]), P('periods', 'الفترات المالية', [['generate', 'إنشاء فترات سنة'], ['toggle', 'قفل / فتح فترة']]),
    P('journals', 'قيود اليومية', CRUD), P('templates', 'نماذج القيود', CRUD), P('account-links', 'ربط الحسابات', [['edit', 'تعديل الربط']])] },
  { id: 'reports', title: 'التقارير', pages: [
    P('hub', 'كل التقارير'), P('project-stage', 'تكلفة المشاريع × المراحل'), P('stage-project', 'تكلفة المراحل × المشاريع'), P('project-analysis', 'تحليل مشروع (بنود)'), P('material-usage', 'استهلاك الخامات'),
    P('cost-detail', 'تفاصيل التكاليف'), P('expenses', 'المصروفات'), P('labor', 'العمالة'), P('trial-balance', 'ميزان المراجعة'), P('ledger', 'أستاذ الحساب'), P('income', 'قائمة الدخل')] },
  { id: 'settings', title: 'الإعدادات', pages: [
    P('general', 'عام (بيانات الشركة)', [['edit', 'تعديل']]), P('opening', 'الأرصدة الافتتاحية', [['edit', 'حفظ وتطبيق'], ['lock', 'قفل نهائي'], ['unlock', 'فك القفل']]),
    P('materials', 'الخامات', CRUD), P('categories', 'فئات الخامات', CRUD), P('units', 'وحدات القياس', CRUD), P('warehouses', 'المخازن', CRUD), P('clients', 'العملاء', CRUD), P('projects', 'المشروعات', CRUD),
    P('project-items', 'بنود المشروعات', CRUD), P('stages', 'مراحل التصنيع', CRUD), P('sites', 'المواقع', CRUD), P('suppliers', 'الموردين', CRUD), P('treasuries', 'الخزن والبنوك', CRUD),
    P('custodians', 'العهد', CRUD), P('expense-cats', 'المصروفات', CRUD), P('employees', 'العاملين', CRUD), P('sequences', 'ترقيم المستندات', [['edit', 'تعديل']])] },
];

export const PAGE_KEYS = CATALOG.flatMap((m) => m.pages.map((p) => `${m.id}.${p.id}`));
export const ALL_KEYS = CATALOG.flatMap((m) => m.pages.flatMap((p) => [`${m.id}.${p.id}`, ...p.actions.map(([a]) => `${m.id}.${p.id}.${a}`)]));
const ALL_SET = new Set(ALL_KEYS);

// كانت للمدير فقط في النظام القديم — مبتتمنحش تلقائياً للمستخدم القديم
const LEGACY_EXCLUDE = new Set(['settings.general.edit', 'settings.opening.edit', 'settings.opening.lock', 'settings.opening.unlock', 'settings.sequences.edit', 'accounts.chart.import', 'accounts.account-links.edit', 'inventory.issues.add_item']);

export function userPerms(u) {
  if (!u) return new Set();
  if (u.role === 'admin') return new Set(ALL_KEYS);
  let p = null;
  try { p = u.perms ? JSON.parse(u.perms) : null; } catch { p = null; }
  if (Array.isArray(p)) return new Set(p.filter((k) => ALL_SET.has(k)));
  const mods = JSON.parse(u.modules || '[]'); const out = new Set();
  for (const k of ALL_KEYS) if (mods.includes(k.split('.')[0]) && !LEGACY_EXCLUDE.has(k)) out.add(k);
  if (mods.includes('perm_add_items')) out.add('inventory.issues.add_item');
  return out;
}
/** مفتاح واحد أو مصفوفة (أي واحد منها يكفي) */
export const can = (u, key) => { if (u?.role === 'admin') return true; const s = userPerms(u); return (Array.isArray(key) ? key : [key]).some((k) => s.has(k)); };
export const canModule = (u, mod) => u?.role === 'admin' || [...userPerms(u)].some((k) => k.startsWith(mod + '.'));
export const need = (u, key, msg = 'ليس لديك صلاحية لهذا الإجراء') => { if (!can(u, key)) throw new AppError(msg, 403); };
/** يطبّع قائمة جاية من الواجهة: مفاتيح معروفة فقط، وأي إجراء يستلزم مفتاح صفحته */
export function cleanPerms(list) {
  const s = new Set((Array.isArray(list) ? list : []).filter((k) => ALL_SET.has(k)));
  for (const k of [...s]) { const parts = k.split('.'); if (parts.length === 3) s.add(parts.slice(0, 2).join('.')); }
  return [...s];
}
export const modulesOf = (perms) => [...new Set(perms.map((k) => k.split('.')[0]))];
