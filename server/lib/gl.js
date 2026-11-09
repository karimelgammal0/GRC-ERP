import { all, get, run, insertRow, AppError, r2 } from '../db.js';
import { assertOpenPeriod, nextNo } from './core.js';

const DIMS = ['supplier_id', 'treasury_id', 'custodian_id', 'employee_id', 'project_id', 'item_id', 'stage_id'];

/**
 * ترحيل قيد يومية. كل سطر: {account_id, debit, credit, description, + أبعاد التحليل}
 * القيد لازم يتوازن، والفترة لازم تكون مفتوحة، والحساب لازم يكون فرعي (postable).
 */
export async function postJournal({ date, type = 'auto', source_type = null, source_id = null, description = '', lines, user, no = null }) {
  await assertOpenPeriod(date);
  const ls = lines
    .map((l) => ({ ...l, debit: r2(l.debit || 0), credit: r2(l.credit || 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (ls.length < 2) throw new AppError('القيد لازم يحتوي على سطرين على الأقل');
  for (const l of ls) {
    if (l.debit < 0 || l.credit < 0) throw new AppError('المبالغ في القيد لازم تكون موجبة');
    if (l.debit && l.credit) throw new AppError('السطر الواحد إما مدين أو دائن');
    const a = await get('SELECT id,name,postable,active FROM accounts WHERE id=?', l.account_id);
    if (!a) throw new AppError('حساب غير موجود في القيد');
    if (!a.postable) throw new AppError(`الحساب «${a.name}» حساب رئيسي لا يقبل قيود`);
  }
  let dr = r2(ls.reduce((s, l) => s + l.debit, 0));
  let cr = r2(ls.reduce((s, l) => s + l.credit, 0));
  const diff = r2(dr - cr);
  if (diff !== 0) {
    // فرق تقريب بسيط بيتم امتصاصه في آخر سطر على الجانب الأصغر، أما الأكبر فخطأ حقيقي
    if (Math.abs(diff) > 0.05) throw new AppError(`القيد غير متزن: مدين ${dr} ≠ دائن ${cr}`);
    const side = diff > 0 ? 'credit' : 'debit';
    const tgt = [...ls].reverse().find((l) => l[side] > 0);
    tgt[side] = r2(tgt[side] + Math.abs(diff));
  }
  const id = await insertRow('journal_entries', {
    no: no || await nextNo('journal'), date, type, source_type, source_id, description, created_by: user?.id ?? null,
  }, ['no', 'date', 'type', 'source_type', 'source_id', 'description', 'created_by']);
  for (const l of ls) await insertRow('journal_lines', { ...l, entry_id: id }, ['entry_id', 'account_id', 'debit', 'credit', 'description', ...DIMS]);
  return id;
}

/** مسح القيود التلقائية لمستند (قبل إعادة ترحيله أو إلغائه). بتفحص إن الفترة مفتوحة. */
export async function deleteJournals(source_type, source_id) {
  for (const e of await all('SELECT id,date FROM journal_entries WHERE source_type=? AND source_id=?', source_type, source_id)) {
    await assertOpenPeriod(e.date);
    await run('DELETE FROM journal_entries WHERE id=?', e.id);
  }
}

/** استبدال قيد مستند بقيد جديد (بيستعمل لما التكلفة تتغير بإعادة التقييم) */
export async function replaceJournal(args) {
  await deleteJournals(args.source_type, args.source_id);
  return await postJournal(args);
}

/** رصيد (مدين − دائن) لحساب مع فلاتر أبعاد */
export async function accountBalance(account_id, filt = {}, upTo = null) {
  const w = ['jl.account_id=?']; const p = [account_id];
  for (const d of DIMS) if (filt[d]) { w.push(`jl.${d}=?`); p.push(filt[d]); }
  if (upTo) { w.push('je.date<=?'); p.push(upTo); }
  const r = await get(`SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c
                 FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ${w.join(' AND ')}`, ...p);
  return r2(r.d - r.c);
}
export { DIMS };
