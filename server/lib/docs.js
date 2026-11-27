// ============================================================
//  المستندات: كل نوع له post (ترحيل) و unpost (عكس الأثر).
//  التعديل = عكس الأثر القديم ثم ترحيل الجديد في نفس الـ transaction.
//  الإلغاء = عكس الأثر + status='void'. مفيش مستند بيتمسح.
// ============================================================
import { all, get, run, val, tx, insertRow, updateRow, AppError, r2, r4, num } from '../db.js';
import { acc, nextNo, audit, needFields } from './core.js';
import { postJournal, replaceJournal, deleteJournals } from './gl.js';
import { addMove, settle, removeMoves, stockOf, stockAsOf, lastKnownCost, onRecost } from './stock.js';

export const DOCS = {};
export const REQUEST_APPROVER_JOB = 'مدير المشتريات';   // وظيفة (في موديول المشتريات) اللي بتعتمد طلب الشراء
const posQty = (l, label = 'الكمية') => { if (!(num(l.qty) > 0)) throw new AppError(`${label} لازم تكون أكبر من صفر`); };
const nm = async (t, id) => await val(`SELECT name FROM ${t} WHERE id=?`, id);
const must = async (t, id, label) => { if (!id || !await get(`SELECT 1 FROM ${t} WHERE id=?`, id)) throw new AppError(`${label} غير موجود`); };
const dc = (account_id, amount, extra = {}) => amount >= 0
  ? { account_id, debit: amount, credit: 0, ...extra } : { account_id, debit: 0, credit: -amount, ...extra };
const cr = (account_id, amount, extra = {}) => dc(account_id, -amount, extra);

export async function getDoc(type, id) {
  const D = DOCS[type];
  const h = await get(`SELECT * FROM ${D.table} WHERE id=?`, id);
  if (!h) return null;
  if (D.lines) h.lines = await all(`SELECT * FROM ${D.lines} WHERE ${D.fk}=? ORDER BY id`, id);
  h.created_by_name = h.created_by ? await val('SELECT COALESCE(e.name, u.name) FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?', h.created_by) : null;
  await D.enrich?.(h);
  return h;
}

export async function saveDoc(type, p, id, user) {
  const D = DOCS[type];
  return await tx(async () => {
    needFields(p, { date: 'التاريخ' });
    const lines = D.lines ? (Array.isArray(p.lines) ? p.lines : []).filter((l) => !(D.blank ? D.blank(l) : false)) : [];
    p.lines = lines;
    if (D.lines && D.requireLines !== false && !lines.length) throw new AppError('أضف بند واحد على الأقل');
    let docId = id;
    if (id) {
      const cur = await get(`SELECT * FROM ${D.table} WHERE id=?`, id);
      if (!cur) throw new AppError('المستند غير موجود', 404);
      if (cur.status === 'void') throw new AppError('المستند ملغي ولا يمكن تعديله');
      if (D.locked?.(cur)) throw new AppError('الإذن معتمد ومقفول — أضف البنود في إذن جديد، أو اطلب إعادة فتحه بصلاحية');
      await D.unpost?.(cur);
      if (D.lines) await run(`DELETE FROM ${D.lines} WHERE ${D.fk}=?`, id);
      await D.validate?.(p, lines, id);
      await updateRow(D.table, id, p, D.cols);
    } else {
      await D.validate?.(p, lines, null);
      const no = await nextNo(typeof D.seq === 'function' ? D.seq(p) : D.seq);
      docId = await insertRow(D.table, { ...p, no, created_by: user?.id ?? null }, [...D.cols, 'no', 'created_by']);
    }
    for (const l of lines) l.id = await insertRow(D.lines, { ...l, [D.fk]: docId }, [...D.lineCols, D.fk]);
    if (id && D.relock) await D.relock(id);
    const doc = await getDoc(type, docId);
    await D.post?.(doc, user, p);
    await audit(user, id ? 'edit' : 'create', type, docId, { no: doc.no });
    return await getDoc(type, docId);
  });
}

export async function voidDoc(type, id, user) {
  const D = DOCS[type];
  return await tx(async () => {
    const cur = await get(`SELECT * FROM ${D.table} WHERE id=?`, id);
    if (!cur) throw new AppError('المستند غير موجود', 404);
    if (cur.status === 'void') throw new AppError('المستند ملغي بالفعل');
    await D.unpost?.(cur);
    await run(`UPDATE ${D.table} SET status='void' WHERE id=?`, id);
    await audit(user, 'void', type, id, { no: cur.no });
    return await getDoc(type, id);
  });
}

/** استرجاع مستند ملغي: بيرجع status='posted' ويعيد الترحيل (مخزون + قيود) من نفس البنود؛ لو الرصيد/الشروط مش مسمحة بيرفض */
export async function restoreDoc(type, id, user) {
  const D = DOCS[type];
  return await tx(async () => {
    const cur = await get(`SELECT * FROM ${D.table} WHERE id=?`, id);
    if (!cur) throw new AppError('المستند غير موجود', 404);
    if (cur.status !== 'void') throw new AppError('المستند غير ملغي');
    if (!D.post) throw new AppError('الاسترجاع غير مدعوم لهذا المستند');
    await run(`UPDATE ${D.table} SET status='posted' WHERE id=?`, id);
    await D.validate?.({ ...cur, lines: await all(`SELECT * FROM ${D.lines} WHERE ${D.fk}=?`, id) }, await all(`SELECT * FROM ${D.lines} WHERE ${D.fk}=?`, id), id);
    const doc = await getDoc(type, id);
    await D.post(doc, user, cur);
    await audit(user, 'restore', type, id, { no: cur.no });
    return await getDoc(type, id);
  });
}

// ============================================================
//  طلبات الشراء
// ============================================================
DOCS.purchase_request = {
  table: 'purchase_requests', lines: 'purchase_request_lines', fk: 'request_id', seq: 'purchase_request',
  cols: ['date', 'requested_by_id', 'supplier_id', 'project_id', 'needed_date', 'notes'], lineCols: ['material_id', 'qty', 'notes'],
  blank: (l) => !l.material_id,
  async validate(p, lines) { if (p.supplier_id) await must('suppliers', p.supplier_id, 'المورد'); else p.supplier_id = null; for (const l of lines) { await must('materials', l.material_id, 'الصنف'); posQty(l); } },
  async unpost(cur) {
    if (await val('SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=? AND ordered_qty>0', cur.id))
      throw new AppError('تم إصدار أمر توريد على هذا الطلب — ألغِ أمر التوريد أولاً');
    await run('UPDATE purchase_requests SET approved_by=NULL, approved_by_name=NULL, approved_at=NULL WHERE id=?', cur.id);   // أي تعديل/إلغاء بيسحب الاعتماد
  },
};
async function refreshRequestStatus(request_id) {
  if (!request_id) return;
  const r = await get('SELECT status FROM purchase_requests WHERE id=?', request_id);
  if (!r || r.status === 'void' || r.status === 'closed') return;
  const open = await val('SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=? AND ordered_qty < qty - 0.000001', request_id);
  await run('UPDATE purchase_requests SET status=? WHERE id=?', open ? 'open' : 'ordered', request_id);
}

// ============================================================
//  أوامر التوريد
// ============================================================
DOCS.purchase_order = {
  table: 'purchase_orders', lines: 'purchase_order_lines', fk: 'order_id', seq: 'purchase_order',
  cols: ['date', 'supplier_id', 'request_id', 'expected_date', 'payment_type', 'notes'],
  lineCols: ['material_id', 'qty', 'unit_price', 'request_line_id', 'notes'],
  blank: (l) => !l.material_id,
  enrich(h) { h.total = r2(h.lines.reduce((s, l) => s + l.qty * l.unit_price, 0)); },
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد');
    if (p.request_id && !await val('SELECT approved_at FROM purchase_requests WHERE id=?', p.request_id)) throw new AppError('طلب الشراء لم يُعتمد بعد من مدير المشتريات');
    for (const l of lines) {
      await must('materials', l.material_id, 'الصنف'); posQty(l);
      if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً');
      if (l.request_line_id) {
        const rl = await get('SELECT * FROM purchase_request_lines WHERE id=?', l.request_line_id);
        if (!rl || rl.request_id !== Number(p.request_id)) throw new AppError('بند طلب الشراء لا يخص الطلب المختار');
        if (rl.material_id !== Number(l.material_id)) throw new AppError('الصنف لا تطابق بند طلب الشراء');
        if (num(l.qty) > rl.qty - rl.ordered_qty + 1e-6)
          throw new AppError(`الكمية أكبر من المتبقي في طلب الشراء (${r4(rl.qty - rl.ordered_qty)})`);
      }
    }
  },
  async post(doc) {
    for (const l of doc.lines) if (l.request_line_id) await run('UPDATE purchase_request_lines SET ordered_qty=ordered_qty+? WHERE id=?', l.qty, l.request_line_id);
    await refreshRequestStatus(doc.request_id);
  },
  async unpost(cur) {
    if (await val('SELECT COUNT(*) FROM purchase_order_lines WHERE order_id=? AND received_qty>0', cur.id))
      throw new AppError('تم الاستلام على هذا الأمر — ألغِ إذن الاستلام أولاً');
    for (const l of await all('SELECT * FROM purchase_order_lines WHERE order_id=?', cur.id))
      if (l.request_line_id) await run('UPDATE purchase_request_lines SET ordered_qty=MAX(0,ordered_qty-?) WHERE id=?', l.qty, l.request_line_id);
    await refreshRequestStatus(cur.request_id);
  },
};
export async function refreshOrderStatus(order_id) {
  if (!order_id) return;
  const o = await get('SELECT status FROM purchase_orders WHERE id=?', order_id);
  if (!o || o.status === 'void' || o.status === 'closed') return;
  const t = await get('SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN received_qty>=qty-0.000001 THEN 1 ELSE 0 END),0) n_full, COALESCE(SUM(CASE WHEN received_qty>0 THEN 1 ELSE 0 END),0) n_some FROM purchase_order_lines WHERE order_id=?', order_id);
  await run('UPDATE purchase_orders SET status=? WHERE id=?', t.n_full === t.n ? 'received' : t.n_some ? 'partial' : 'open', order_id);
}

// ============================================================
//  إذن الاستلام  (مخزون + دائن مباشر على المورد/الخزينة)
// ============================================================
DOCS.goods_receipt = {
  table: 'goods_receipts', lines: 'goods_receipt_lines', fk: 'receipt_id', seq: 'goods_receipt',
  cols: ['date', 'supplier_id', 'warehouse_id', 'order_id', 'supplier_ref', 'payment_type', 'treasury_id', 'custodian_id', 'notes'],
  lineCols: ['material_id', 'qty', 'unit_price', 'order_line_id', 'notes'],
  blank: (l) => !l.material_id,
  enrich(h) { h.total = r2(h.lines.reduce((s, l) => s + l.qty * l.unit_price, 0)); },
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد'); await must('warehouses', p.warehouse_id, 'المخزن');
    // طريقة الشراء: آجل ← دائن على المورد، نقدي ← دائن على الخزينة/العهدة (من غير حساب وسيط)
    p.payment_type = p.payment_type || 'credit';
    if (!['credit', 'cash'].includes(p.payment_type)) throw new AppError('نوع الشراء آجل أو نقدي');
    if (p.payment_type === 'cash') { p.treasury_id = p.treasury_id || null; p.custodian_id = p.custodian_id || null; await sourceCheck(p); } else { p.treasury_id = null; p.custodian_id = null; }
    if (p.order_id) {
      const o = await get('SELECT * FROM purchase_orders WHERE id=?', p.order_id);
      if (!o || o.status === 'void' || o.status === 'closed') throw new AppError('أمر التوريد غير متاح للاستلام');
      if (o.supplier_id !== Number(p.supplier_id)) throw new AppError('أمر التوريد لمورد مختلف');
    }
    for (const l of lines) {
      await must('materials', l.material_id, 'الصنف'); posQty(l);
      if (l.order_line_id) {
        const ol = await get('SELECT * FROM purchase_order_lines WHERE id=?', l.order_line_id);
        if (!ol || ol.order_id !== Number(p.order_id)) throw new AppError('بند أمر التوريد لا يخص الأمر المختار');
        if (ol.material_id !== Number(l.material_id)) throw new AppError('الصنف لا تطابق بند أمر التوريد');
        if (num(l.qty) > ol.qty - ol.received_qty + 1e-6) throw new AppError(`كمية الاستلام أكبر من المتبقي في أمر التوريد (${r4(ol.qty - ol.received_qty)})`);
        if (l.unit_price === undefined || l.unit_price === null || l.unit_price === '') l.unit_price = ol.unit_price;
      }
      if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً');
    }
  },
  async post(doc) {
    const supplier = await nm('suppliers', doc.supplier_id); const pairs = []; let total = 0;
    for (const l of doc.lines) {
      const value = r2(l.qty * l.unit_price); total += value;
      await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: l.qty, value,
        doc_type: 'receipt', doc_id: doc.id, line_id: l.id, party: supplier, notes: doc.supplier_ref || doc.notes });
      pairs.push([doc.warehouse_id, l.material_id]);
      if (l.order_line_id) await run('UPDATE purchase_order_lines SET received_qty=received_qty+? WHERE id=?', l.qty, l.order_line_id);
    }
    await settle(pairs, { type: 'receipt', id: doc.id });
    await refreshOrderStatus(doc.order_id);
    total = r2(total);
    const lines = [dc(await acc('acc_inventory_raw'), total), cr(await acc('acc_ap'), total, { supplier_id: doc.supplier_id })];
    if (doc.payment_type === 'cash') { const c = await cashSide(doc); lines.push(dc(await acc('acc_ap'), total, { supplier_id: doc.supplier_id }), cr(c.account_id, total, c)); }
    await postJournal({ date: doc.date, source_type: 'receipt', source_id: doc.id, description: `إذن استلام ${doc.no} — ${supplier}`, lines });
  },
  async unpost(cur) {
    if (await val('SELECT COUNT(*) FROM goods_receipt_lines WHERE receipt_id=? AND invoiced_qty>0', cur.id))
      throw new AppError('إذن الاستلام مرتبط بفاتورة شراء — ألغِ الفاتورة أولاً');
    for (const l of await all('SELECT * FROM goods_receipt_lines WHERE receipt_id=?', cur.id))
      if (l.order_line_id) await run('UPDATE purchase_order_lines SET received_qty=MAX(0,received_qty-?) WHERE id=?', l.qty, l.order_line_id);
    await deleteJournals('receipt', cur.id); await deleteJournals('receipt_ap', cur.id);
    await removeMoves('receipt', cur.id);
    await refreshOrderStatus(cur.order_id);
  },
};

// ============================================================
//  فاتورة الشراء المباشرة (آجل / نقدي) — بدون دورة طلب/أمر/استلام
// ============================================================
export async function invoiceOpenAmount(inv) {
  if (inv.payment_type === 'cash' || inv.status === 'void') return 0;
  const paid = await val('SELECT COALESCE(SUM(amount),0) FROM voucher_allocations WHERE invoice_id=?', inv.id);
  return r2(inv.total - paid);
}
DOCS.purchase_invoice = {
  table: 'purchase_invoices', lines: 'purchase_invoice_lines', fk: 'invoice_id', seq: 'purchase_invoice',
  cols: ['date', 'supplier_id', 'warehouse_id', 'supplier_inv_no', 'due_date', 'payment_type', 'treasury_id', 'custodian_id', 'discount', 'freight', 'vat_percent', 'notes'],
  lineCols: ['material_id', 'qty', 'unit_price', 'grn_line_id', 'notes'],
  blank: (l) => !l.material_id,
  async enrich(h) { h.open_amount = await invoiceOpenAmount(h); },
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد'); await must('warehouses', p.warehouse_id, 'المخزن');
    if (!['credit', 'cash'].includes(p.payment_type)) throw new AppError('نوع الشراء آجل أو نقدي');
    if (p.payment_type === 'cash') {
      if (!!p.treasury_id === !!p.custodian_id) throw new AppError('الشراء النقدي لازم يتحدد له مصدر دفع واحد: خزينة أو عهدة');
      if (p.treasury_id) await must('treasuries', p.treasury_id, 'الخزينة'); else await must('custodians', p.custodian_id, 'صاحب العهدة');
    } else { p.treasury_id = null; p.custodian_id = null; }
    for (const k of ['discount', 'freight', 'vat_percent']) { p[k] = num(p[k]); if (p[k] < 0) throw new AppError('القيم لا يمكن أن تكون سالبة'); }
    let sub = 0;
    for (const l of lines) {
      await must('materials', l.material_id, 'الصنف'); posQty(l);
      if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً');
      sub += r2(l.qty * l.unit_price);
      if (l.grn_line_id) throw new AppError('الفاتورة دي كانت مطابقة لإذن استلام (منطق قديم اتلغى) — ألغِها وسجّل فاتورة مباشرة بدلها');
    }
    if (p.discount > sub + 0.001) throw new AppError('الخصم أكبر من إجمالي الفاتورة');
  },
  async post(doc) {
    const L = doc.lines;
    const amounts = L.map((l) => r2(l.qty * l.unit_price));
    const sub = r2(amounts.reduce((a, b) => a + b, 0));
    const disc = r2(doc.discount), fr = r2(doc.freight);
    const eff = L.map((l, i) => r2(amounts[i] - disc * (sub > 0 ? amounts[i] / sub : 1 / L.length) + fr * (sub > 0 ? amounts[i] / sub : 1 / L.length)));
    const drift = r2(sub - disc + fr - eff.reduce((a, b) => a + b, 0)); eff[eff.length - 1] = r2(eff[eff.length - 1] + drift);
    const vat = r2((sub - disc) * doc.vat_percent / 100);
    const total = r2(sub - disc + fr + vat);
    const due = doc.due_date || doc.date;
    await run('UPDATE purchase_invoices SET subtotal=?, vat_amount=?, total=?, due_date=? WHERE id=?', sub, vat, total, due, doc.id);

    const supplier = await nm('suppliers', doc.supplier_id);
    let inv = 0; const pairs = [];
    for (const [i, l] of L.entries()) {
      await run('UPDATE purchase_invoice_lines SET net_cost=? WHERE id=?', eff[i], l.id);
      await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: l.qty, value: eff[i],
        doc_type: 'invoice', doc_id: doc.id, line_id: l.id, party: supplier, notes: doc.supplier_inv_no });
      pairs.push([doc.warehouse_id, l.material_id]); inv += eff[i];
    }
    await settle(pairs, { type: 'invoice', id: doc.id });
    const payer = doc.payment_type === 'cash'
      ? (doc.treasury_id ? { account_id: await val('SELECT account_id FROM treasuries WHERE id=?', doc.treasury_id), treasury_id: doc.treasury_id }
        : { account_id: await acc('acc_custody'), custodian_id: doc.custodian_id }) : null;
    // المخزون بالتكلفة بدون الضريبة (الخصم بينقّص والنقل بيزوّد)، والضريبة في حسابها، والإجمالي على المورد (أو الخزينة لو نقدي)
    const sup = { supplier_id: doc.supplier_id };
    const lines = [dc(await acc('acc_inventory_raw'), r2(inv)), vat ? dc(await acc('acc_vat_in'), vat) : null, cr(await acc('acc_ap'), total, sup)].filter(Boolean).filter((l) => l.debit || l.credit);
    if (payer) { lines.push(dc(await acc('acc_ap'), total, sup)); lines.push(cr(payer.account_id, total, payer)); }
    await postJournal({ date: doc.date, source_type: 'invoice', source_id: doc.id, description: `فاتورة شراء ${doc.no} — ${supplier}`, lines });
  },
  async unpost(cur) {
    const a = await get(`SELECT v.no FROM voucher_allocations va JOIN vouchers v ON v.id=va.voucher_id WHERE va.invoice_id=? LIMIT 1`, cur.id);
    if (a) throw new AppError(`الفاتورة عليها سداد (سند ${a.no}) — ألغِ السند أولاً`);
    if (await val(`SELECT COUNT(*) FROM purchase_returns WHERE invoice_id=? AND status='posted'`, cur.id))
      throw new AppError('الفاتورة عليها مرتجع مشتريات — ألغِ المرتجع أولاً');
    for (const l of await all('SELECT * FROM purchase_invoice_lines WHERE invoice_id=?', cur.id))
      if (l.grn_line_id) await run('UPDATE goods_receipt_lines SET invoiced_qty=MAX(0,invoiced_qty-?) WHERE id=?', l.qty, l.grn_line_id);
    await deleteJournals('invoice', cur.id);
    await removeMoves('invoice', cur.id);
  },
};

// ============================================================
//  مرتجع مشتريات
// ============================================================
// قيد المرتجع: الموردين مدين بسعر المورد، والمخزن دائن بتكلفة المتوسط، والفرق (لو في) بيروح للتكلفة غير المباشرة زي فروق الجرد
async function buildPurchaseReturn(id) {
  const h = await get('SELECT * FROM purchase_returns WHERE id=?', id);
  if (!h || h.status === 'void') return;
  const supplier = await nm('suppliers', h.supplier_id);
  let price = 0, cost = 0;
  await run(`DELETE FROM cost_lines WHERE source_type='preturn' AND source_id=?`, id);
  for (const l of await all('SELECT * FROM purchase_return_lines WHERE return_id=?', id)) {
    const mv = await get(`SELECT value FROM stock_moves WHERE doc_type='preturn' AND doc_id=? AND line_id=?`, id, l.id);
    const lp = r2(l.qty * l.unit_price), lc = r2(mv.value); price += lp; cost += lc;
    if (Math.abs(lp - lc) > 0.004)
      await insertRow('cost_lines', { date: h.date, source_type: 'preturn', source_id: id, source_line_id: l.id, cost_type: 'material', cost_class: 'indirect',
        material_id: l.material_id, qty: 0, amount: r2(lc - lp), description: `فرق سعر مرتجع مشتريات ${h.no}` },
      ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'material_id', 'qty', 'amount', 'description']);
  }
  price = r2(price); cost = r2(cost); const diff = r2(price - cost);
  await run('UPDATE purchase_returns SET total=? WHERE id=?', price, id);
  const lines = [dc(await acc('acc_ap'), price, { supplier_id: h.supplier_id }), cr(await acc('acc_inventory_raw'), cost)];
  if (diff > 0) lines.push(cr(await acc('acc_overhead_materials'), diff)); else if (diff < 0) lines.push(dc(await acc('acc_overhead_materials'), -diff));
  await replaceJournal({ date: h.date, source_type: 'preturn', source_id: id, description: `مرتجع مشتريات ${h.no} — ${supplier}`, lines });
}
onRecost.preturn = buildPurchaseReturn;

DOCS.purchase_return = {
  table: 'purchase_returns', lines: 'purchase_return_lines', fk: 'return_id', seq: 'purchase_return',
  cols: ['date', 'supplier_id', 'warehouse_id', 'invoice_id', 'notes'], lineCols: ['material_id', 'qty', 'unit_price', 'notes'],
  blank: (l) => !l.material_id,
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد'); await must('warehouses', p.warehouse_id, 'المخزن');
    for (const l of lines) { await must('materials', l.material_id, 'الصنف'); posQty(l); if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً'); }
  },
  async post(doc) {
    const supplier = await nm('suppliers', doc.supplier_id); const pairs = [];
    for (const l of doc.lines) {
      // المرتجع بيخرج من المخزن بالمتوسط المرجح (مش بسعر المورد) عشان متوسط الصنف ما يتخرّبش
      await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'out', qty: l.qty,
        doc_type: 'preturn', doc_id: doc.id, line_id: l.id, party: supplier, notes: 'مرتجع مشتريات' });
      pairs.push([doc.warehouse_id, l.material_id]);
    }
    await settle(pairs, { type: 'preturn', id: doc.id });
    await buildPurchaseReturn(doc.id);
  },
  async unpost(cur) { await deleteJournals('preturn', cur.id); await run(`DELETE FROM cost_lines WHERE source_type='preturn' AND source_id=?`, cur.id); await removeMoves('preturn', cur.id); },
};

// ============================================================
//  إذن صرف أصناف (إنتاج / تحويل لموقع / تشغيل غير مباشر) ومرتجع صرف
//  الأبعاد الأساسية للتكلفة: مشروع + بند + مرحلة
// ============================================================
async function issueAccount(kind, stage_id) {
  if (kind === 'production') {
    const a = await val('SELECT account_id FROM stages WHERE id=?', stage_id);
    if (!a) throw new AppError(`المرحلة «${await nm('stages', stage_id)}» غير مربوطة بحساب إنتاج تحت التشغيل — اربطها من الإعدادات ← المراحل`);
    return a;
  }
  if (kind === 'overhead') return await acc('acc_stock_materials');   // مواد غير مباشرة: (مواد مخزنية ← المخزون) وقت الصرف، وبتتحمّل على إنتاج تحت التشغيل شهرياً من «توزيع غير المباشر»
  return kind === 'site' ? await acc('acc_site_transfer') : await acc('acc_overhead_materials');
}
/** صرف إنتاج / تشغيل غير مباشر على مرحلة بيمر على «مواد مخزنية»: (إنتاج تحت التشغيل ← مواد مخزنية) + (مواد مخزنية ← المخزون) */
const viaStockMaterials = async (kind) => kind === 'production';
const effectiveKind = async (h) => (h.kind === 'return' ? await val('SELECT kind FROM stock_issues WHERE id=?', h.ref_issue_id) : h.kind === 'site_in' ? 'site' : h.kind);

async function buildIssue(id) {
  const h = await get('SELECT * FROM stock_issues WHERE id=?', id);
  if (!h || h.status === 'void') return;
  const sign = h.kind === 'return' || h.kind === 'site_in' ? -1 : 1; const kind = await effectiveKind(h);
  const lines = await all('SELECT * FROM stock_issue_lines WHERE issue_id=? ORDER BY id', id);
  let total = 0; const byItem = new Map();
  await run(`DELETE FROM cost_lines WHERE source_type='issue' AND source_id=?`, id);
  for (const l of lines) {
    const mv = await get(`SELECT value, unit_cost FROM stock_moves WHERE doc_type='issue' AND doc_id=? AND line_id=?`, id, l.id);
    const value = mv.value;
    await run('UPDATE stock_issue_lines SET unit_cost=?, total=? WHERE id=?', mv.unit_cost, value, l.id);
    total += value; { const it = l.item_id ?? h.item_id ?? null, sg = l.stage_id ?? h.stage_id ?? null, key = `${it}|${sg}`; byItem.set(key, { it, sg, amt: r2((byItem.get(key)?.amt || 0) + value) }); }
    await insertRow('cost_lines', {
      date: h.date, source_type: 'issue', source_id: id, source_line_id: l.id, cost_type: 'material',
      cost_class: kind === 'overhead' ? 'indirect' : kind === 'site' ? 'transfer' : 'direct', project_id: h.project_id, item_id: l.item_id ?? h.item_id, stage_id: l.stage_id ?? h.stage_id, site_id: h.site_id,
      material_id: l.material_id, qty: sign * l.qty, amount: sign * value, description: h.no,
    }, ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'site_id', 'material_id', 'qty', 'amount', 'description']);
  }
  total = r2(total);
  const inv = await acc('acc_inventory_raw'); const stockMat = await acc('acc_stock_materials');
  const label = { production: 'إنتاج', site: 'تحويل لموقع', overhead: 'تشغيل غير مباشر' }[kind];
  const zeroXfer = (kind === 'site') && total === 0 && !!Number(await val('SELECT zero_cost_transfer FROM warehouses WHERE id=?', h.warehouse_id));
  await replaceJournal({
    allowZero: zeroXfer,
    date: h.date, source_type: 'issue', source_id: id, description: `${h.kind === 'return' ? 'مرتجع صرف' : h.kind === 'site_in' ? 'تحويل وارد' : 'صرف'} ${h.no} — ${label}${zeroXfer ? ' (تحويل بدون تكلفة)' : ''}`,
    lines: (await Promise.all([...byItem.values()].map(async ({ it: item_id, sg, amt }) => { const costAcc = await issueAccount(kind, sg); return { item_id, sg, amt, costAcc, via: await viaStockMaterials(kind) }; }))).flatMap(({ item_id, sg, amt, costAcc, via }) => {
      const dims = { project_id: h.project_id, item_id, stage_id: sg };
      if (via) { const sm = stockMat; return sign === 1 ? [dc(costAcc, amt, dims), cr(sm, amt, dims), dc(sm, amt, dims), cr(inv, amt)] : [dc(sm, amt, dims), cr(costAcc, amt, dims), dc(inv, amt), cr(sm, amt, dims)]; }
      return sign === 1 ? [dc(costAcc, amt, dims), cr(inv, amt)] : [dc(inv, amt), cr(costAcc, amt, dims)];
    }),
  });
}
onRecost.issue = buildIssue;

DOCS.stock_issue = {
  table: 'stock_issues', lines: 'stock_issue_lines', fk: 'issue_id',
  seq: (p) => (p.kind === 'return' ? 'stock_return' : p.kind === 'site_in' ? 'stock_site_in' : 'stock_issue'),
  locked: (cur) => cur.status === 'posted' && cur.kind !== 'return' && !cur.reopened,
  relock: async (id) => { await run('UPDATE stock_issues SET reopened=0 WHERE id=?', id); },
  cols: ['date', 'kind', 'warehouse_id', 'project_id', 'item_id', 'stage_id', 'site_id', 'ref_issue_id', 'received_by_id', 'notes'],
  lineCols: ['material_id', 'item_id', 'stage_id', 'received_by_id', 'qty', 'in_cost', 'ref_line_id', 'notes'],
  blank: (l) => !l.material_id && !l.ref_line_id,
  async validate(p, lines) {
    if (!['production', 'site', 'site_in', 'overhead', 'return'].includes(p.kind)) throw new AppError('نوع الصرف غير معروف');
    if (p.kind !== 'return') await must('warehouses', p.warehouse_id, 'المخزن');
    if (p.kind === 'return') {
      const ref = await get('SELECT * FROM stock_issues WHERE id=?', p.ref_issue_id);
      if (!ref || ref.kind === 'return' || ref.status === 'void') throw new AppError('اختر إذن الصرف الأصلي للمرتجع');
      Object.assign(p, { project_id: ref.project_id, item_id: ref.item_id, stage_id: ref.stage_id, site_id: ref.site_id, warehouse_id: ref.warehouse_id });
      for (const l of lines) {
        posQty(l);
        const rl = await get('SELECT * FROM stock_issue_lines WHERE id=?', l.ref_line_id);
        if (!rl || rl.issue_id !== ref.id) throw new AppError('بند المرتجع لا يخص إذن الصرف المختار');
        l.material_id = rl.material_id; l.item_id = rl.item_id ?? ref.item_id ?? null; l.stage_id = rl.stage_id ?? ref.stage_id ?? null;
        const returned = await val(`SELECT COALESCE(SUM(l.qty),0) FROM stock_issue_lines l JOIN stock_issues i ON i.id=l.issue_id WHERE l.ref_line_id=? AND i.status='posted'`, rl.id);
        if (num(l.qty) > rl.qty - returned + 1e-6) throw new AppError(`كمية المرتجع أكبر من المتاح إرجاعه لبند «${await nm('materials', rl.material_id)}» (${r4(rl.qty - returned)})`);
      }
      return;
    }
    if (p.kind === 'production') {
      if (!p.project_id) throw new AppError('صرف الإنتاج لازم يتحدد له المشروع');
      for (const l of lines) { if (!l.item_id) throw new AppError(`حدد البند للصنف «${await nm('materials', l.material_id)}»`); if (!l.stage_id) throw new AppError(`حدد المرحلة للصنف «${await nm('materials', l.material_id)}»`); }
      // الموقع اختياري هنا، ومسموح بس لو المشروع متكود له مواقع نشطة وتابع له
      if (p.site_id) {
        const ok = await get('SELECT 1 x FROM sites WHERE id=? AND project_id=? AND active=1', p.site_id, p.project_id);
        if (!ok) throw new AppError('الموقع المختار لا يتبع المشروع');
      } else p.site_id = null;
    }
    if (p.kind === 'site' || p.kind === 'site_in') {
      if (!p.project_id) throw new AppError(p.kind === 'site_in' ? 'التحويل الوارد لازم يتحدد له المشروع المحوَّل منه' : 'التحويل لموقع لازم يتحدد له المشروع');
      // الموقع مطلوب بس لو المشروع متكود له مواقع (نشطة)؛ ولو مفيش مواقع بيتساب فاضي
      const siteIds = (await all('SELECT id FROM sites WHERE project_id=? AND active=1', p.project_id)).map((x) => Number(x.id));
      if (siteIds.length) {
        if (!p.site_id) throw new AppError('اختر الموقع — المشروع ده متكود له مواقع');
        if (!siteIds.includes(Number(p.site_id))) throw new AppError('الموقع المختار لا يتبع المشروع');
      } else p.site_id = null;
      for (const l of lines) l.stage_id = null;
    }
    if (p.kind === 'overhead') { p.project_id = null; p.site_id = null; for (const l of lines) l.item_id = null; }
    if (p.kind !== 'return') { p.item_id = null; p.stage_id = null; if (p.kind === 'site' || p.kind === 'site_in') for (const l of lines) l.item_id = null; }
    for (const l of lines) { if (p.kind === 'site_in') { if (l.in_cost === '' || l.in_cost === undefined || l.in_cost === null) l.in_cost = null; else if (!(Number(l.in_cost) >= 0)) throw new AppError('تكلفة الوحدة غير صحيحة'); } else l.in_cost = null; }
    if (p.project_id) await must('projects', p.project_id, 'المشروع');
    for (const l of lines) if (l.item_id) {
      const it = await get('SELECT project_id FROM project_items WHERE id=?', l.item_id);
      if (!it) throw new AppError('البند غير موجود');
      if (it.project_id !== Number(p.project_id)) throw new AppError('البند لا يتبع المشروع المختار');
    }
    for (const l of lines) if (l.stage_id) await must('stages', l.stage_id, 'المرحلة');
    if (p.site_id) await must('sites', p.site_id, 'الموقع');
    const seen = new Set();
    for (const l of lines) {
      await must('materials', l.material_id, 'الصنف'); posQty(l);
      const key = `${l.material_id}:${l.item_id || 0}:${l.stage_id || 0}`;
      if (seen.has(key)) throw new AppError(`الصنف «${await nm('materials', l.material_id)}» مكرر${l.item_id ? ' على نفس البند والمرحلة' : ''} في الإذن`);
      seen.add(key);
    }
  },
  async post(doc) {
    const pairs = [];
    const party = doc.project_id ? await nm('projects', doc.project_id) : 'المصنع — تشغيل';
    for (const l of doc.lines) {
      if (doc.kind === 'return') {
        const rl = await get('SELECT unit_cost FROM stock_issue_lines WHERE id=?', l.ref_line_id);
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: l.qty, value: r2(l.qty * rl.unit_cost),
          doc_type: 'issue', doc_id: doc.id, line_id: l.id, party: `مرتجع ${party}`, notes: doc.notes });
      } else if (doc.kind === 'site_in') {
        // تحويل وارد: بالتكلفة المدخلة يدوياً، وإلا بمتوسط تكلفة الصنف الحالي في المخزن (أو في كل المخازن لو الصنف جديد على المخزن ده)
        let uc = l.in_cost === null || l.in_cost === undefined ? null : Number(l.in_cost);
        if (uc === null) {
          uc = Number(await val('SELECT avg_cost FROM material_stock WHERE warehouse_id=? AND material_id=? AND qty>0', doc.warehouse_id, l.material_id))
            || Number(await val('SELECT CASE WHEN SUM(qty)>0 THEN SUM(value)/SUM(qty) ELSE 0 END FROM material_stock WHERE material_id=?', l.material_id)) || 0;
          if (!(uc > 0) && !Number(await val('SELECT zero_cost_transfer FROM warehouses WHERE id=?', doc.warehouse_id))) throw new AppError(`حدد تكلفة الوحدة للصنف «${await nm('materials', l.material_id)}» — مفيش متوسط تكلفة ليه في المخزن`);
        }
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: l.qty, value: r2(l.qty * uc),
          doc_type: 'issue', doc_id: doc.id, line_id: l.id, party: `تحويل وارد من ${party}`, notes: doc.notes });
      } else {
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'out', qty: l.qty,
          doc_type: 'issue', doc_id: doc.id, line_id: l.id, party, notes: doc.notes });
      }
      pairs.push([doc.warehouse_id, l.material_id]);
    }
    await settle(pairs, { type: 'issue', id: doc.id });
    await buildIssue(doc.id);
  },
  async unpost(cur) {
    if (cur.kind !== 'return' && await val(`SELECT COUNT(*) FROM stock_issues WHERE ref_issue_id=? AND status='posted'`, cur.id))
      throw new AppError('عليه مرتجع صرف — ألغِ المرتجع أولاً');
    await deleteJournals('issue', cur.id);
    await run(`DELETE FROM cost_lines WHERE source_type='issue' AND source_id=?`, cur.id);
    await removeMoves('issue', cur.id);
  },
};

// ============================================================
//  جرد وتسوية
// ============================================================
async function buildAdjustment(id) {
  const h = await get('SELECT * FROM stock_adjustments WHERE id=?', id);
  if (!h || h.status === 'void') return;
  let surplus = 0, deficit = 0;
  for (const l of await all('SELECT * FROM stock_adjustment_lines WHERE adjustment_id=?', id)) {
    if (l.diff_qty === 0) continue;
    const mv = await get(`SELECT value, unit_cost FROM stock_moves WHERE doc_type='adjustment' AND doc_id=? AND line_id=?`, id, l.id);
    const signed = l.diff_qty > 0 ? mv.value : -mv.value;
    await run('UPDATE stock_adjustment_lines SET unit_cost=?, value=? WHERE id=?', mv.unit_cost, signed, l.id);
    if (signed > 0) surplus += signed; else deficit += -signed;
  }
  surplus = r2(surplus); deficit = r2(deficit);
  // التسوية بتروح للتكلفة (مواد غير مباشرة) والمخزن مباشرة: عجز = تكلفة، زيادة = تخفيض تكلفة
  const costAcc = await acc('acc_overhead_materials');
  const lines = [];
  if (surplus) lines.push(dc(await acc('acc_inventory_raw'), surplus), cr(costAcc, surplus));
  if (deficit) lines.push(dc(costAcc, deficit), cr(await acc('acc_inventory_raw'), deficit));
  await run(`DELETE FROM cost_lines WHERE source_type='adjustment' AND source_id=?`, id);
  for (const l of await all('SELECT * FROM stock_adjustment_lines WHERE adjustment_id=?', id)) {
    if (!l.diff_qty) continue;
    await insertRow('cost_lines', { date: h.date, source_type: 'adjustment', source_id: id, source_line_id: l.id, cost_type: 'material', cost_class: 'indirect',
      material_id: l.material_id, qty: -l.diff_qty, amount: -l.value, description: `جرد وتسوية ${h.no}` },
    ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'material_id', 'qty', 'amount', 'description']);
  }
  if (lines.length) await replaceJournal({ date: h.date, source_type: 'adjustment', source_id: id, description: `جرد وتسوية ${h.no}`, lines });
  else await deleteJournals('adjustment', id);
}
onRecost.adjustment = buildAdjustment;
DOCS.stock_adjustment = {
  table: 'stock_adjustments', lines: 'stock_adjustment_lines', fk: 'adjustment_id', seq: 'stock_adjustment',
  cols: ['date', 'warehouse_id', 'notes'], lineCols: ['material_id', 'counted_qty', 'notes'],
  blank: (l) => !l.material_id,
  async validate(p, lines) {
    await must('warehouses', p.warehouse_id, 'المخزن'); const seen = new Set();
    for (const l of lines) {
      await must('materials', l.material_id, 'الصنف');
      if (!(num(l.counted_qty, -1) >= 0)) throw new AppError('الكمية المجرودة لا يمكن أن تكون سالبة');
      if (seen.has(Number(l.material_id))) throw new AppError('صنف مكرر في الجرد'); seen.add(Number(l.material_id));
    }
  },
  async post(doc) {
    const pairs = [];
    for (const l of doc.lines) {
      const st = await stockAsOf(doc.warehouse_id, l.material_id, doc.date);
      const diff = Math.round((l.counted_qty - st.qty) * 1e6) / 1e6;
      await run('UPDATE stock_adjustment_lines SET system_qty=?, diff_qty=? WHERE id=?', st.qty, diff, l.id);
      if (diff > 0) {
        const cost = st.avg_cost > 0 ? st.avg_cost : await lastKnownCost(l.material_id);
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: diff, value: r2(diff * cost),
          doc_type: 'adjustment', doc_id: doc.id, line_id: l.id, party: 'جرد', notes: 'زيادة جرد' });
      } else if (diff < 0) {
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'out', qty: -diff,
          doc_type: 'adjustment', doc_id: doc.id, line_id: l.id, party: 'جرد', notes: 'عجز جرد' });
      } else continue;
      pairs.push([doc.warehouse_id, l.material_id]);
    }
    await settle(pairs, { type: 'adjustment', id: doc.id });
    await buildAdjustment(doc.id);
  },
  async unpost(cur) { await deleteJournals('adjustment', cur.id); await run(`DELETE FROM cost_lines WHERE source_type='adjustment' AND source_id=?`, cur.id); await removeMoves('adjustment', cur.id); },
};

// ============================================================
//  كشف يومية العمالة
// ============================================================
export const COST_CLASS = { direct: 'مباشرة (مرحلة تصنيع)', indirect: 'تكلفة غير مباشرة', admin: 'مصروفات إدارية' };
async function laborAccount(cls, stage_id) {
  if (cls === 'direct') {
    const a = await val('SELECT account_id FROM stages WHERE id=?', stage_id);
    if (!a) throw new AppError(`المرحلة «${await nm('stages', stage_id)}» غير مربوطة بحساب إنتاج تحت التشغيل`);
    return a;
  }
  return cls === 'indirect' ? await acc('acc_indirect_labor') : await acc('acc_admin_labor');
}
/** أجور مباشرة: (إنتاج تحت التشغيل ← أجور مباشرة) + (أجور مباشرة ← المستحقات) — الطرف التاني بيتضاف مع سطور المستحقات */
async function wageLines(cls, stage_id, cost, dims) {
  const wip = await laborAccount(cls, stage_id);
  if (cls !== 'direct') return [dc(wip, cost, dims)];
  const w = await acc('acc_indirect_labor');
  return [dc(wip, cost, dims), cr(w, cost, dims), dc(w, cost, dims)];
}
async function checkDims(project_id, item_id, stage_id, needStage) {
  if (needStage && !stage_id) throw new AppError('العمالة المباشرة لازم يتحدد لها مرحلة التصنيع');
  if (item_id) {
    const it = await get('SELECT project_id FROM project_items WHERE id=?', item_id);
    if (!it) throw new AppError('البند غير موجود');
    if (!project_id || it.project_id !== Number(project_id)) throw new AppError('البند لا يتبع المشروع المختار');
  }
}
DOCS.labor_sheet = {
  locked: (cur) => cur.status === 'posted' && !cur.reopened,
  relock: async (id) => { await run('UPDATE labor_sheets SET reopened=0 WHERE id=?', id); },
  table: 'labor_sheets', lines: 'labor_sheet_lines', fk: 'sheet_id', seq: 'labor_sheet',
  cols: ['date', 'notes', 'period_from', 'period_to', 'period_name'], lineCols: ['employee_id', 'days', 'ot_days', 'rate', 'other_additions', 'other_deductions', 'advance', 'amount', 'cost_class', 'project_id', 'item_id', 'stage_id', 'notes'],
  blank: (l) => !l.employee_id,
  async validate(p, lines, id) {
    // مدة الأجور: من/إلى (مطلوبين في الكشف الجديد) + اسم المدة تلقائي YYYY/NN بترقيم متسلسل لكل سنة
    const re = /^\d{4}-\d{2}-\d{2}$/; p.period_from = p.period_from || null; p.period_to = p.period_to || null;
    if (!id && (!p.period_from || !p.period_to)) throw new AppError('حدد مدة الأجور: من تاريخ وإلى تاريخ');
    if ((p.period_from && !re.test(p.period_from)) || (p.period_to && !re.test(p.period_to))) throw new AppError('تاريخ المدة غير صحيح');
    if (p.period_from && p.period_to && p.period_from > p.period_to) throw new AppError('تاريخ بداية المدة لازم يكون قبل تاريخ النهاية');
    if (!p.period_name && p.period_from) {
      const yr = p.period_from.slice(0, 4);
      const mx = (await all(`SELECT period_name FROM labor_sheets WHERE period_name LIKE ?`, `${yr}/%`)).reduce((m, r) => Math.max(m, parseInt(String(r.period_name).split('/')[1], 10) || 0), 0);
      p.period_name = `${yr}/${String(mx + 1).padStart(2, '0')}`;
    }
    // العامل الواحد ممكن يظهر في أكتر من سطر (مرحلة لكل سطر): الأجر واحد للعامل، والسلفة بتتجمع على أول سطر له
    const firstOf = new Map();
    for (const l of lines) {
      const f = firstOf.get(Number(l.employee_id));
      if (!f) {
        if (l.rate === undefined || l.rate === null || l.rate === '') l.rate = await val('SELECT daily_rate FROM employees WHERE id=?', l.employee_id);
        firstOf.set(Number(l.employee_id), l); continue;
      }
      f.advance = r2(num(f.advance) + num(l.advance)); l.advance = 0; l.rate = f.rate;
      f.other_additions = r2(num(f.other_additions) + num(l.other_additions)); l.other_additions = 0;
      f.other_deductions = r2(num(f.other_deductions) + num(l.other_deductions)); l.other_deductions = 0;
    }
    for (const l of lines) {
      const e = await get('SELECT * FROM employees WHERE id=?', l.employee_id);
      if (!e) throw new AppError('عامل غير موجود');
      l.advance = r2(l.advance); if (l.advance < 0) throw new AppError('سلفة المدة لا يمكن أن تكون سالبة');
      l.days = num(l.days); l.ot_days = num(l.ot_days); l.other_additions = r2(l.other_additions); l.other_deductions = r2(l.other_deductions);
      if (l.days < 0 || l.ot_days < 0 || l.other_additions < 0 || l.other_deductions < 0) throw new AppError('القيم لا يمكن أن تكون سالبة');
      if (!(l.days + l.ot_days > 0)) throw new AppError(`أيام الأساسي أو السهرات للعامل «${e.name}» لازم تكون أكبر من صفر`);
      l.cost_class = e.cost_class;
      if (l.rate === undefined || l.rate === null || l.rate === '') l.rate = e.daily_rate;
      // قيمة الأساسي = أيام الأساسي × اليومية، قيمة السهرات = أيام السهرات × اليومية، والصافي = الأساسي + السهرات + إضافات أخرى − خصومات أخرى − سلفة المدة
      l.rate = num(l.rate); l.amount = r2(l.days * l.rate + l.ot_days * l.rate + l.other_additions - l.other_deductions - l.advance);
      if (e.cost_class !== 'direct') { l.stage_id = l.stage_id || null; }
      await checkDims(l.project_id, l.item_id, l.stage_id, e.cost_class === 'direct');
    }
    // الصافي بيتراجع على مستوى العامل (مجموع أسطره) مش السطر الواحد
    const net = new Map(); for (const l of lines) net.set(Number(l.employee_id), r2((net.get(Number(l.employee_id)) || 0) + l.amount));
    for (const [eid, v] of net) if (v < 0) throw new AppError(`صافي المنصرف للعامل «${await nm('employees', eid)}» سالب`);
  },
  async post(doc) {
    const out = []; let total = 0, ded = 0; const netByEmp = new Map();
    for (const l of doc.lines) {
      // التكلفة = الأساسي + السهرات + إضافات أخرى، والمستحق للعامل = الصافي، وخصومات أخرى تروح لاستقطاعات العاملين
      const cost = r2(l.days * l.rate + l.ot_days * l.rate + l.other_additions);
      total += l.amount; ded += l.other_deductions;
      const dims = { project_id: l.project_id, item_id: l.item_id, stage_id: l.stage_id };
      out.push(...await wageLines(l.cost_class, l.stage_id, cost, { ...dims, employee_id: l.employee_id }));
      netByEmp.set(l.employee_id, r2((netByEmp.get(l.employee_id) || 0) + l.amount));
      if (l.advance) out.push(cr(await acc('acc_employee_advances'), l.advance, { employee_id: l.employee_id }));
      await insertRow('cost_lines', { date: doc.date, source_type: 'labor', source_id: doc.id, source_line_id: l.id, cost_type: 'labor', cost_class: l.cost_class, ...dims,
        employee_id: l.employee_id, qty: r2(l.days + l.ot_days), amount: cost, description: doc.no },
      ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'employee_id', 'qty', 'amount', 'description']);
    }
    for (const [employee_id, v] of netByEmp) out.push(cr(await acc('acc_wages_payable'), v, { employee_id }));
    if (ded) out.push(cr(await acc('acc_deductions_payable'), r2(ded)));
    await run('UPDATE labor_sheets SET total=? WHERE id=?', r2(total), doc.id);
    await postJournal({ date: doc.date, source_type: 'labor', source_id: doc.id, description: `كشف يومية ${doc.no}`, lines: out });
  },
  async unpost(cur) {
    if (cur.paid_amount > 0.004) throw new AppError('الكشف عليه صرف أجور — ألغِ سند الصرف أولاً');
    await deleteJournals('labor', cur.id);
    await run(`DELETE FROM cost_lines WHERE source_type='labor' AND source_id=?`, cur.id);
  },
};

// ============================================================
//  سلف عمال يومية: صرف مبلغ لكل عامل في نصف المدة — بيترحّل تلقائياً لعمود «سلفة المدة» في كشف اليومية
// ============================================================
DOCS.labor_advance = {
  table: 'labor_advances', lines: 'labor_advance_lines', fk: 'advance_id', seq: 'labor_advance',
  cols: ['date', 'notes', 'treasury_id', 'custodian_id'], lineCols: ['employee_id', 'amount', 'notes'],
  blank: (l) => !l.employee_id,
  async validate(p, lines) {
    p.treasury_id = p.treasury_id || null; p.custodian_id = p.custodian_id || null;
    await sourceCheck(p);
    const seen = new Set();
    for (const l of lines) {
      const e = await get('SELECT * FROM employees WHERE id=?', l.employee_id);
      if (!e) throw new AppError('عامل غير موجود');
      if (e.emp_type !== 'daily') throw new AppError(`«${e.name}» مش عامل يومية`);
      if (seen.has(Number(l.employee_id))) throw new AppError(`العامل «${e.name}» مكرر في الكشف`); seen.add(Number(l.employee_id));
      l.amount = r2(l.amount); if (!(l.amount > 0)) throw new AppError(`مبلغ السلفة للعامل «${e.name}» لازم يكون أكبر من صفر`);
    }
  },
  async post(doc) {
    const out = []; let total = 0;
    for (const l of doc.lines) { total += l.amount; out.push(dc(await acc('acc_employee_advances'), l.amount, { employee_id: l.employee_id })); }
    total = r2(total);
    const c = await cashSide(doc);
    out.push(cr(c.account_id, total, { treasury_id: c.treasury_id, custodian_id: c.custodian_id }));
    await run('UPDATE labor_advances SET total=? WHERE id=?', total, doc.id);
    await postJournal({ date: doc.date, source_type: 'labor_advance', source_id: doc.id, description: `سلف عمال يومية ${doc.no}`, lines: out });
  },
  async unpost(cur) {
    // ممنوع إلغاء/تعديل سلفة اتخصمت (كلها أو جزء منها) من كشف يومية: رصيد سلف العامل كان هيبقى بالسالب
    const adv = await acc('acc_employee_advances');
    for (const l of await all('SELECT * FROM labor_advance_lines WHERE advance_id=?', cur.id)) {
      const bal = r2(await val('SELECT COALESCE(SUM(debit-credit),0) FROM journal_lines WHERE account_id=? AND employee_id=?', adv, l.employee_id));
      if (bal - l.amount < -0.004) {
        const e = await nm('employees', l.employee_id);
        throw new AppError(`سلفة «${e}» (${r2(l.amount)}) اتخصم منها في كشف يومية — ألغِ الخصم من الكشف أولاً`);
      }
    }
    await deleteJournals('labor_advance', cur.id);
  },
};

// ============================================================
//  كشف الرواتب الشهرية (مع توزيع التكلفة على المشروعات/المراحل)
// ============================================================
DOCS.payroll = {
  table: 'payroll_runs', lines: 'payroll_lines', fk: 'run_id', seq: 'payroll',
  cols: ['month', 'date', 'notes'], lineCols: ['employee_id', 'base', 'additions_days', 'additions', 'deductions_days', 'deductions', 'other_additions', 'other_deductions', 'net', 'cost_class', 'notes'],
  blank: (l) => !l.employee_id,
  async enrich(h) {
    for (const l of h.lines) l.allocations = await all('SELECT * FROM payroll_allocations WHERE line_id=?', l.id);
  },
  async validate(p, lines, id) {
    if (!/^\d{4}-\d{2}$/.test(p.month || '')) throw new AppError('الشهر بصيغة YYYY-MM');
    const seen = new Set();
    for (const l of lines) {
      const e = await get('SELECT * FROM employees WHERE id=?', l.employee_id);
      if (!e) throw new AppError('عامل غير موجود');
      if (seen.has(Number(l.employee_id))) throw new AppError(`العامل «${e.name}» مكرر في الكشف`); seen.add(Number(l.employee_id));
      const dup = await get(`SELECT r.no FROM payroll_lines pl JOIN payroll_runs r ON r.id=pl.run_id WHERE r.month=? AND pl.employee_id=? AND r.status='posted' AND r.id<>?`, p.month, l.employee_id, id || 0);
      if (dup) throw new AppError(`العامل «${e.name}» له راتب عن نفس الشهر في الكشف ${dup.no}`);
      l.base = r2(num(l.base, e.monthly_salary));
      l.additions_days = num(l.additions_days); l.deductions_days = num(l.deductions_days);
      l.other_additions = r2(l.other_additions); l.other_deductions = r2(l.other_deductions);
      if (l.base < 0 || l.additions_days < 0 || l.deductions_days < 0 || l.other_additions < 0 || l.other_deductions < 0) throw new AppError('القيم لا يمكن أن تكون سالبة');
      // أجر اليوم = المرتب الشهري ÷ 30، وقيمة الإضافات/الاستقطاعات = أجر اليوم × عدد الأيام
      const day = l.base / 30; l.additions = r2(day * l.additions_days); l.deductions = r2(day * l.deductions_days);
      l.net = r2(l.base + l.additions - l.deductions + l.other_additions - l.other_deductions);
      if (l.net < 0) throw new AppError(`صافي راتب «${e.name}» سالب`);
      l.cost_class = e.cost_class;
      if (e.cost_class === 'direct') {
        let al = Array.isArray(l.allocations) && l.allocations.length ? l.allocations : [{ stage_id: e.default_stage_id, percent: 100 }];
        al = al.map((a) => ({ project_id: a.project_id || null, item_id: a.item_id || null, stage_id: a.stage_id || null, percent: num(a.percent) }));
        if (Math.abs(al.reduce((s, a) => s + a.percent, 0) - 100) > 0.01) throw new AppError(`توزيع تكلفة «${e.name}» لازم يساوي 100%`);
        for (const a of al) await checkDims(a.project_id, a.item_id, a.stage_id, true);
        l.allocations = al;
      } else l.allocations = [];
    }
  },
  async post(doc, user, p) {
    const out = []; let gross = 0, ded = 0, net = 0;
    for (const [i, l] of doc.lines.entries()) {
      const cost = r2(l.base + l.additions + l.other_additions), lineDed = r2(l.deductions + l.other_deductions);
      gross += cost; ded += lineDed; net += l.net;
      const allocs = l.cost_class === 'direct' ? (p.lines[i].allocations || []) : [{ project_id: null, item_id: null, stage_id: null, percent: 100 }];
      let used = 0;
      for (const [k, a] of allocs.entries()) {
        const amt = k === allocs.length - 1 ? r2(cost - used) : r2(cost * a.percent / 100); used = r2(used + amt);
        if (l.cost_class === 'direct') await insertRow('payroll_allocations', { line_id: l.id, project_id: a.project_id, item_id: a.item_id, stage_id: a.stage_id, percent: a.percent }, ['line_id', 'project_id', 'item_id', 'stage_id', 'percent']);
        const dims = { project_id: a.project_id, item_id: a.item_id, stage_id: a.stage_id };
        out.push(...await wageLines(l.cost_class, a.stage_id, amt, { ...dims, employee_id: l.employee_id }));
        await insertRow('cost_lines', { date: doc.date, source_type: 'payroll', source_id: doc.id, source_line_id: l.id, cost_type: 'labor', cost_class: l.cost_class, ...dims,
          employee_id: l.employee_id, qty: 1, amount: amt, description: `${doc.no} — ${doc.month}` },
        ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'employee_id', 'qty', 'amount', 'description']);
      };
      out.push(cr(await acc('acc_wages_payable'), l.net, { employee_id: l.employee_id }));
    };
    if (ded) out.push(cr(await acc('acc_deductions_payable'), r2(ded)));
    await run('UPDATE payroll_runs SET gross=?, deductions=?, net=? WHERE id=?', r2(gross), r2(ded), r2(net), doc.id);
    await postJournal({ date: doc.date, source_type: 'payroll', source_id: doc.id, description: `كشف رواتب ${doc.month} — ${doc.no}`, lines: out });
  },
  async unpost(cur) {
    if (cur.paid_amount > 0.004) throw new AppError('الكشف عليه صرف مرتبات — ألغِ سند الصرف أولاً');
    await deleteJournals('payroll', cur.id);
    await run(`DELETE FROM cost_lines WHERE source_type='payroll' AND source_id=?`, cur.id);
  },
};

// ============================================================
//  سندات الخزينة والعهد
// ============================================================
const VOUCHER_KINDS = {
  disbursement: 'سند صرف', collection: 'سند مقبوضات', supplier_payment: 'سداد مورد', expense: 'مصروف', wage_payment: 'صرف أجور ومرتبات', custody_issue: 'صرف عهدة',
  custody_return: 'رد عهدة', transfer: 'تحويل بين الخزن', receipt: 'سند قبض', payment_other: 'سند صرف آخر',
};
export { VOUCHER_KINDS };
async function cashSide(v) {
  if (v.treasury_id) return { account_id: await val('SELECT account_id FROM treasuries WHERE id=?', v.treasury_id), treasury_id: v.treasury_id };
  return { account_id: await acc('acc_custody'), custodian_id: v.custodian_id };
}
async function sourceCheck(p) {
  if (!!p.treasury_id === !!p.custodian_id) throw new AppError('حدد مصدر الدفع: خزينة أو عهدة (واحد فقط)');
  if (p.treasury_id) await must('treasuries', p.treasury_id, 'الخزينة'); else await must('custodians', p.custodian_id, 'صاحب العهدة');
}
// الجدول اللي كل نوع دفع بيرتبط بيه (اسم الطرف في سطر سند الصرف)
const PAY_TABLE = { supplier: 'suppliers', expense: 'expense_categories', client: 'clients', employee: 'employees', custodian: 'custodians', account: 'accounts' };
/** توزيع مبلغ السداد على فواتير المورد الآجلة المفتوحة (الأقدم أولاً)؛ الباقي يفضل دفعة مقدمة */
async function allocateToInvoices(voucherId, supplierId, amount) {
  let left = r2(amount);
  const invs = await all(`SELECT * FROM purchase_invoices WHERE supplier_id=? AND payment_type='credit' AND status='posted' ORDER BY date, id`, supplierId);
  for (const inv of invs) {
    if (left <= 0.004) break;
    const open = await invoiceOpenAmount(inv); if (open <= 0.004) continue;
    const x = r2(Math.min(left, open));
    await insertRow('voucher_allocations', { voucher_id: voucherId, invoice_id: inv.id, amount: x }, ['voucher_id', 'invoice_id', 'amount']);
    left = r2(left - x);
  }
}
DOCS.voucher = {
  table: 'vouchers', lines: 'voucher_lines', fk: 'voucher_id', requireLines: false,
  seq: (p) => (p.kind === 'disbursement' ? 'v_expense' : p.kind === 'collection' ? 'v_receipt' : `v_${p.kind}`),
  lineCols: ['payment_type_id', 'party_id', 'amount', 'project_id', 'item_id', 'stage_id', 'notes'],
  blank: (l) => !l.payment_type_id && !l.party_id && !num(l.amount) && !String(l.notes || '').trim(),
  cols: ['date', 'kind', 'treasury_id', 'custodian_id', 'to_treasury_id', 'supplier_id', 'category_id', 'account_id', 'project_id', 'item_id', 'stage_id', 'amount', 'description', 'ref_no'],
  async enrich(h) {
    h.allocations = await all('SELECT * FROM voucher_allocations WHERE voucher_id=?', h.id);
    h.wage_links = await all('SELECT * FROM voucher_wage_links WHERE voucher_id=?', h.id);
  },
  async validate(p, lines) {
    if (!VOUCHER_KINDS[p.kind]) throw new AppError('نوع السند غير معروف');
    if (p.kind === 'collection') {
      if (!lines.length) throw new AppError('أضف سطر مقبوضات واحد على الأقل');
      if (!!p.treasury_id === !!p.custodian_id) throw new AppError('حدد مكان الإيداع: خزينة أو عهدة (واحد فقط)');
      if (p.treasury_id) await must('treasuries', p.treasury_id, 'الخزينة'); else await must('custodians', p.custodian_id, 'صاحب العهدة');
      let sum = 0;
      for (const [i, l] of lines.entries()) {
        const at = `السطر ${i + 1}: `;
        const t = await get('SELECT * FROM receipt_types WHERE id=?', l.payment_type_id);
        if (!t) throw new AppError(at + 'اختر نوع المقبوض');
        if (!l.party_id) throw new AppError(at + 'اختر الاسم');
        const party = await get(`SELECT * FROM ${PAY_TABLE[t.link]} WHERE id=?`, l.party_id);
        if (!party) throw new AppError(at + 'الاسم غير موجود');
        l.amount = r2(l.amount);
        if (!(l.amount > 0)) throw new AppError(at + 'القيمة لازم تكون أكبر من صفر');
        if (t.link === 'account' && !party.postable) throw new AppError(at + 'اختر حساب فرعي (يقبل قيود)');
        l.stage_id = null;
        if (l.project_id) await must('projects', l.project_id, 'المشروع');
        await checkDims(l.project_id, l.item_id, null, false);
        sum += l.amount;
      }
      p.amount = r2(sum);
      return;
    }
    if (p.kind === 'disbursement') {
      if (!lines.length) throw new AppError('أضف مصروف أو سداد واحد على الأقل');
      await sourceCheck(p);
      let sum = 0;
      for (const [i, l] of lines.entries()) {
        const at = `السطر ${i + 1}: `;
        const t = await get('SELECT * FROM payment_types WHERE id=?', l.payment_type_id);
        if (!t) throw new AppError(at + 'اختر نوع الدفع');
        if (!l.party_id) throw new AppError(at + 'اختر الاسم');
        const party = await get(`SELECT * FROM ${PAY_TABLE[t.link]} WHERE id=?`, l.party_id);
        if (!party) throw new AppError(at + 'الاسم غير موجود');
        l.amount = r2(l.amount);
        if (!(l.amount > 0)) throw new AppError(at + 'القيمة لازم تكون أكبر من صفر');
        if (t.link === 'expense') {
          if (party.cost_class === 'direct') {
            if (!l.project_id) throw new AppError(at + 'المصروف المباشر لازم يتحدد له المشروع');
            if (!l.stage_id) throw new AppError(at + 'المصروف المباشر لازم يتحدد له مرحلة التصنيع');
          } else if (!party.account_id) throw new AppError(at + `فئة المصروف «${party.name}» غير مربوطة بحساب`);
        } else if (t.link === 'account' && !party.postable) throw new AppError(at + 'اختر حساب فرعي (يقبل قيود)');
        if (l.project_id) await must('projects', l.project_id, 'المشروع');
        if (l.stage_id) await must('stages', l.stage_id, 'المرحلة');
        await checkDims(l.project_id, l.item_id, l.stage_id, false);
        sum += l.amount;
      }
      p.amount = r2(sum);
      return;
    }
    p.amount = r2(p.amount);
    if (!(p.amount > 0)) throw new AppError('المبلغ لازم يكون أكبر من صفر');
    const k = p.kind;
    if (['supplier_payment', 'expense', 'wage_payment', 'payment_other'].includes(k)) await sourceCheck(p);
    if (k === 'supplier_payment') {
      await must('suppliers', p.supplier_id, 'المورد');
      const al = (p.allocations || []).filter((a) => num(a.amount) > 0);
      const sum = r2(al.reduce((s, a) => s + num(a.amount), 0));
      if (sum > p.amount + 0.004) throw new AppError('توزيع الدفعة على الفواتير أكبر من مبلغ السند');
      for (const a of al) {
        const inv = await get('SELECT * FROM purchase_invoices WHERE id=?', a.invoice_id);
        if (!inv || inv.supplier_id !== Number(p.supplier_id) || inv.status === 'void' || inv.payment_type !== 'credit') throw new AppError('فاتورة غير صالحة للسداد');
        if (num(a.amount) > await invoiceOpenAmount(inv) + 0.004) throw new AppError(`المبلغ أكبر من المتبقي على الفاتورة ${inv.no} (${await invoiceOpenAmount(inv)})`);
      }
    }
    if (k === 'expense') {
      const c = await get('SELECT * FROM expense_categories WHERE id=?', p.category_id);
      if (!c) throw new AppError('اختر فئة المصروف');
      if (c.cost_class === 'direct') await checkDims(p.project_id, p.item_id, p.stage_id, true);
      else if (!c.account_id) throw new AppError(`فئة المصروف «${c.name}» غير مربوطة بحساب`);
    }
    if (k === 'wage_payment') {
      const links = (p.wage_links || []).filter((l) => num(l.amount) > 0);
      const sum = r2(links.reduce((s, l) => s + num(l.amount), 0));
      if (sum > p.amount + 0.004) throw new AppError('توزيع الصرف على الكشوف أكبر من مبلغ السند');
      for (const l of links) {
        const t = l.sheet_id ? await get('SELECT total t, paid_amount pa, status FROM labor_sheets WHERE id=?', l.sheet_id) : await get('SELECT net t, paid_amount pa, status FROM payroll_runs WHERE id=?', l.run_id);
        if (!t || t.status === 'void') throw new AppError('كشف غير صالح للصرف');
        if (num(l.amount) > r2(t.t - t.pa) + 0.004) throw new AppError('المبلغ أكبر من المتبقي صرفه على الكشف');
      }
    }
    if (k === 'custody_issue' || k === 'custody_return') { await must('treasuries', p.treasury_id, 'الخزينة'); await must('custodians', p.custodian_id, 'صاحب العهدة'); }
    if (k === 'transfer') {
      await must('treasuries', p.treasury_id, 'الخزينة المحوّل منها'); await must('treasuries', p.to_treasury_id, 'الخزينة المحوّل إليها');
      if (Number(p.treasury_id) === Number(p.to_treasury_id)) throw new AppError('الخزينتان لازم يكونوا مختلفتين');
    }
    if (k === 'receipt') { await must('treasuries', p.treasury_id, 'الخزينة'); await must('accounts', p.account_id, 'حساب الإيراد/الدائن'); }
    if (k === 'payment_other') await must('accounts', p.account_id, 'الحساب المدين');
  },
  async post(doc, user, p) {
    const k = doc.kind; const a = doc.amount; const desc = doc.description || VOUCHER_KINDS[k];
    const src = async () => await cashSide(doc); let lines;
    if (k === 'collection') {
      lines = []; const types = {};
      const s = await src(); lines.push(dc(s.account_id, a, s));
      for (const l of doc.lines) {
        const t = types[l.payment_type_id] ||= await get('SELECT * FROM receipt_types WHERE id=?', l.payment_type_id);
        const note = String(l.notes || '').trim() || null;
        if (t.link === 'client') lines.push(cr(await acc('acc_ar'), l.amount, { client_id: l.party_id, project_id: l.project_id, item_id: l.item_id, description: note }));
        else if (t.link === 'supplier') lines.push(cr(await acc('acc_ap'), l.amount, { supplier_id: l.party_id, description: note }));
        else if (t.link === 'employee') lines.push(cr(await acc('acc_employee_advances'), l.amount, { employee_id: l.party_id, project_id: l.project_id, description: note }));
        else if (t.link === 'custodian') lines.push(cr(await acc('acc_custody'), l.amount, { custodian_id: l.party_id, description: note }));
        else lines.push(cr(l.party_id, l.amount, { project_id: l.project_id, item_id: l.item_id, description: note }));
      }
    } else if (k === 'disbursement') {
      lines = []; const types = {}; const cats = {};
      for (const l of doc.lines) {
        const t = types[l.payment_type_id] ||= await get('SELECT * FROM payment_types WHERE id=?', l.payment_type_id);
        const note = String(l.notes || '').trim() || null;
        const dims = { project_id: l.project_id, item_id: l.item_id, stage_id: l.stage_id };
        if (t.link === 'supplier') {
          lines.push(dc(await acc('acc_ap'), l.amount, { supplier_id: l.party_id, description: note }));
          await allocateToInvoices(doc.id, l.party_id, l.amount);
        } else if (t.link === 'expense') {
          const c = cats[l.party_id] ||= await get('SELECT * FROM expense_categories WHERE id=?', l.party_id);
          const debitAcc = c.cost_class === 'direct' ? await laborAccount('direct', l.stage_id) : c.account_id;
          lines.push(dc(debitAcc, l.amount, { ...dims, description: note }));
          await insertRow('cost_lines', { date: doc.date, source_type: 'voucher', source_id: doc.id, source_line_id: l.id, cost_type: 'expense', cost_class: c.cost_class, ...dims, category_id: c.id, qty: 1, amount: l.amount, description: `${doc.no} — ${note || c.name}` },
            ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'category_id', 'qty', 'amount', 'description']);
        } else if (t.link === 'client') lines.push(dc(await acc('acc_ar'), l.amount, { client_id: l.party_id, project_id: l.project_id, description: note }));
        else if (t.link === 'employee') lines.push(dc(await acc('acc_employee_advances'), l.amount, { employee_id: l.party_id, project_id: l.project_id, description: note }));
        else if (t.link === 'custodian') lines.push(dc(await acc('acc_custody'), l.amount, { custodian_id: l.party_id, description: note }));
        else lines.push(dc(l.party_id, l.amount, { project_id: l.project_id, description: note }));
      }
      const s = await src(); lines.push(cr(s.account_id, a, s));
    } else if (k === 'supplier_payment') {
      lines = [dc(await acc('acc_ap'), a, { supplier_id: doc.supplier_id }), cr((await src()).account_id, a, await src())];
      for (const al of (p.allocations || []).filter((x) => num(x.amount) > 0)) await insertRow('voucher_allocations', { voucher_id: doc.id, invoice_id: al.invoice_id, amount: r2(al.amount) }, ['voucher_id', 'invoice_id', 'amount']);
    } else if (k === 'expense') {
      const c = await get('SELECT * FROM expense_categories WHERE id=?', doc.category_id);
      const dims = { project_id: doc.project_id, item_id: doc.item_id, stage_id: doc.stage_id };
      const debitAcc = c.cost_class === 'direct' ? await laborAccount('direct', doc.stage_id) : c.account_id;
      lines = [dc(debitAcc, a, dims), cr((await src()).account_id, a, await src())];
      await insertRow('cost_lines', { date: doc.date, source_type: 'voucher', source_id: doc.id, cost_type: 'expense', cost_class: c.cost_class, ...dims, category_id: c.id, qty: 1, amount: a, description: `${doc.no} — ${desc}` },
        ['date', 'source_type', 'source_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'category_id', 'qty', 'amount', 'description']);
    } else if (k === 'wage_payment') {
      lines = [dc(await acc('acc_wages_payable'), a), cr((await src()).account_id, a, await src())];
      for (const l of (p.wage_links || []).filter((x) => num(x.amount) > 0)) {
        await insertRow('voucher_wage_links', { voucher_id: doc.id, sheet_id: l.sheet_id || null, run_id: l.run_id || null, amount: r2(l.amount) }, ['voucher_id', 'sheet_id', 'run_id', 'amount']);
        if (l.sheet_id) await run('UPDATE labor_sheets SET paid_amount=paid_amount+? WHERE id=?', r2(l.amount), l.sheet_id);
        else await run('UPDATE payroll_runs SET paid_amount=paid_amount+? WHERE id=?', r2(l.amount), l.run_id);
      }
    } else if (k === 'custody_issue') {
      const t = await cashSide({ treasury_id: doc.treasury_id });
      lines = [dc(await acc('acc_custody'), a, { custodian_id: doc.custodian_id }), cr(t.account_id, a, t)];
    } else if (k === 'custody_return') {
      const t = await cashSide({ treasury_id: doc.treasury_id });
      lines = [dc(t.account_id, a, t), cr(await acc('acc_custody'), a, { custodian_id: doc.custodian_id })];
    } else if (k === 'transfer') {
      const f = await cashSide({ treasury_id: doc.treasury_id }); const t = await cashSide({ treasury_id: doc.to_treasury_id });
      lines = [dc(t.account_id, a, t), cr(f.account_id, a, f)];
    } else if (k === 'receipt') {
      const t = await cashSide({ treasury_id: doc.treasury_id });
      lines = [dc(t.account_id, a, t), cr(doc.account_id, a, { project_id: doc.project_id })];
    } else { // payment_other
      lines = [dc(doc.account_id, a, { project_id: doc.project_id }), cr((await src()).account_id, a, await src())];
    }
    await postJournal({ date: doc.date, source_type: 'voucher', source_id: doc.id, description: `${VOUCHER_KINDS[k]} ${doc.no} — ${desc}`, lines });
  },
  async unpost(cur) {
    for (const l of await all('SELECT * FROM voucher_wage_links WHERE voucher_id=?', cur.id)) {
      if (l.sheet_id) await run('UPDATE labor_sheets SET paid_amount=MAX(0,paid_amount-?) WHERE id=?', l.amount, l.sheet_id);
      else await run('UPDATE payroll_runs SET paid_amount=MAX(0,paid_amount-?) WHERE id=?', l.amount, l.run_id);
    }
    await run('DELETE FROM voucher_wage_links WHERE voucher_id=?', cur.id);
    await run('DELETE FROM voucher_allocations WHERE voucher_id=?', cur.id);
    await run(`DELETE FROM cost_lines WHERE source_type='voucher' AND source_id=?`, cur.id);
    await deleteJournals('voucher', cur.id);
  },
};
