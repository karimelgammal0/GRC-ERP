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
  await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.enrich?.(h);
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
      await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.unpost?.(cur);
      if (D.lines) await run(`DELETE FROM ${D.lines} WHERE ${D.fk}=?`, id);
      await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.validate?.(p, lines, id);
      await updateRow(D.table, id, p, D.cols);
    } else {
      await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.validate?.(p, lines, null);
      const no = await nextNo(typeof D.seq === 'function' ? D.seq(p) : D.seq);
      docId = await insertRow(D.table, { ...p, no, created_by: user?.id ?? null }, [...D.cols, 'no', 'created_by']);
    }
    for (const l of lines) l.id = await insertRow(D.lines, { ...l, [D.fk]: docId }, [...D.lineCols, D.fk]);
    const doc = await getDoc(type, docId);
    await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.post?.(doc, user, p);
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
    await await await await await await await await await await await await await await await await await await await await await await await await await await await await await D.unpost?.(cur);
    await run(`UPDATE ${D.table} SET status='void' WHERE id=?`, id);
    await audit(user, 'void', type, id, { no: cur.no });
    return await getDoc(type, id);
  });
}

// ============================================================
//  طلبات الشراء
// ============================================================
DOCS.purchase_request = {
  table: 'purchase_requests', lines: 'purchase_request_lines', fk: 'request_id', seq: 'purchase_request',
  cols: ['date', 'requested_by_id', 'project_id', 'needed_date', 'notes'], lineCols: ['material_id', 'qty', 'notes'],
  blank: (l) => !l.material_id,
  async validate(p, lines) { for (const l of lines) { await must('materials', l.material_id, 'الخامة'); posQty(l); } },
  async unpost(cur) {
    if (await val('SELECT COUNT(*) FROM purchase_request_lines WHERE request_id=? AND ordered_qty>0', cur.id))
      throw new AppError('تم إصدار أمر شراء على هذا الطلب — ألغِ أمر الشراء أولاً');
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
//  أوامر الشراء
// ============================================================
DOCS.purchase_order = {
  table: 'purchase_orders', lines: 'purchase_order_lines', fk: 'order_id', seq: 'purchase_order',
  cols: ['date', 'supplier_id', 'request_id', 'expected_date', 'payment_type', 'notes'],
  lineCols: ['material_id', 'qty', 'unit_price', 'request_line_id', 'notes'],
  blank: (l) => !l.material_id,
  enrich(h) { h.total = r2(h.lines.reduce((s, l) => s + l.qty * l.unit_price, 0)); },
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد');
    for (const l of lines) {
      await must('materials', l.material_id, 'الخامة'); posQty(l);
      if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً');
      if (l.request_line_id) {
        const rl = await get('SELECT * FROM purchase_request_lines WHERE id=?', l.request_line_id);
        if (!rl || rl.request_id !== Number(p.request_id)) throw new AppError('بند طلب الشراء لا يخص الطلب المختار');
        if (rl.material_id !== Number(l.material_id)) throw new AppError('الخامة لا تطابق بند طلب الشراء');
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
//  إذن الاستلام  (مخزون + استلامات غير مفوترة)
// ============================================================
DOCS.goods_receipt = {
  table: 'goods_receipts', lines: 'goods_receipt_lines', fk: 'receipt_id', seq: 'goods_receipt',
  cols: ['date', 'supplier_id', 'warehouse_id', 'order_id', 'supplier_ref', 'notes'],
  lineCols: ['material_id', 'qty', 'unit_price', 'order_line_id', 'notes'],
  blank: (l) => !l.material_id,
  enrich(h) { h.total = r2(h.lines.reduce((s, l) => s + l.qty * l.unit_price, 0)); },
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد'); await must('warehouses', p.warehouse_id, 'المخزن');
    if (p.order_id) {
      const o = await get('SELECT * FROM purchase_orders WHERE id=?', p.order_id);
      if (!o || o.status === 'void' || o.status === 'closed') throw new AppError('أمر الشراء غير متاح للاستلام');
      if (o.supplier_id !== Number(p.supplier_id)) throw new AppError('أمر الشراء لمورد مختلف');
    }
    for (const l of lines) {
      await must('materials', l.material_id, 'الخامة'); posQty(l);
      if (l.order_line_id) {
        const ol = await get('SELECT * FROM purchase_order_lines WHERE id=?', l.order_line_id);
        if (!ol || ol.order_id !== Number(p.order_id)) throw new AppError('بند أمر الشراء لا يخص الأمر المختار');
        if (ol.material_id !== Number(l.material_id)) throw new AppError('الخامة لا تطابق بند أمر الشراء');
        if (num(l.qty) > ol.qty - ol.received_qty + 1e-6) throw new AppError(`كمية الاستلام أكبر من المتبقي في أمر الشراء (${r4(ol.qty - ol.received_qty)})`);
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
    await postJournal({ date: doc.date, source_type: 'receipt', source_id: doc.id, description: `إذن استلام ${doc.no} — ${supplier}`,
      lines: [dc(await acc('acc_inventory_raw'), total), cr(await acc('acc_grni'), total, { supplier_id: doc.supplier_id })] });
  },
  async unpost(cur) {
    if (await val('SELECT COUNT(*) FROM goods_receipt_lines WHERE receipt_id=? AND invoiced_qty>0', cur.id))
      throw new AppError('إذن الاستلام مرتبط بفاتورة شراء — ألغِ الفاتورة أولاً');
    for (const l of await all('SELECT * FROM goods_receipt_lines WHERE receipt_id=?', cur.id))
      if (l.order_line_id) await run('UPDATE purchase_order_lines SET received_qty=MAX(0,received_qty-?) WHERE id=?', l.qty, l.order_line_id);
    await deleteJournals('receipt', cur.id);
    await removeMoves('receipt', cur.id);
    await refreshOrderStatus(cur.order_id);
  },
};

// ============================================================
//  فاتورة الشراء (آجل / نقدي) — مباشرة أو مطابقة لإذن استلام
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
      await must('materials', l.material_id, 'الخامة'); posQty(l);
      if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً');
      sub += r2(l.qty * l.unit_price);
      if (l.grn_line_id) {
        const g = await get(`SELECT gl.*, gr.supplier_id, gr.status FROM goods_receipt_lines gl JOIN goods_receipts gr ON gr.id=gl.receipt_id WHERE gl.id=?`, l.grn_line_id);
        if (!g || g.status === 'void') throw new AppError('بند الاستلام غير متاح');
        if (g.supplier_id !== Number(p.supplier_id)) throw new AppError('إذن الاستلام لمورد مختلف');
        if (g.material_id !== Number(l.material_id)) throw new AppError('الخامة لا تطابق بند الاستلام');
        if (num(l.qty) > g.qty - g.invoiced_qty + 1e-6) throw new AppError(`كمية الفاتورة أكبر من غير المفوتر في الاستلام (${r4(g.qty - g.invoiced_qty)})`);
      }
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
    let inv = 0, grni = 0; const pairs = [];
    for (const [i, l] of L.entries()) {
      await run('UPDATE purchase_invoice_lines SET net_cost=? WHERE id=?', eff[i], l.id);
      if (!l.grn_line_id) {
        await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'in', qty: l.qty, value: eff[i],
          doc_type: 'invoice', doc_id: doc.id, line_id: l.id, party: supplier, notes: doc.supplier_inv_no });
        pairs.push([doc.warehouse_id, l.material_id]); inv += eff[i];
      } else {
        const g = await get('SELECT gl.*, gr.warehouse_id wh FROM goods_receipt_lines gl JOIN goods_receipts gr ON gr.id=gl.receipt_id WHERE gl.id=?', l.grn_line_id);
        const grnVal = r2(l.qty * g.unit_price); const delta = r2(eff[i] - grnVal);
        await run('UPDATE goods_receipt_lines SET invoiced_qty=invoiced_qty+? WHERE id=?', l.qty, l.grn_line_id);
        grni += grnVal;
        if (delta !== 0) {
          // فرق سعر/نقل: بيتضاف لقيمة المخزون مباشرة (بدون حساب فروق أسعار)
          await addMove({ date: doc.date, warehouse_id: g.wh, material_id: l.material_id, direction: 'in', qty: 0, value: delta,
            doc_type: 'invoice', doc_id: doc.id, line_id: l.id, party: supplier, notes: 'فرق سعر/تحميل' });
          pairs.push([g.wh, l.material_id]); inv += delta;
        }
      }
    };
    await settle(pairs, { type: 'invoice', id: doc.id });
    const payer = doc.payment_type === 'cash'
      ? (doc.treasury_id ? { account_id: await val('SELECT account_id FROM treasuries WHERE id=?', doc.treasury_id), treasury_id: doc.treasury_id }
        : { account_id: await acc('acc_custody'), custodian_id: doc.custodian_id }) : null;
    const lines = [
      dc(await acc('acc_inventory_raw'), r2(inv)), dc(await acc('acc_grni'), r2(grni), { supplier_id: doc.supplier_id }),
      vat ? dc(await acc('acc_vat_in'), vat) : null,
      cr(await acc('acc_ap'), total, { supplier_id: doc.supplier_id }),
    ].filter(Boolean).filter((l) => l.debit || l.credit);
    if (payer) { lines.push(dc(await acc('acc_ap'), total, { supplier_id: doc.supplier_id })); lines.push(cr(payer.account_id, total, payer)); }
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
DOCS.purchase_return = {
  table: 'purchase_returns', lines: 'purchase_return_lines', fk: 'return_id', seq: 'purchase_return',
  cols: ['date', 'supplier_id', 'warehouse_id', 'invoice_id', 'notes'], lineCols: ['material_id', 'qty', 'unit_price', 'notes'],
  blank: (l) => !l.material_id,
  async validate(p, lines) {
    await must('suppliers', p.supplier_id, 'المورد'); await must('warehouses', p.warehouse_id, 'المخزن');
    for (const l of lines) { await must('materials', l.material_id, 'الخامة'); posQty(l); if (num(l.unit_price) < 0) throw new AppError('السعر لا يمكن أن يكون سالباً'); }
  },
  async post(doc) {
    const supplier = await nm('suppliers', doc.supplier_id); const pairs = []; let total = 0;
    for (const l of doc.lines) {
      const value = r2(l.qty * l.unit_price); total += value;
      await addMove({ date: doc.date, warehouse_id: doc.warehouse_id, material_id: l.material_id, direction: 'out', qty: l.qty, value,
        doc_type: 'preturn', doc_id: doc.id, line_id: l.id, party: supplier, notes: 'مرتجع مشتريات' });
      pairs.push([doc.warehouse_id, l.material_id]);
    }
    await settle(pairs, { type: 'preturn', id: doc.id });
    total = r2(total);
    await run('UPDATE purchase_returns SET total=? WHERE id=?', total, doc.id);
    await postJournal({ date: doc.date, source_type: 'preturn', source_id: doc.id, description: `مرتجع مشتريات ${doc.no} — ${supplier}`,
      lines: [dc(await acc('acc_ap'), total, { supplier_id: doc.supplier_id }), cr(await acc('acc_inventory_raw'), total)] });
  },
  async unpost(cur) { await deleteJournals('preturn', cur.id); await removeMoves('preturn', cur.id); },
};

// ============================================================
//  إذن صرف خامات (إنتاج / تحويل لموقع / تشغيل غير مباشر) ومرتجع صرف
//  الأبعاد الأساسية للتكلفة: مشروع + بند + مرحلة
// ============================================================
async function issueAccount(kind, stage_id) {
  if (kind === 'production') {
    const a = await val('SELECT account_id FROM stages WHERE id=?', stage_id);
    if (!a) throw new AppError(`المرحلة «${await nm('stages', stage_id)}» غير مربوطة بحساب إنتاج تحت التشغيل — اربطها من الإعدادات ← المراحل`);
    return a;
  }
  return kind === 'site' ? await acc('acc_site_transfer') : await acc('acc_overhead_materials');
}
const effectiveKind = async (h) => (h.kind === 'return' ? await val('SELECT kind FROM stock_issues WHERE id=?', h.ref_issue_id) : h.kind);

async function buildIssue(id) {
  const h = await get('SELECT * FROM stock_issues WHERE id=?', id);
  if (!h || h.status === 'void') return;
  const sign = h.kind === 'return' ? -1 : 1; const kind = await effectiveKind(h);
  const lines = await all('SELECT * FROM stock_issue_lines WHERE issue_id=? ORDER BY id', id);
  let total = 0;
  await run(`DELETE FROM cost_lines WHERE source_type='issue' AND source_id=?`, id);
  for (const l of lines) {
    const mv = await get(`SELECT value, unit_cost FROM stock_moves WHERE doc_type='issue' AND doc_id=? AND line_id=?`, id, l.id);
    const value = mv.value;
    await run('UPDATE stock_issue_lines SET unit_cost=?, total=? WHERE id=?', mv.unit_cost, value, l.id);
    total += value;
    await insertRow('cost_lines', {
      date: h.date, source_type: 'issue', source_id: id, source_line_id: l.id, cost_type: 'material',
      cost_class: kind === 'overhead' ? 'indirect' : 'direct', project_id: h.project_id, item_id: h.item_id, stage_id: h.stage_id, site_id: h.site_id,
      material_id: l.material_id, qty: sign * l.qty, amount: sign * value, description: h.no,
    }, ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'site_id', 'material_id', 'qty', 'amount', 'description']);
  }
  total = r2(total);
  const dims = { project_id: h.project_id, item_id: h.item_id, stage_id: h.stage_id };
  const costAcc = await issueAccount(kind, h.stage_id);
  const inv = await acc('acc_inventory_raw');
  const label = { production: 'إنتاج', site: 'تحويل لموقع', overhead: 'تشغيل غير مباشر' }[kind];
  await replaceJournal({
    date: h.date, source_type: 'issue', source_id: id, description: `${h.kind === 'return' ? 'مرتجع صرف' : 'صرف'} ${h.no} — ${label}`,
    lines: sign === 1 ? [dc(costAcc, total, dims), cr(inv, total)] : [dc(inv, total), cr(costAcc, total, dims)],
  });
}
onRecost.issue = buildIssue;

DOCS.stock_issue = {
  table: 'stock_issues', lines: 'stock_issue_lines', fk: 'issue_id',
  seq: (p) => (p.kind === 'return' ? 'stock_return' : 'stock_issue'),
  cols: ['date', 'kind', 'warehouse_id', 'project_id', 'item_id', 'stage_id', 'site_id', 'ref_issue_id', 'received_by_id', 'notes'],
  lineCols: ['material_id', 'qty', 'ref_line_id', 'notes'],
  blank: (l) => !l.material_id && !l.ref_line_id,
  async validate(p, lines) {
    if (!['production', 'site', 'overhead', 'return'].includes(p.kind)) throw new AppError('نوع الصرف غير معروف');
    if (p.kind !== 'return') await must('warehouses', p.warehouse_id, 'المخزن');
    if (p.kind === 'return') {
      const ref = await get('SELECT * FROM stock_issues WHERE id=?', p.ref_issue_id);
      if (!ref || ref.kind === 'return' || ref.status === 'void') throw new AppError('اختر إذن الصرف الأصلي للمرتجع');
      Object.assign(p, { project_id: ref.project_id, item_id: ref.item_id, stage_id: ref.stage_id, site_id: ref.site_id, warehouse_id: ref.warehouse_id });
      for (const l of lines) {
        posQty(l);
        const rl = await get('SELECT * FROM stock_issue_lines WHERE id=?', l.ref_line_id);
        if (!rl || rl.issue_id !== ref.id) throw new AppError('بند المرتجع لا يخص إذن الصرف المختار');
        l.material_id = rl.material_id;
        const returned = await val(`SELECT COALESCE(SUM(l.qty),0) FROM stock_issue_lines l JOIN stock_issues i ON i.id=l.issue_id WHERE l.ref_line_id=? AND i.status='posted'`, rl.id);
        if (num(l.qty) > rl.qty - returned + 1e-6) throw new AppError(`كمية المرتجع أكبر من المتاح إرجاعه لبند «${await nm('materials', rl.material_id)}» (${r4(rl.qty - returned)})`);
      }
      return;
    }
    if (p.kind === 'production') {
      if (!p.project_id || !p.item_id || !p.stage_id) throw new AppError('صرف الإنتاج لازم يتحدد له: المشروع والبند والمرحلة');
      p.site_id = null;
    }
    if (p.kind === 'site') {
      if (!p.project_id) throw new AppError('التحويل لموقع لازم يتحدد له المشروع');
      // الموقع مطلوب بس لو المشروع متكود له مواقع (نشطة)؛ ولو مفيش مواقع بيتساب فاضي
      const siteIds = (await all('SELECT id FROM sites WHERE project_id=? AND active=1', p.project_id)).map((x) => Number(x.id));
      if (siteIds.length) {
        if (!p.site_id) throw new AppError('اختر الموقع — المشروع ده متكود له مواقع');
        if (!siteIds.includes(Number(p.site_id))) throw new AppError('الموقع المختار لا يتبع المشروع');
      } else p.site_id = null;
      p.stage_id = null;
    }
    if (p.kind === 'overhead') { p.project_id = null; p.item_id = null; p.site_id = null; }
    if (p.project_id) await must('projects', p.project_id, 'المشروع');
    if (p.item_id) {
      const it = await get('SELECT project_id FROM project_items WHERE id=?', p.item_id);
      if (!it) throw new AppError('البند غير موجود');
      if (it.project_id !== Number(p.project_id)) throw new AppError('البند لا يتبع المشروع المختار');
    }
    if (p.stage_id) await must('stages', p.stage_id, 'المرحلة');
    if (p.site_id) await must('sites', p.site_id, 'الموقع');
    const seen = new Set();
    for (const l of lines) {
      await must('materials', l.material_id, 'الخامة'); posQty(l);
      if (seen.has(Number(l.material_id))) throw new AppError(`الخامة «${await nm('materials', l.material_id)}» مكررة في الإذن`);
      seen.add(Number(l.material_id));
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
      await must('materials', l.material_id, 'الخامة');
      if (!(num(l.counted_qty, -1) >= 0)) throw new AppError('الكمية المجرودة لا يمكن أن تكون سالبة');
      if (seen.has(Number(l.material_id))) throw new AppError('خامة مكررة في الجرد'); seen.add(Number(l.material_id));
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
async function checkDims(project_id, item_id, stage_id, needStage) {
  if (needStage && !stage_id) throw new AppError('العمالة المباشرة لازم يتحدد لها مرحلة التصنيع');
  if (item_id) {
    const it = await get('SELECT project_id FROM project_items WHERE id=?', item_id);
    if (!it) throw new AppError('البند غير موجود');
    if (!project_id || it.project_id !== Number(project_id)) throw new AppError('البند لا يتبع المشروع المختار');
  }
}
DOCS.labor_sheet = {
  table: 'labor_sheets', lines: 'labor_sheet_lines', fk: 'sheet_id', seq: 'labor_sheet',
  cols: ['date', 'notes'], lineCols: ['employee_id', 'days', 'rate', 'amount', 'cost_class', 'project_id', 'item_id', 'stage_id', 'notes'],
  blank: (l) => !l.employee_id,
  async validate(p, lines) {
    for (const l of lines) {
      const e = await get('SELECT * FROM employees WHERE id=?', l.employee_id);
      if (!e) throw new AppError('عامل غير موجود');
      if (!(num(l.days) > 0)) throw new AppError(`عدد الأيام للعامل «${e.name}» لازم يكون أكبر من صفر`);
      l.cost_class = e.cost_class;
      if (l.rate === undefined || l.rate === null || l.rate === '') l.rate = e.daily_rate;
      l.rate = num(l.rate); l.amount = r2(l.days * l.rate);
      if (e.cost_class !== 'direct') { l.stage_id = l.stage_id || null; }
      await checkDims(l.project_id, l.item_id, l.stage_id, e.cost_class === 'direct');
    }
  },
  async post(doc) {
    const out = []; let total = 0;
    for (const l of doc.lines) {
      total += l.amount;
      const dims = { project_id: l.project_id, item_id: l.item_id, stage_id: l.stage_id };
      out.push(dc(await laborAccount(l.cost_class, l.stage_id), l.amount, { ...dims, employee_id: l.employee_id }));
      out.push(cr(await acc('acc_wages_payable'), l.amount, { employee_id: l.employee_id }));
      await insertRow('cost_lines', { date: doc.date, source_type: 'labor', source_id: doc.id, source_line_id: l.id, cost_type: 'labor', cost_class: l.cost_class, ...dims,
        employee_id: l.employee_id, qty: l.days, amount: l.amount, description: doc.no },
      ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'employee_id', 'qty', 'amount', 'description']);
    }
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
//  مسير الرواتب الشهرية (مع توزيع التكلفة على المشروعات/المراحل)
// ============================================================
DOCS.payroll = {
  table: 'payroll_runs', lines: 'payroll_lines', fk: 'run_id', seq: 'payroll',
  cols: ['month', 'date', 'notes'], lineCols: ['employee_id', 'base', 'additions', 'deductions', 'net', 'cost_class', 'notes'],
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
      if (seen.has(Number(l.employee_id))) throw new AppError(`العامل «${e.name}» مكرر في المسير`); seen.add(Number(l.employee_id));
      const dup = await get(`SELECT r.no FROM payroll_lines pl JOIN payroll_runs r ON r.id=pl.run_id WHERE r.month=? AND pl.employee_id=? AND r.status='posted' AND r.id<>?`, p.month, l.employee_id, id || 0);
      if (dup) throw new AppError(`العامل «${e.name}» له راتب عن نفس الشهر في المسير ${dup.no}`);
      l.base = r2(num(l.base, e.monthly_salary)); l.additions = r2(l.additions); l.deductions = r2(l.deductions);
      if (l.base < 0 || l.additions < 0 || l.deductions < 0) throw new AppError('القيم لا يمكن أن تكون سالبة');
      l.net = r2(l.base + l.additions - l.deductions);
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
      const cost = r2(l.base + l.additions);
      gross += cost; ded += l.deductions; net += l.net;
      const allocs = l.cost_class === 'direct' ? (p.lines[i].allocations || []) : [{ project_id: null, item_id: null, stage_id: null, percent: 100 }];
      let used = 0;
      for (const [k, a] of allocs.entries()) {
        const amt = k === allocs.length - 1 ? r2(cost - used) : r2(cost * a.percent / 100); used = r2(used + amt);
        if (l.cost_class === 'direct') await insertRow('payroll_allocations', { line_id: l.id, project_id: a.project_id, item_id: a.item_id, stage_id: a.stage_id, percent: a.percent }, ['line_id', 'project_id', 'item_id', 'stage_id', 'percent']);
        const dims = { project_id: a.project_id, item_id: a.item_id, stage_id: a.stage_id };
        out.push(dc(await laborAccount(l.cost_class, a.stage_id), amt, { ...dims, employee_id: l.employee_id }));
        await insertRow('cost_lines', { date: doc.date, source_type: 'payroll', source_id: doc.id, source_line_id: l.id, cost_type: 'labor', cost_class: l.cost_class, ...dims,
          employee_id: l.employee_id, qty: 1, amount: amt, description: `${doc.no} — ${doc.month}` },
        ['date', 'source_type', 'source_id', 'source_line_id', 'cost_type', 'cost_class', 'project_id', 'item_id', 'stage_id', 'employee_id', 'qty', 'amount', 'description']);
      };
      out.push(cr(await acc('acc_wages_payable'), l.net, { employee_id: l.employee_id }));
    };
    if (ded) out.push(cr(await acc('acc_deductions_payable'), r2(ded)));
    await run('UPDATE payroll_runs SET gross=?, deductions=?, net=? WHERE id=?', r2(gross), r2(ded), r2(net), doc.id);
    await postJournal({ date: doc.date, source_type: 'payroll', source_id: doc.id, description: `مسير رواتب ${doc.month} — ${doc.no}`, lines: out });
  },
  async unpost(cur) {
    if (cur.paid_amount > 0.004) throw new AppError('المسير عليه صرف مرتبات — ألغِ سند الصرف أولاً');
    await deleteJournals('payroll', cur.id);
    await run(`DELETE FROM cost_lines WHERE source_type='payroll' AND source_id=?`, cur.id);
  },
};

// ============================================================
//  سندات الخزينة والعهد
// ============================================================
const VOUCHER_KINDS = {
  supplier_payment: 'سداد مورد', expense: 'مصروف', wage_payment: 'صرف أجور ومرتبات', custody_issue: 'صرف عهدة',
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
DOCS.voucher = {
  table: 'vouchers', lines: null, seq: (p) => `v_${p.kind}`, requireLines: false,
  cols: ['date', 'kind', 'treasury_id', 'custodian_id', 'to_treasury_id', 'supplier_id', 'category_id', 'account_id', 'project_id', 'item_id', 'stage_id', 'amount', 'description', 'ref_no'],
  async enrich(h) {
    h.allocations = await all('SELECT * FROM voucher_allocations WHERE voucher_id=?', h.id);
    h.wage_links = await all('SELECT * FROM voucher_wage_links WHERE voucher_id=?', h.id);
  },
  async validate(p) {
    if (!VOUCHER_KINDS[p.kind]) throw new AppError('نوع السند غير معروف');
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
    if (k === 'supplier_payment') {
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
