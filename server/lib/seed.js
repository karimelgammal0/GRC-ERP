import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { all, get, run, val, tx, insertRow } from '../db.js';
import { applyChart, readChartFile, inUse } from './coa.js';
import { seedTemplates } from './templates.js';
import { setSetting, getSetting, DEFAULT_SEQUENCES, nextNo } from './core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'seed');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, hash) {
  const [salt, h] = String(hash).split(':');
  return h && crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
}

const MAPPING = {
  acc_inventory_raw: '1221', acc_ap: '2110', acc_grni: '2140', acc_vat_in: '1231', acc_wages_payable: '2130', acc_deductions_payable: '2150',
  acc_custody: '1213', acc_opening_equity: '3400', acc_site_transfer: '5200', acc_overhead_materials: '5300',
  acc_indirect_labor: '5100', acc_admin_labor: '6100',
};

export async function ensureBaseData() {
  // سحب حسابات فروق الأسعار وعجز/زيادة المخزون (بقت تسويات بتروح للتكلفة والمخزن مباشرة)
  await run(`DELETE FROM settings WHERE key IN ('acc_price_variance','acc_inventory_adjust')`);
  for (const code of ['5700', '5800']) {
    const a = await get('SELECT id, name FROM accounts WHERE code=?', code);
    if (a && /فروق أسعار|عجز وزيادة/.test(a.name)) {
      if (await inUse(a.id)) await run('UPDATE accounts SET active=0 WHERE id=?', a.id);
      else await run('DELETE FROM accounts WHERE id=?', a.id);
    }
  }
  for (const [key, label, prefix, padding] of DEFAULT_SEQUENCES)
    await run('INSERT INTO sequences(key,label,prefix,padding) VALUES(?,?,?,?) ON CONFLICT DO NOTHING', key, label, prefix, padding);
  await seedTemplates();
  // ترحيل أسماء العملاء القديمة (نص في المشروع) إلى جدول العملاء وربطها
  const names = await all(`SELECT DISTINCT TRIM(client) n FROM projects WHERE client IS NOT NULL AND TRIM(client)<>'' AND client_id IS NULL`);
  for (const { n } of names) {
    let id = await val('SELECT id FROM clients WHERE name=?', n);
    if (!id) id = await insertRow('clients', { code: await nextNo('client'), name: n }, ['code', 'name']);
    await run('UPDATE projects SET client_id=? WHERE client_id IS NULL AND TRIM(client)=?', id, n);
  }
}

export async function seedAll({ withSamples = true } = {}) {
  await tx(async () => {
    await ensureBaseData();
    // الحسابات
    await applyChart(readChartFile()); await setSetting('coa_version', 'v2');
    const ids = Object.fromEntries((await all('SELECT id, code FROM accounts')).map((a) => [a.code, a.id]));
    for (const [k, code] of Object.entries(MAPPING)) await setSetting(k, ids[code]);
    // الإعدادات
    await setSetting('company_name', 'شركة سيف لصناعة مواد البناء — مصنع GRC');
    await setSetting('currency', 'ج.م');
    await setSetting('opening_date', '2026-11-01');
    await setSetting('opening_locked', '0');
    await setSetting('allow_negative_stock', '0');
    // الفترات المالية 2026-2027
    const mon = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    for (const y of [2026, 2027]) for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const mm = String(m).padStart(2, '0');
      await insertRow('fiscal_periods', { name: `${mon[m - 1]} ${y}`, start_date: `${y}-${mm}-01`, end_date: `${y}-${mm}-${last}` }, ['name', 'start_date', 'end_date']);
    }
    // التكويد الأساسي
    await insertRow('warehouses', { code: await nextNo('warehouse'), name: 'مخزن الخامات الرئيسي', type: 'raw' }, ['code', 'name', 'type']);
    for (const [i, [name, acct]] of [['القوالب', '1223'], ['الصب', '1224'], ['التشطيب', '1225']].entries())
      await insertRow('stages', { code: await nextNo('stage'), name, seq: i + 1, account_id: ids[acct] }, ['code', 'name', 'seq', 'account_id']);
    await insertRow('treasuries', { code: await nextNo('treasury'), name: 'الخزينة الرئيسية', type: 'cash', account_id: ids['1211'] }, ['code', 'name', 'type', 'account_id']);
    await insertRow('treasuries', { code: await nextNo('treasury'), name: 'البنك', type: 'bank', account_id: ids['1212'] }, ['code', 'name', 'type', 'account_id']);
    for (const [name, cost_class, a] of [['نقل وتحميل خامات', 'indirect', '5600'], ['صيانة معدات وقطع غيار', 'indirect', '5400'], ['كهرباء ومياه وغاز', 'indirect', '5500'],
      ['مصروف مباشر على مرحلة تصنيع', 'direct', null], ['إيجارات', 'admin', '6200'], ['اتصالات وإنترنت', 'admin', '6300'],
      ['مصروفات مكتبية', 'admin', '6400'], ['مصروفات متنوعة', 'admin', '6500']])
      await insertRow('expense_categories', { code: await nextNo('expense_category'), name, cost_class, account_id: a ? ids[a] : null }, ['code', 'name', 'cost_class', 'account_id']);
    // المستخدم الأول
    await insertRow('users', { username: 'admin', name: 'مدير النظام', pass_hash: hashPassword('admin123'), role: 'admin', modules: '[]', must_change: 1 }, ['username', 'name', 'pass_hash', 'role', 'modules', 'must_change']);

    // خامات من شيت المخزون
    const mf = path.join(seedDir, 'materials.json');
    if (fs.existsSync(mf)) {
      const mats = JSON.parse(fs.readFileSync(mf, 'utf8'));
      const unitId = {}, catId = {};
      for (const m of mats) {
        if (!unitId[m.unit]) unitId[m.unit] = await insertRow('units', { code: await nextNo('unit'), name: m.unit }, ['code', 'name']);
        if (!catId[m.category]) catId[m.category] = await insertRow('material_categories', { code: await nextNo('material_category'), name: m.category }, ['code', 'name']);
        const id = await insertRow('materials', { code: await nextNo('material'), name: m.name, unit_id: unitId[m.unit], category_id: catId[m.category], notes: `شيت: ${m.sheet}` }, ['code', 'name', 'unit_id', 'category_id', 'notes']);
        await insertRow('opening_stock', { material_id: id, qty: m.qty, value: m.value, source: m.value_source, note: m.note }, ['material_id', 'qty', 'value', 'source', 'note']);
      }
    }
    const sf = path.join(seedDir, 'suggestions.json');
    if (withSamples && fs.existsSync(sf)) {
      const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
      for (const n of s.suppliers) await insertRow('suppliers', { code: await nextNo('supplier'), name: n, notes: 'مقترح من شيت المخزون — راجعه' }, ['code', 'name', 'notes']);
      for (const n of s.projects) await insertRow('projects', { code: await nextNo('project'), name: n, notes: 'مقترح من شيت المخزون — راجعه' }, ['code', 'name', 'notes']);
      for (const n of s.custodians) await insertRow('custodians', { code: await nextNo('custodian'), name: n }, ['code', 'name']);
    }
  });
}

export async function isEmpty() { return !await val('SELECT COUNT(*) FROM users'); }
