import { all, get, run, val, tx, insertRow, AppError, r2 } from '../db.js';
import { acc, getSetting, setSetting, assertOpenPeriod, audit } from './core.js';
import { postJournal, deleteJournals } from './gl.js';
import { addMove, settle } from './stock.js';

export const openingLocked = async () => await getSetting('opening_locked', '0') === '1';
export const defaultWarehouse = async () => {
  const w = await get(`SELECT id FROM warehouses WHERE type='raw' AND active=1 ORDER BY id LIMIT 1`);
  if (!w) throw new AppError('لا يوجد مخزن خامات — أضف مخزن من الإعدادات');
  return w.id;
};

/** تطبيق (أو إعادة تطبيق) الأرصدة الافتتاحية: مخزون + موردين + خزن + عهد، والفرق على حساب الأرصدة الافتتاحية */
export async function applyOpening(user) {
  return await tx(async () => {
    if (await openingLocked()) throw new AppError('الأرصدة الافتتاحية مقفلة — اطلب من المدير فك القفل');
    const date = await getSetting('opening_date');
    await assertOpenPeriod(date);
    const wh = await defaultWarehouse();
    const oldPairs = (await all(`SELECT DISTINCT warehouse_id w, material_id m FROM stock_moves WHERE doc_type='opening'`)).map((r) => [r.w, r.m]);
    await deleteJournals('opening', 0);
    await run(`DELETE FROM stock_moves WHERE doc_type='opening'`);
    const pairs = [...oldPairs]; let inv = 0;
    for (const o of await all('SELECT * FROM opening_stock WHERE qty>0 ORDER BY material_id')) {
      const value = r2(o.value);
      await addMove({ date, ord: 0, warehouse_id: wh, material_id: o.material_id, direction: 'in', qty: o.qty, value, doc_type: 'opening', doc_id: 0, line_id: o.material_id, party: 'رصيد افتتاحي', notes: o.note });
      pairs.push([wh, o.material_id]); inv += value;
    }
    await settle(pairs, { type: 'opening', id: 0 });
    const lines = []; let dr = 0, cr = 0;
    const push = (account_id, debit, credit, extra = {}) => { if (debit || credit) { lines.push({ account_id, debit, credit, description: 'رصيد افتتاحي', ...extra }); dr += debit; cr += credit; } };
    push(await acc('acc_inventory_raw'), r2(inv), 0);
    for (const s of await all('SELECT id, opening_balance b FROM suppliers WHERE opening_balance<>0')) s.b > 0 ? push(await acc('acc_ap'), 0, r2(s.b), { supplier_id: s.id }) : push(await acc('acc_ap'), r2(-s.b), 0, { supplier_id: s.id });
    for (const t of await all('SELECT id, account_id, opening_balance b FROM treasuries WHERE opening_balance<>0')) t.b > 0 ? push(t.account_id, r2(t.b), 0, { treasury_id: t.id }) : push(t.account_id, 0, r2(-t.b), { treasury_id: t.id });
    for (const c of await all('SELECT id, opening_balance b FROM custodians WHERE opening_balance<>0')) c.b > 0 ? push(await acc('acc_custody'), r2(c.b), 0, { custodian_id: c.id }) : push(await acc('acc_custody'), 0, r2(-c.b), { custodian_id: c.id });
    const plug = r2(dr - cr);
    if (lines.length) {
      if (plug > 0) push(await acc('acc_opening_equity'), 0, plug); else if (plug < 0) push(await acc('acc_opening_equity'), -plug, 0);
      await postJournal({ date, type: 'opening', source_type: 'opening', source_id: 0, description: 'الأرصدة الافتتاحية', lines, user });
    }
    await audit(user, 'apply_opening', 'opening', 0, { stock: r2(inv) });
    return { date, stock_value: r2(inv), equity: plug };
  });
}

export async function lockOpening(user) {
  if (!(await all(`SELECT 1 FROM journal_entries WHERE source_type='opening' LIMIT 1`)).length && await val('SELECT COUNT(*) FROM opening_stock WHERE qty>0') > 0)
    throw new AppError('طبّق الأرصدة الافتتاحية أولاً ثم اقفلها');
  await setSetting('opening_locked', '1'); await audit(user, 'lock_opening', 'opening', 0);
}
export async function unlockOpening(user) { await setSetting('opening_locked', '0'); await audit(user, 'unlock_opening', 'opening', 0); }
