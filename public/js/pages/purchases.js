import { h, META, GET, POST, PUT, L, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, codeName, statusBadge, labelOf, toast, guard, modal, can, printSheet, confirmBox } from '../core.js';
import { docScreen, dateF, notesF, total, qtyCol, matChange } from '../docs-ui.js';

const defaultWh = () => (L.warehouses.find((w) => w.type === 'raw' && w.active) || {}).id;
const unitOf = (mid) => nameOf('units', byId('materials', mid)?.unit_id);
const PAY = [['credit', 'آجل (على حساب المورد)'], ['cash', 'نقدي']];
const matCol = { k: 'material_id', l: 'الصنف', t: 'fk', ref: 'materials', req: 1, w: '38%', onChange: matChange };
const unitCol = { l: 'الوحدة', calc: (l) => unitOf(l.material_id), w: '80px' };
// فاتورة الشراء: لما تختار صنف والسعر فاضي، السعر يتملا من آخر سعر شراء للصنف
const fillLastPrice = async (v, l, ctx) => {
  matChange(v, l, ctx);
  if (!v || (Number(l.unit_price) || 0) > 0) return;
  const p = await GET('/helpers/last-price', { material_id: v });
  if (p && l.material_id === v && !(Number(l.unit_price) > 0)) { l.unit_price = Number(p.unit_price); ctx.setLines(ctx.lines); }
};
// إذن الاستلام: لما تختار صنف يظهر جنبه آخر سعر شراء له، ولو مفيش سعر شراء يظهر متوسط التكلفة من كارت الصنف
const hintCol = { l: 'آخر سعر شراء', calc: (l) => (l._hint ? `${fmt(l._hint.price, 3)}${l._hint.source === 'avg' ? ' (متوسط)' : ''}` : ''), w: '130px' };
const loadHints = async (ctx) => {
  await Promise.all(ctx.lines.filter((l) => l.material_id && l._hint === undefined).map(async (l) => {
    const mid = l.material_id; l._hint = null;
    const p = await GET('/helpers/price-hint', { material_id: mid, warehouse_id: ctx.header.warehouse_id });
    if (l.material_id === mid) l._hint = p;
  }));
  ctx.refresh();
};
const pickWithHint = async (v, l, ctx) => { matChange(v, l, ctx); l._hint = undefined; if (v) await loadHints(ctx); };
const supF = { k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true, req: 1 };
const lineTotal = { l: 'الإجمالي', calc: (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0), fmt: (v) => fmt(v), w: '120px' };
const dateStatusCols = [{ k: 'date', l: 'التاريخ' }];
const sup = (r) => r.supplier_name;

// ---------------- طلبات الشراء ----------------
const lineRows = (doc, withPrice) => (doc.lines || []).map((l) => [nameOf('materials', l.material_id), unitOf(l.material_id), fq(l.qty), ...(withPrice ? [fmt(l.unit_price), fmt(l.qty * l.unit_price)] : []), l.notes || '']);
// سلسلة اعتماد طلب الشراء = وظائف المشتريات بترتيبها؛ الطلب بيبدأ من وظيفة منشئه (أو الأولى) وكل وظيفة بعدها خطوة اعتماد فعلي
const reqChain = () => (META.jobs_order?.purchases || []);
const reqState = (r) => { const done = String(r.approvals || '').split('|').filter(Boolean).map((x) => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }); const d = new Set(done.map((x) => x[0])); const ch = reqChain(); const si = Math.max(ch.indexOf(r.start_job), 0); return { done, pending: ch.slice(si + 1).filter((j) => !d.has(j)) }; };
const reqSigned = (doc) => ({ [doc.start_job || reqChain()[0]]: nameOf('employees', doc.requested_by_id) || doc.requested_by || doc.created_by_name || '', ...Object.fromEntries((doc.approvals || []).map((a) => [a.job_name, a.user_name])) });
export const requestsPage = docScreen({ perm: 'purchases.requests',
  print: (doc) => printSheet({ title: 'طلب شراء', no: doc.no, date: doc.date,
    meta: [['مقدم الطلب', nameOf('employees', doc.requested_by_id) || doc.requested_by], ['المورد', nameOf('suppliers', doc.supplier_id)], ['المشروع', nameOf('projects', doc.project_id)], ['مطلوب في', doc.needed_date]],
    cols: ['الصنف', 'الوحدة', 'الكمية المطلوبة', 'ملاحظة'], rows: lineRows(doc, false), notes: doc.notes, module: 'purchases', by: doc.created_by_name, actual: reqSigned(doc), sign: [] }),
  type: 'purchase_request', title: 'طلبات الشراء', noun: 'طلب شراء', newLabel: 'طلب شراء جديد', defaultFrom: monthStart, defaultTo: today, statuses: [['open', 'مفتوح'], ['ordered', 'تم الأمر']],
  filters: [{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true }],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'requested_by', l: 'مقدم الطلب' }, { k: 'supplier_name', l: 'المورد' }, { k: 'project_name', l: 'المشروع' }, { k: 'n_lines', l: 'البنود', num: true }, { k: 'needed_date', l: 'مطلوب في' }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) },
    { k: 'approvals', l: 'الاعتماد', render: (r) => { if (r.status === 'void') return '—'; const st = reqState(r); return st.pending.length ? h('span.muted', `بانتظار ${st.pending[0]}`) : h('span', '✔ معتمد'); } }],
  rowActions: (r, refresh) => { if (r.status === 'void') return []; const st = reqState(r); const mine = (j) => META.me.role === 'admin' || (META.me.my_jobs || []).includes(`purchases:${j}`); const out = [];
    if (st.pending.length && mine(st.pending[0])) out.push(h('button.btn.sm.primary', { onclick: guard(async (ev) => { ev.stopPropagation(); await POST(`/doc/purchase_request/${r.id}/approve`); toast(`تم الاعتماد (${st.pending[0]})`); refresh(); }) }, `اعتماد (${st.pending[0]})`));
    if (st.done.length && r.status === 'open' && mine(st.done[st.done.length - 1][0])) out.push(h('button.btn.sm', { onclick: guard(async (ev) => { ev.stopPropagation(); if (!(await confirmBox(`سحب اعتماد «${st.done[st.done.length - 1][0]}»؟`, 'سحب الاعتماد', true))) return; await POST(`/doc/purchase_request/${r.id}/unapprove`); toast('تم سحب الاعتماد'); refresh(); }) }, 'سحب آخر اعتماد'));
    return out; },
  editor: {
    cols: 3, header: [dateF, { k: 'requested_by_id', l: 'مقدم الطلب', t: 'fk', ref: 'employees', combo: true }, { k: 'supplier_id', l: 'المورد (اختياري)', t: 'fk', ref: 'suppliers', combo: true }, { k: 'project_id', l: 'المشروع (اختياري)', t: 'fk', ref: 'projects', combo: true }, { k: 'needed_date', l: 'مطلوب في تاريخ', t: 'date' }, { ...notesF, wide: false }],
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية المطلوبة', w: '170px' }), unitCol, { l: 'تم أمر توريد بـ', calc: (l) => l.ordered_qty ?? 0, fmt: fq }, { k: 'notes', l: 'ملاحظة', t: 'text' }] },
    totals: (ctx) => [['عدد البنود', String(ctx.lines.filter((l) => l.material_id).length)]],
  },
});

// ---------------- أوامر التوريد ----------------
// إغلاق يدوي للأمر (مثلاً بعد استلام جزئي والباقي مش هيتوّرد): بعد الإغلاق مفيش استلام جديد على الأمر
const closeOrder = (o, done) => guard(async (ev) => {
  ev?.stopPropagation?.();
  const partial = o.status === 'partial';
  if (!(await confirmBox(`إغلاق أمر التوريد ${o.no}؟ ${partial ? 'اللي اتستلم فعلاً هيفضل زي ما هو، وباقي الكمية مش هيتستلم على الأمر ده.' : ''} بعد الإغلاق مش هينفع تسجّل إذن استلام جديد عليه.`, 'إغلاق الأمر'))) return;
  await POST(`/doc/purchase_order/${o.id}/close`); toast('تم إغلاق الأمر'); done();
});
export const ordersPage = docScreen({ perm: 'purchases.orders',
  print: (doc) => printSheet({ title: 'أمر توريد', no: doc.no, date: doc.date,
    meta: [['المورد', nameOf('suppliers', doc.supplier_id)], ['نوع الشراء', doc.payment_type === 'cash' ? 'نقدي' : 'آجل'], ['التسليم المتوقع', doc.expected_date]],
    cols: ['الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي', 'ملاحظة'], rows: lineRows(doc, true), totals: [['إجمالي الأمر', fmt(doc.total)]], notes: doc.notes, module: 'purchases', by: doc.created_by_name, sign: ['مدير المشتريات', 'المورد', 'الاعتماد'] }),
  rowActions: (r, reload) => (can('purchases.orders.close') && ['open', 'partial'].includes(r.status) ? h('button.btn.sm', { title: 'إغلاق الأمر يدوياً', onclick: closeOrder(r, reload) }, 'إغلاق') : null),
  type: 'purchase_order', title: 'أوامر التوريد', noun: 'أمر توريد', newLabel: 'أمر توريد جديد', statuses: [['open', 'مفتوح'], ['partial', 'استلام جزئي'], ['received', 'تم الاستلام'], ['closed', 'مغلق']],
  filters: [{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true }],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'supplier_name', l: 'المورد' }, { k: 'payment_type', l: 'الدفع', text: (r) => labelOf(PAY, r.payment_type).split(' (')[0] }, { k: 'total', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'expected_date', l: 'التسليم المتوقع' }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, rebuildOn: [], defaults: () => ({ payment_type: 'credit' }),
    header: (ctx) => [dateF, { ...supF, lockOnEdit: true }, { k: 'request_id', l: 'طلب الشراء (اختياري)', t: 'select', lockOnEdit: true, options: [['', '— بدون —'], ...(ctx.reqOpts || [])] },
      { k: 'payment_type', l: 'نوع الشراء', t: 'select', options: PAY }, { k: 'expected_date', l: 'تاريخ التسليم المتوقع', t: 'date' }, { ...notesF, wide: false }],
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية', w: '170px' }), unitCol, { k: 'unit_price', l: 'السعر', t: 'number', w: '120px' }, lineTotal, { l: 'تم استلامه', calc: (l) => l.received_qty ?? 0, fmt: fq }] },
    tools: [{ label: 'سحب بنود من طلب الشراء', run: async (ctx) => {
      const id = Number(ctx.header.request_id); if (!id) throw new Error('اختر طلب الشراء أولاً');
      const rows = await GET('/helpers/request-lines', { request_id: id });
      ctx.setLines(rows.map((r) => ({ material_id: r.material_id, qty: r.remaining, unit_price: null, request_line_id: r.id }))); toast('تم سحب المتبقي من الطلب — أدخل الأسعار');
    } }],
    totals: (ctx) => [['إجمالي الأمر', fmt(total(ctx.lines, (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)))]],
    onOpen: async (ctx) => { const r = await GET('/helpers/open-requests'); ctx.reqOpts = r.map((x) => [String(x.id), `${x.no} — ${x.date}`]); if (ctx.doc?.request_id && !r.find((x) => x.id === ctx.doc.request_id)) ctx.reqOpts.push([String(ctx.doc.request_id), `#${ctx.doc.request_id}`]); ctx.rebuildHeader(); },
    prepare: (p) => { p.request_id = p.request_id ? Number(p.request_id) : null; },
    buttons: (ctx) => (ctx.doc && can('purchases.orders.close') && ['open', 'partial', 'received'].includes(ctx.doc.status) ? [h('button.btn', { onclick: closeOrder(ctx.doc, () => location.reload()) }, 'إغلاق الأمر')] : []),
  },
});

// ---------------- إذن الاستلام ----------------
export const receiptsPage = docScreen({ perm: 'purchases.receipts',
  print: (doc) => printSheet({ title: 'إذن استلام', no: doc.no, date: doc.date,
    meta: [['المورد', nameOf('suppliers', doc.supplier_id)], ['المخزن', nameOf('warehouses', doc.warehouse_id)], ['مرجع المورد', doc.supplier_ref], ['نوع الشراء', doc.payment_type === 'cash' ? 'نقدي' : 'آجل'], doc.payment_type === 'cash' ? ['الدفع من', nameOf('treasuries', doc.treasury_id) || nameOf('custodians', doc.custodian_id)] : null].filter(Boolean),
    cols: ['الصنف', 'الوحدة', 'الكمية المستلمة', 'السعر', 'الإجمالي', 'ملاحظة'], rows: lineRows(doc, true), totals: [['إجمالي قيمة الاستلام', fmt((doc.lines || []).reduce((s, l) => s + l.qty * l.unit_price, 0))]], notes: doc.notes, module: 'purchases', by: doc.created_by_name, sign: ['أمين المخزن', 'المورد / المندوب', 'مدير المشتريات'] }),
  print2: { label: '🖨 طباعة كميات (بدون أسعار)', short: '🖨 كميات', title: 'طباعة الإذن كميات فقط بدون أسعار',
    fn: (doc) => printSheet({ title: 'إذن استلام (كميات)', no: doc.no, date: doc.date,
      meta: [['المورد', nameOf('suppliers', doc.supplier_id)], ['المخزن', nameOf('warehouses', doc.warehouse_id)], ['مرجع المورد', doc.supplier_ref]],
      cols: ['الصنف', 'الوحدة', 'الكمية المستلمة', 'ملاحظة'], rows: lineRows(doc, false), notes: doc.notes, module: 'purchases', by: doc.created_by_name, sign: ['أمين المخزن', 'المورد / المندوب', 'مدير المشتريات'] }) },
  type: 'goods_receipt', title: 'إذون الاستلام', noun: 'إذن استلام', newLabel: 'إذن استلام جديد',
  note: 'الاستلام بيدخّل الصنف للمخزن فوراً بسعر أمر التوريد، وبيسجّل القيد دائن مباشرة على المورد (آجل) أو على الخزينة/العهدة (نقدي). فاتورة المورد بعد كده بتسجّل الفروق والضريبة والخصم بس.',
  filters: [{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true }],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'supplier_name', l: 'المورد' }, { k: 'warehouse_name', l: 'المخزن' }, { k: 'supplier_ref', l: 'مرجع المورد' }, { k: 'payment_type', l: 'الدفع', render: (r) => (r.payment_type === 'cash' ? badge('نقدي', 'info') : badge('آجل', 'warn')) },
    { k: 'total', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, rebuildOn: ['payment_type'], defaults: () => ({ warehouse_id: defaultWh(), payment_type: 'credit' }),
    header: (ctx) => { const cash = ctx.header.payment_type === 'cash'; return [dateF, { ...supF, lockOnEdit: true, onChange: async (v, c) => { c.setHeader('order_id', null); await loadOrders(c); } },
      { k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, filter: (x) => x.type === 'raw' },
      { k: 'order_id', l: 'أمر التوريد (اختياري)', t: 'select', lockOnEdit: true, options: [['', '— استلام بدون أمر —'], ...(ctx.ordOpts || [])] },
      { k: 'payment_type', l: 'نوع الشراء', t: 'select', options: PAY, req: 1 },
      cash && { k: 'treasury_id', l: 'الدفع من خزينة/بنك', t: 'fk', ref: 'treasuries', help: 'اختر خزينة أو عهدة (واحد فقط)', onChange: (v, c) => { if (v) c.setHeader('custodian_id', null); } },
      cash && { k: 'custodian_id', l: 'أو الدفع من عهدة', t: 'fk', ref: 'custodians', onChange: (v, c) => { if (v) c.setHeader('treasury_id', null); } },
      { k: 'supplier_ref', l: 'رقم إذن/فاتورة المورد', t: 'text' }, { ...notesF, wide: false }].filter(Boolean); },
    lines: { blank: () => ({}), cols: [{ ...matCol, onChange: pickWithHint }, qtyCol({ l: 'الكمية المستلمة', w: '170px' }), unitCol, hintCol, { k: 'unit_price', l: 'السعر', t: 'number', w: '120px' }, lineTotal] },
    tools: [{ label: 'سحب المتبقي من أمر التوريد', run: async (ctx) => {
      const id = Number(ctx.header.order_id); if (!id) throw new Error('اختر أمر التوريد أولاً');
      const rows = await GET('/helpers/order-lines', { order_id: id });
      ctx.setLines(rows.map((r) => ({ material_id: r.material_id, qty: r.remaining, unit_price: r.unit_price, order_line_id: r.id }))); toast('تم سحب المتبقي من الأمر — عدّل الكميات المستلمة فعلاً'); await loadHints(ctx);
    } }],
    totals: (ctx) => [['قيمة الاستلام', fmt(total(ctx.lines, (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)))]],
    onOpen: async (ctx) => { await loadOrders(ctx); if (!ctx.doc) await loadHints(ctx); },
    prepare: (p) => { p.order_id = p.order_id ? Number(p.order_id) : null; if (p.payment_type !== 'cash') { p.treasury_id = null; p.custodian_id = null; } },
  },
});
async function loadOrders(ctx) {
  const s = ctx.header.supplier_id; const r = s ? await GET('/helpers/open-orders', { supplier_id: s }) : [];
  ctx.ordOpts = r.map((x) => [String(x.id), `${x.no} — ${x.date}`]);
  if (ctx.doc?.order_id && !r.find((x) => x.id === ctx.doc.order_id)) ctx.ordOpts.push([String(ctx.doc.order_id), `#${ctx.doc.order_id}`]);
  ctx.header.order_id = ctx.header.order_id ? String(ctx.header.order_id) : ''; ctx.rebuildHeader();
}

// ---------------- فاتورة الشراء ----------------
const invCalc = (ctx) => {
  const sub = total(ctx.lines, (l) => Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * 100) / 100);
  const d = Number(ctx.header.discount) || 0, f = Number(ctx.header.freight) || 0, vat = (sub - d) * (Number(ctx.header.vat_percent) || 0) / 100;
  return { sub, d, f, vat, tot: sub - d + f + vat };
};
export const invoicesPage = docScreen({ perm: 'purchases.invoices',
  print: (doc) => printSheet({ title: 'فاتورة شراء', no: doc.no, date: doc.date,
    meta: [['المورد', nameOf('suppliers', doc.supplier_id)], ['المخزن', nameOf('warehouses', doc.warehouse_id)], ['فاتورة المورد', doc.supplier_inv_no], ['نوع الشراء', doc.payment_type === 'cash' ? 'نقدي' : 'آجل'], doc.payment_type === 'cash' ? ['الدفع من', nameOf('treasuries', doc.treasury_id) || nameOf('custodians', doc.custodian_id)] : null, ['الاستحقاق', doc.payment_type === 'cash' ? '' : doc.due_date]].filter(Boolean),
    cols: ['الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي', 'ملاحظة'], rows: lineRows(doc, true),
    totals: [['الإجمالي قبل الخصم', fmt(doc.subtotal)], Number(doc.discount) ? ['الخصم', fmt(doc.discount)] : null, Number(doc.freight) ? ['نقل وتحميل', fmt(doc.freight)] : null, Number(doc.vat_amount) ? ['الضريبة', fmt(doc.vat_amount)] : null, ['إجمالي الفاتورة', fmt(doc.total)]].filter(Boolean),
    notes: doc.notes, module: 'purchases', by: doc.created_by_name, sign: ['أمين المخزن', 'مدير المشتريات', 'المحاسب'] }),
  type: 'purchase_invoice', title: 'فواتير الشراء', noun: 'فاتورة شراء', newLabel: 'فاتورة شراء جديدة',
  note: 'تقدر تسجّل فاتورة مشتريات مباشرة من هنا بدون طلب شراء ولا أمر ولا إذن استلام — الأصناف بتدخل المخزن بتكلفة الفاتورة (بدون الضريبة). الفاتورة آجلة (على حساب المورد) أو نقدية (من خزينة أو عهدة). والخصم ومصاريف النقل بتتوزّع على تكلفة الأصناف تلقائياً.',
  filters: [{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true }],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'supplier_name', l: 'المورد' }, { k: 'supplier_inv_no', l: 'فاتورة المورد' }, { k: 'payment_type', l: 'الدفع', render: (r) => (r.payment_type === 'cash' ? badge('نقدي', 'info') : badge('آجل', 'warn')) },
    { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }, { k: 'open_amount', l: 'المتبقي', num: true, fmt: (v, r) => (r.payment_type === 'cash' || r.status === 'void' ? '' : fmt(v)) }, { k: 'due_date', l: 'الاستحقاق' }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'open_amount' ? fmt(total(rows.filter((r) => r.status !== 'void' && r.payment_type === 'credit'), (r) => r.open_amount)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    cols: 3, rebuildOn: ['payment_type'], defaults: () => ({ warehouse_id: defaultWh(), payment_type: 'credit', discount: 0, freight: 0, vat_percent: 0 }),
    header: (ctx) => {
      const cash = ctx.header.payment_type === 'cash';
      return [dateF, { ...supF, lockOnEdit: true }, { k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, filter: (x) => x.type === 'raw' },
        { k: 'supplier_inv_no', l: 'رقم فاتورة المورد', t: 'text' }, { k: 'payment_type', l: 'نوع الشراء', t: 'select', options: PAY, req: 1 },
        cash ? { k: 'treasury_id', l: 'الدفع من خزينة/بنك', t: 'fk', ref: 'treasuries', help: 'اختر خزينة أو عهدة (واحد فقط)', onChange: (v, c) => { if (v) c.setHeader('custodian_id', null); } } : { k: 'due_date', l: 'تاريخ الاستحقاق', t: 'date', help: 'فارغ = تاريخ الفاتورة' },
        cash && { k: 'custodian_id', l: 'أو الدفع من عهدة', t: 'fk', ref: 'custodians', onChange: (v, c) => { if (v) c.setHeader('treasury_id', null); } },
        { k: 'discount', l: 'خصم (مبلغ)', t: 'number' }, { k: 'freight', l: 'مصاريف نقل وتحميل (تُضاف للتكلفة)', t: 'number' }, { k: 'vat_percent', l: 'ضريبة القيمة المضافة %', t: 'number' }, { ...notesF }].filter(Boolean);
    },
    lines: { blank: () => ({}), cols: [{ ...matCol, onChange: fillLastPrice }, qtyCol({ l: 'الكمية', w: '170px' }), unitCol, { k: 'unit_price', l: 'السعر', t: 'number', w: '120px' }, lineTotal] },
    totals: (ctx) => { const c = invCalc(ctx); const out = [['الإجمالي قبل الخصم', fmt(c.sub)]]; if (c.d) out.push(['الخصم', fmt(c.d)]); if (c.f) out.push(['نقل وتحميل', fmt(c.f)]); if (c.vat) out.push(['الضريبة', fmt(c.vat)]);
      out.push(['إجمالي الفاتورة', fmt(c.tot)]); if (ctx.doc && ctx.doc.payment_type === 'credit') out.push(['المتبقي على المورد', fmt(ctx.doc.open_amount), 'warn']); return out; },
    prepare: (p) => { if (p.payment_type === 'credit') { p.treasury_id = null; p.custodian_id = null; } },
  },
});

// ---------------- مرتجعات المشتريات ----------------
export const preturnsPage = docScreen({ perm: 'purchases.returns',
  print: (doc) => printSheet({ title: 'مرتجع مشتريات', no: doc.no, date: doc.date,
    meta: [['المورد', nameOf('suppliers', doc.supplier_id)], ['المخزن', nameOf('warehouses', doc.warehouse_id)]],
    cols: ['الصنف', 'الوحدة', 'الكمية', 'سعر الإرجاع', 'الإجمالي', 'ملاحظة'], rows: lineRows(doc, true), totals: [['قيمة المرتجع', fmt(doc.total)]], notes: doc.notes, module: 'purchases', by: doc.created_by_name, sign: ['أمين المخزن', 'المورد / المندوب', 'مدير المشتريات'] }),
  type: 'purchase_return', title: 'مرتجعات المشتريات', noun: 'مرتجع مشتريات', newLabel: 'مرتجع مشتريات جديد',
  note: 'المرتجع بيخرج من المخزن بالسعر اللي تحدده (سعر الفاتورة الأصلية عادةً) وبيخصم من حساب المورد.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'supplier_name', l: 'المورد' }, { k: 'total', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ warehouse_id: defaultWh() }), header: [dateF, { ...supF, lockOnEdit: true }, { k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, filter: (x) => x.type === 'raw' }, { ...notesF }],
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية', w: '170px' }), unitCol, { k: 'unit_price', l: 'سعر الإرجاع', t: 'number', w: '130px' }, lineTotal] },
    totals: (ctx) => [['قيمة المرتجع', fmt(total(ctx.lines, (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)))]],
  },
});

// ---------------- كشف حساب مورد / أرصدة الموردين ----------------
export async function supplierStatementPage(root, params) {
  const host = h('div');
  const run = async (v) => {
    if (!v.supplier_id) { host.replaceChildren(h('div.empty-state', 'اختر المورد')); return; }
    const r = await GET('/reports/supplier-statement', v);
    host.replaceChildren(h('div.kpis', kpi('رصيد أول المدة', fmt(r.opening)), kpi('الرصيد الحالي (مستحق للمورد)', fmt(r.closing), r.closing > 0 ? 'علينا' : r.closing < 0 ? 'له عندنا' : 'مسدد', r.closing > 0 ? 'warn' : '')),
      table({ name: 'كشف-مورد', compact: true, rows: [{ date: v.from || '', description: 'رصيد أول المدة', balance: r.opening, _o: 1 }, ...r.rows], rowClass: (x) => (x._o ? 'low' : ''),
        cols: [{ k: 'date', l: 'التاريخ' }, { k: 'no', l: 'القيد' }, { k: 'description', l: 'البيان' }, { k: 'debit', l: 'مدين (سداد/مرتجع)', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'credit', l: 'دائن (مشتريات)', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'balance', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
  };
  const fb = filterBar([{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true, req: 1 }, { k: 'from', l: 'من تاريخ', t: 'date' }, { k: 'to', l: 'إلى تاريخ', t: 'date' }], run, { supplier_id: params.supplier_id ? Number(params.supplier_id) : null });
  root.replaceChildren(pageHead('كشف حساب مورد', h('a.btn', { href: '#/purchases/supplier-balances' }, 'أرصدة الموردين')), fb, host); fb.run();
}
export async function supplierBalancesPage(root) {
  const host = h('div');
  const run = async (v) => {
    const r = await GET('/reports/supplier-balances', v);
    host.replaceChildren(h('div.kpis', kpi('إجمالي المستحق للموردين', fmt(r.total), `${r.rows.length} مورد`, 'warn'), kpi('متأخر السداد', fmt(r.rows.reduce((s, x) => s + x.aging.d30 + x.aging.d60 + x.aging.d90, 0)), 'فواتير تعدّى استحقاقها', 'bad')),
      table({ name: 'أرصدة-الموردين', rows: r.rows, onRow: (x) => { location.hash = `#/purchases/supplier-statement?supplier_id=${x.id}`; },
        cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'المورد', render: (x) => h('b', x.name) }, { k: 'balance', l: 'الرصيد المستحق', num: true, fmt: (n) => fmt(n) },
          { k: 'a0', l: 'غير مستحق', num: true, text: (x) => fmt(x.aging.current) }, { k: 'a1', l: 'متأخر 1–30', num: true, text: (x) => fmt(x.aging.d30) }, { k: 'a2', l: '31–60', num: true, text: (x) => fmt(x.aging.d60) }, { k: 'a3', l: 'أكثر من 60', num: true, text: (x) => fmt(x.aging.d90) }],
        foot: (c) => (c.k === 'balance' ? fmt(r.total) : c.k === 'name' ? 'الإجمالي' : '') }));
  };
  const fb = filterBar([{ k: 'as_of', l: 'الأرصدة حتى تاريخ', t: 'date' }, { k: 'all', l: 'عرض', t: 'select', options: [['0', 'أصحاب الأرصدة فقط'], ['1', 'كل الموردين']] }], run, { all: '0' });
  root.replaceChildren(pageHead('أرصدة الموردين'), fb, host); fb.run();
}
