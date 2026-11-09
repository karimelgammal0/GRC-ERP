// دليل الحسابات: قراءة CSV + تطبيقه على قاعدة البيانات (إضافة/تعديل بالكود) + ترحيل من الدليل القديم
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, val, tx, insertRow, AppError } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHART_FILE = path.join(here, '..', '..', 'seed', 'chart-of-accounts.csv');
const TYPES = { 'أصول': 'asset', 'خصوم': 'liability', 'حقوق ملكية': 'equity', 'إيرادات': 'revenue', 'مصروفات': 'expense' };

export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
/** CSV (الكود، الاسم، النوع، يقبل حركة، الحالة) → صفوف منظمة مع تحديد الحساب الرئيسي من تدرّج الأكواد */
export function chartRows(text) {
  const rows = parseCsv(text).slice(1).map((r, i) => {
    const code = String(r[0] || '').trim(), name = String(r[1] || '').trim(), t = String(r[2] || '').trim();
    if (!code || !name) throw new AppError(`سطر ${i + 2}: الكود والاسم مطلوبين`);
    if (!/^\d+$/.test(code)) throw new AppError(`سطر ${i + 2}: الكود «${code}» لازم يكون أرقام فقط`);
    if (!TYPES[t]) throw new AppError(`سطر ${i + 2}: نوع الحساب «${t}» غير معروف (أصول/خصوم/حقوق ملكية/إيرادات/مصروفات)`);
    return { code, name, type: TYPES[t], postable: String(r[3] || '').trim() === 'نعم' ? 1 : 0, active: String(r[4] || '').trim() === 'موقوف' ? 0 : 1 };
  });
  const seen = new Set(); for (const r of rows) { if (seen.has(r.code)) throw new AppError(`الكود ${r.code} مكرر في الملف`); seen.add(r.code); }
  // الأب: أطول بادئة للكود (بعد حذف الأصفار من الآخر) تطابق حساب رئيسي
  const groups = rows.filter((r) => !r.postable).map((r) => ({ code: r.code, base: r.code.replace(/0+$/, '') }));
  for (const r of rows) {
    const base = r.code.replace(/0+$/, '');
    const cand = groups.filter((g) => g.code !== r.code && g.base.length < base.length && base.startsWith(g.base)).sort((a, b) => b.base.length - a.base.length)[0];
    r.parent = cand ? cand.code : null;
  }
  return rows;
}
export const readChartFile = () => chartRows(fs.readFileSync(CHART_FILE, 'utf8'));

/** الأكواد القديمة (النسخة الأولى) → الأكواد الجديدة، لترحيل قاعدة بيانات موجودة مع الحفاظ على القيود والربط */
export const LEGACY_RENAMES = {
  '1': '1000', '11': '1210', '12': '1220', '14': '1230', '1101': '1211', '1102': '1212', '1103': '1213', '1201': '1221', '1202': '1222',
  '1210': '1223', '1220': '1224', '1230': '1225', '1401': '1231', '2': '2000', '21': '2100', '2101': '2110', '2102': '2140', '2201': '2130', '2202': '2150',
  '3': '3000', '3101': '3100', '3102': '3400', '3103': '3300', '4': '4000', '4101': '4100', '4102': '4200', '5': '5000',
  '5101': '5200', '5102': '5300', '5103': '5100', '5104': '5700', '5105': '5800', '5106': '5400', '5107': '5500', '5108': '5600',
  '6': '6000', '6101': '6100', '6102': '6200', '6103': '6300', '6104': '6400', '6105': '6500',
};

const REFS = [['journal_lines', 'account_id'], ['stages', 'account_id'], ['treasuries', 'account_id'], ['expense_categories', 'account_id'], ['vouchers', 'account_id']];
export async function inUse(id) {
  for (const [t, c] of REFS) if (await val(`SELECT COUNT(*) FROM ${t} WHERE ${c}=?`, id) > 0) return true;
  return (await val(`SELECT COUNT(*) FROM settings WHERE key LIKE 'acc\\_%' AND value=?`, String(id))) > 0
    || (await val('SELECT COUNT(*) FROM accounts WHERE parent_id=?', id)) > 0;
}

/**
 * تطبيق الدليل: كل حساب بكوده (يتحدّث لو موجود، يتضاف لو جديد). rename: {كود قديم: كود جديد} للترحيل.
 * prune: الحسابات اللي مش في الملف: تتحذف لو مفيهاش حركة، وإلا تتوقف.
 */
export async function applyChart(rows, { rename = {}, prune = false } = {}) {
  return tx(async () => {
    const existing = await all('SELECT id, code FROM accounts');
    const byCode = new Map(existing.map((a) => [a.code, a.id]));
    const inv = Object.fromEntries(Object.entries(rename).map(([o, n]) => [n, o]));
    // كود مؤقت لكل الحسابات المتأثرة عشان ما يحصلش تعارض في الكود الفريد أثناء التبديل
    const target = new Map(); const touched = new Set();
    for (const r of rows) {
      // مع الترحيل: الكود القديم له الأولوية (لأن نفس الرقم ممكن يبقى له معنى مختلف في الدليل الجديد)
      let id = inv[r.code] && byCode.has(inv[r.code]) ? byCode.get(inv[r.code]) : byCode.get(r.code);
      if (id && !touched.has(id)) { target.set(r.code, id); touched.add(id); }
    }
    for (const id of touched) await run('UPDATE accounts SET code=? WHERE id=?', `~${id}`, id);
    let added = 0, updated = 0; const ids = {};
    for (const r of rows) {
      const id = target.get(r.code);
      if (id) { await run('UPDATE accounts SET code=?, name=?, type=?, postable=?, active=? WHERE id=?', r.code, r.name, r.type, r.postable, r.active, id); ids[r.code] = id; updated++; }
      else { ids[r.code] = await insertRow('accounts', { code: r.code, name: r.name, type: r.type, postable: r.postable, active: r.active }, ['code', 'name', 'type', 'postable', 'active']); added++; }
    }
    for (const r of rows) await run('UPDATE accounts SET parent_id=? WHERE id=?', r.parent ? ids[r.parent] : null, ids[r.code]);
    // حسابات خارج الملف
    let removed = 0, stopped = 0;
    const keep = new Set(Object.values(ids));
    const rest = (await all('SELECT id FROM accounts')).filter((a) => !keep.has(a.id));
    if (prune) for (const a of rest) {
      if (!(await inUse(a.id))) { await run('DELETE FROM accounts WHERE id=?', a.id); removed++; }
      else { await run('UPDATE accounts SET active=0 WHERE id=?', a.id); stopped++; }
    }
    // أي كود مؤقت فاضل (حساب خارج الملف اتلمس) يرجع لكوده الأصلي مستحيل — بنتأكد
    const bad = await val(`SELECT COUNT(*) FROM accounts WHERE code LIKE '~%'`);
    if (bad) throw new AppError('تعذّر تطبيق الدليل (تعارض أكواد)');
    return { added, updated, removed, stopped };
  });
}
