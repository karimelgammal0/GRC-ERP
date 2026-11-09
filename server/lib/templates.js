// نماذج القيود: القيود اللي البرنامج بيولّدها فعلاً، مكتوبة كنماذج. كل خط: الجانب + الحساب (دور يحدده البرنامج أو حساب ثابت من الدليل)
import { all, get, run, val, insertRow } from '../db.js';

export const MODULES = { inventory: 'مخزن الخامات', purchases: 'المشتريات', hr: 'الموارد البشرية', finance: 'المالية', accounts: 'الحسابات', manufacturing: 'التصنيع' };

// أدوار الحسابات الديناميكية (بتتحدد من المستند نفسه)
export const DYNAMIC_ROLES = {
  stage_wip: 'حساب إنتاج تحت التشغيل للمرحلة (من إعدادات المراحل)',
  pay_source: 'الخزينة أو العهدة المختارة في المستند',
  treasury: 'الخزينة المختارة',
  treasury_to: 'الخزينة المحوَّل إليها',
  expense_cat: 'حساب بند المصروف المختار',
  chosen: 'الحساب المختار في السند',
};
const D = (role_key, label) => ({ side: 'debit', role_key, label });
const C = (role_key, label) => ({ side: 'credit', role_key, label });

export const SYSTEM_TEMPLATES = [
  { code: 'S-RCV', module: 'purchases', name: 'استلام بضاعة من مورد', description: 'عند ترحيل إذن الاستلام (قبل الفاتورة)', lines: [D('acc_inventory_raw'), C('acc_grni')] },
  { code: 'S-INV', module: 'purchases', name: 'فاتورة شراء آجل', description: 'فروق السعر/النقل بتتضاف لقيمة المخزن مباشرة', lines: [D('acc_inventory_raw'), D('acc_grni', 'استلامات تمت فوترتها'), D('acc_vat_in'), C('acc_ap')] },
  { code: 'S-INV-CASH', module: 'purchases', name: 'فاتورة شراء نقدي', description: 'قيد الفاتورة + سداد فوري', lines: [D('acc_inventory_raw'), D('acc_vat_in'), C('acc_ap'), D('acc_ap', 'سداد الفاتورة'), C('pay_source')] },
  { code: 'S-PRET', module: 'purchases', name: 'مرتجع مشتريات', description: 'إرجاع بضاعة للمورد', lines: [D('acc_ap'), C('acc_inventory_raw')] },
  { code: 'S-ISS-PROD', module: 'inventory', name: 'صرف خامات للتصنيع', description: 'صرف على مشروع/بند/مرحلة', lines: [D('stage_wip'), C('acc_inventory_raw')] },
  { code: 'S-ISS-SITE', module: 'inventory', name: 'صرف خامات لموقع', description: 'تحويل خامات للموقع', lines: [D('acc_site_transfer'), C('acc_inventory_raw')] },
  { code: 'S-ISS-OH', module: 'inventory', name: 'صرف خامات تشغيل غير مباشرة', description: 'مواد تشغيل ليست على مشروع', lines: [D('acc_overhead_materials'), C('acc_inventory_raw')] },
  { code: 'S-ISS-RET', module: 'inventory', name: 'مرتجع صرف', description: 'عكس قيد الصرف الأصلي', lines: [D('acc_inventory_raw'), C('stage_wip', 'أو حساب الموقع/التشغيل حسب الصرف الأصلي')] },
  { code: 'S-ADJ-DEF', module: 'inventory', name: 'جرد — عجز', description: 'تسوية بتؤثر في التكلفة والمخزن مباشرة', lines: [D('acc_overhead_materials', 'تكلفة عجز مخزون'), C('acc_inventory_raw')] },
  { code: 'S-ADJ-SUR', module: 'inventory', name: 'جرد — زيادة', description: 'تسوية بتخفّض التكلفة وتزوّد المخزن', lines: [D('acc_inventory_raw'), C('acc_overhead_materials', 'تخفيض تكلفة (زيادة مخزون)')] },
  { code: 'S-LAB-DIR', module: 'hr', name: 'يومية عمالة مباشرة', description: 'على مرحلة تصنيع', lines: [D('stage_wip'), C('acc_wages_payable')] },
  { code: 'S-LAB-IND', module: 'hr', name: 'يومية/مرتب عمالة غير مباشرة', description: '', lines: [D('acc_indirect_labor'), C('acc_wages_payable')] },
  { code: 'S-LAB-ADM', module: 'hr', name: 'مرتبات إدارية', description: '', lines: [D('acc_admin_labor'), C('acc_wages_payable')] },
  { code: 'S-PAYROLL-DED', module: 'hr', name: 'استقطاعات على المرتب', description: 'لو في استقطاعات على كشف المرتبات', lines: [D('acc_wages_payable', 'جزء الاستقطاع'), C('acc_deductions_payable')] },
  { code: 'V-SUP', module: 'finance', name: 'سند سداد مورد', description: '', lines: [D('acc_ap'), C('pay_source')] },
  { code: 'V-EXP', module: 'finance', name: 'سند مصروف', description: 'تكلفة على مشروع/مرحلة أو غير مباشرة/إدارية', lines: [D('expense_cat'), C('pay_source')] },
  { code: 'V-WAGE', module: 'finance', name: 'سند صرف أجور ومرتبات', description: '', lines: [D('acc_wages_payable'), C('pay_source')] },
  { code: 'V-CUS-OUT', module: 'finance', name: 'صرف عهدة', description: '', lines: [D('acc_custody'), C('treasury')] },
  { code: 'V-CUS-RET', module: 'finance', name: 'رد عهدة', description: '', lines: [D('treasury'), C('acc_custody')] },
  { code: 'V-TRF', module: 'finance', name: 'تحويل بين الخزن', description: '', lines: [D('treasury_to'), C('treasury')] },
  { code: 'V-RCPT', module: 'finance', name: 'سند قبض', description: '', lines: [D('treasury'), C('chosen')] },
  { code: 'V-PAY', module: 'finance', name: 'سند صرف آخر', description: '', lines: [D('chosen'), C('pay_source')] },
  { code: 'S-OPEN', module: 'accounts', name: 'أرصدة افتتاحية', description: 'مخزون + موردين + خزن، والفرق على حقوق الملكية', lines: [D('acc_inventory_raw'), D('treasury', 'أرصدة الخزن'), C('acc_ap'), C('acc_opening_equity', 'الفرق')] },
];

export async function seedTemplates() {
  for (const t of SYSTEM_TEMPLATES) {
    let id = await val('SELECT id FROM journal_templates WHERE code=?', t.code);
    if (!id) id = await insertRow('journal_templates', { code: t.code, name: t.name, module: t.module, description: t.description || '', system: 1 }, ['code', 'name', 'module', 'description', 'system']);
    else await run('UPDATE journal_templates SET name=?, module=?, description=?, system=1 WHERE id=?', t.name, t.module, t.description || '', id);
    await run('DELETE FROM journal_template_lines WHERE template_id=?', id);
    let seq = 0;
    for (const l of t.lines) await insertRow('journal_template_lines', { template_id: id, seq: seq++, side: l.side, role_key: l.role_key, label: l.label || null }, ['template_id', 'seq', 'side', 'role_key', 'label']);
  }
}

// تحميل النماذج مع الحسابات المقابلة (للأدوار المربوطة بالإعدادات بنجيب الحساب الفعلي)
export async function loadTemplates(id) {
  const ts = await all(`SELECT * FROM journal_templates ${id ? 'WHERE id=?' : ''} ORDER BY system DESC, module, code`, ...(id ? [id] : []));
  const settings = Object.fromEntries((await all(`SELECT key, value FROM settings WHERE key LIKE 'acc_%'`)).map((s) => [s.key, Number(s.value)]));
  const accs = Object.fromEntries((await all('SELECT id, code, name FROM accounts')).map((a) => [a.id, a]));
  const { ACC_KEYS } = await import('./core.js');
  for (const t of ts) {
    t.module_name = MODULES[t.module] || t.module;
    t.lines = await all('SELECT * FROM journal_template_lines WHERE template_id=? ORDER BY seq, id', t.id);
    for (const l of t.lines) {
      const aid = l.account_id || (l.role_key && settings[l.role_key]) || null;
      const a = aid ? accs[aid] : null;
      l.resolved_account_id = a ? a.id : null; l.account_code = a ? a.code : null; l.account_name = a ? a.name : null;
      l.role_name = l.role_key ? (ACC_KEYS[l.role_key] || DYNAMIC_ROLES[l.role_key] || l.role_key) : null;
      l.dynamic = !!(l.role_key && DYNAMIC_ROLES[l.role_key]);
    }
  }
  return ts;
}
