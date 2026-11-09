import { h, GET, POST, PUT, L, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, codeName, statusBadge, labelOf, toast, guard, modal } from '../core.js';
import { docScreen, dateF, notesF, total, qtyCol, matChange } from '../docs-ui.js';

const defaultWh = () => (L.warehouses.find((w) => w.type === 'raw' && w.active) || {}).id;
const unitOf = (mid) => nameOf('units', byId('materials', mid)?.unit_id);
const PAY = [['credit', 'آجل (على حساب المورد)'], ['cash', 'نقدي']];
const matCol = { k: 'material_id', l: 'الخامة', t: 'fk', ref: 'materials', req: 1, w: '38%', onChange: matChange };
const unitCol = { l: 'الوحدة', calc: (l) => unitOf(l.material_id), w: '80px' };
const supF = { k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true, req: 1 };
const lineTotal = { l: 'الإجمالي', calc: (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0), fmt: (v) => fmt(v), w: '120px' };
const dateStatusCols = [{ k: 'date', l: 'التاريخ' }];
const sup = (r) => r.supplier_name;

// ---------------- طلبات الشراء ----------------
export const requestsPage = docScreen({
  type: 'purchase_request', title: 'طلبات الشراء', noun: 'طلب شراء', newLabel: 'طلب شراء جديد', statuses: [['open', 'مفتوح'], ['ordered', 'تم الأمر']],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'requested_by', l: 'مقدم الطلب' }, { k: 'project_name', l: 'المشروع' }, { k: 'n_lines', l: 'البنود', num: true }, { k: 'needed_date', l: 'مطلوب في' }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, header: [dateF, { k: 'requested_by_id', l: 'مقدم الطلب', t: 'fk', ref: 'employees', combo: true }, { k: 'project_id', l: 'المشروع (اختياري)', t: 'fk', ref: 'projects', combo: true }, { k: 'needed_date', l: 'مطلوب في تاريخ', t: 'date' }, { ...notesF, wide: false }],
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية المطلوبة', w: '170px' }), unitCol, { l: 'تم أمر شراء بـ', calc: (l) => l.ordered_qty ?? 0, fmt: fq }, { k: 'notes', l: 'ملاحظة', t: 'text' }] },
    totals: (ctx) => [['عدد البنود', String(ctx.lines.filter((l) => l.material_id).length)]],
  },
});

// ---------------- أوامر الشراء ----------------
export const ordersPage = docScreen({
  type: 'purchase_order', title: 'أوامر الشراء', noun: 'أمر شراء', newLabel: 'أمر شراء جديد', statuses: [['open', 'مفتوح'], ['partial', 'استلام جزئي'], ['received', 'تم الاستلام'], ['closed', 'مغلق']],
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
    buttons: (ctx) => (ctx.doc && ['open', 'partial', 'received'].includes(ctx.doc.status) ? [h('button.btn', { onclick: guard(async () => { await POST(`/doc/purchase_order/${ctx.doc.id}/close`); toast('تم إغلاق الأمر'); location.reload(); }) }, 'إغلاق الأمر')] : []),
  },
});

// ---------------- إذن الاستلام ----------------
export const receiptsPage = docScreen({
  type: 'goods_receipt', title: 'إذون الاستلام', noun: 'إذن استلام', newLabel: 'إذن استلام جديد',
  note: 'الاستلام بيدخّل الخامة للمخزن فوراً بسعر أمر الشراء ويسجّل «استلامات غير مفوترة» لحد ما تيجي فاتورة المورد وتتطابق معاه.',
  filters: [{ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true }],
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'supplier_name', l: 'المورد' }, { k: 'warehouse_name', l: 'المخزن' }, { k: 'supplier_ref', l: 'مرجع المورد' },
    { k: 'total', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'uninvoiced_qty', l: 'غير مفوتر', render: (r) => (r.status === 'void' ? '' : r.uninvoiced_qty > 0.000001 ? badge('غير مفوتر', 'warn') : badge('مفوتر', 'ok')) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ warehouse_id: defaultWh() }),
    header: (ctx) => [dateF, { ...supF, lockOnEdit: true, onChange: async (v, c) => { c.setHeader('order_id', null); await loadOrders(c); } },
      { k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, filter: (x) => x.type === 'raw' },
      { k: 'order_id', l: 'أمر الشراء (اختياري)', t: 'select', lockOnEdit: true, options: [['', '— استلام بدون أمر —'], ...(ctx.ordOpts || [])] },
      { k: 'supplier_ref', l: 'رقم إذن/فاتورة المورد', t: 'text' }, { ...notesF, wide: false }],
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية المستلمة', w: '170px' }), unitCol, { k: 'unit_price', l: 'السعر', t: 'number', w: '120px' }, lineTotal, { l: 'تم تفويته', calc: (l) => l.invoiced_qty ?? 0, fmt: fq }] },
    tools: [{ label: 'سحب المتبقي من أمر الشراء', run: async (ctx) => {
      const id = Number(ctx.header.order_id); if (!id) throw new Error('اختر أمر الشراء أولاً');
      const rows = await GET('/helpers/order-lines', { order_id: id });
      ctx.setLines(rows.map((r) => ({ material_id: r.material_id, qty: r.remaining, unit_price: r.unit_price, order_line_id: r.id }))); toast('تم سحب المتبقي من الأمر — عدّل الكميات المستلمة فعلاً');
    } }],
    totals: (ctx) => [['قيمة الاستلام', fmt(total(ctx.lines, (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)))]],
    onOpen: (ctx) => loadOrders(ctx),
    prepare: (p) => { p.order_id = p.order_id ? Number(p.order_id) : null; },
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
export const invoicesPage = docScreen({
  type: 'purchase_invoice', title: 'فواتير الشراء', noun: 'فاتورة شراء', newLabel: 'فاتورة شراء جديدة',
  note: 'فاتورة آجلة (على حساب المورد) أو نقدية (من خزينة أو عهدة). تقدر تطابقها مع إذن استلام سابق، والخصم ومصاريف النقل بتتوزّع على تكلفة الخامات تلقائياً.',
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
    lines: { blank: () => ({}), cols: [matCol, qtyCol({ l: 'الكمية', w: '170px' }), unitCol, { k: 'unit_price', l: 'السعر', t: 'number', w: '120px' }, lineTotal, { l: 'مطابقة استلام', calc: (l) => (l.grn_line_id ? (l._grn_no || 'مطابق ✓') : 'مباشر') }] },
    tools: [{ label: 'سحب من استلامات غير مفوترة', run: async (ctx) => {
      const s = ctx.header.supplier_id; if (!s) throw new Error('اختر المورد أولاً');
      const rows = await GET('/helpers/uninvoiced-grn-lines', { supplier_id: s });
      if (!rows.length) throw new Error('لا توجد استلامات غير مفوترة لهذا المورد');
      const chk = rows.map((r) => ({ r, c: h('input', { type: 'checkbox' }) }));
      modal({ title: 'اختر بنود الاستلام المراد تفويتها', wide: true, body: h('div.tbl-wrap', h('table.tbl.compact', h('thead', h('tr', ['', 'إذن الاستلام', 'التاريخ', 'الخامة', 'غير المفوتر', 'سعر الاستلام'].map((x) => h('th', x)))),
        h('tbody', chk.map(({ r, c }) => h('tr', h('td', c), h('td', r.receipt_no), h('td', r.date), h('td', r.material_name), h('td.num', fq(r.remaining)), h('td.num', fmt(r.unit_price)))))))
      , buttons: [{ label: 'إضافة للفاتورة', cls: 'primary', onClick: () => {
        const add = chk.filter((x) => x.c.checked).map(({ r }) => ({ material_id: r.material_id, qty: r.remaining, unit_price: r.unit_price, grn_line_id: r.id, _grn_no: r.receipt_no }));
        const base = ctx.lines.filter((l) => l.material_id); ctx.setLines([...base, ...add]); toast('أدخل أسعار الفاتورة الفعلية لو اختلفت عن الاستلام'); } }] });
    } }],
    totals: (ctx) => { const c = invCalc(ctx); const out = [['الإجمالي قبل الخصم', fmt(c.sub)]]; if (c.d) out.push(['الخصم', fmt(c.d)]); if (c.f) out.push(['نقل وتحميل', fmt(c.f)]); if (c.vat) out.push(['الضريبة', fmt(c.vat)]);
      out.push(['إجمالي الفاتورة', fmt(c.tot)]); if (ctx.doc && ctx.doc.payment_type === 'credit') out.push(['المتبقي على المورد', fmt(ctx.doc.open_amount), 'warn']); return out; },
    prepare: (p) => { if (p.payment_type === 'credit') { p.treasury_id = null; p.custodian_id = null; } },
  },
});

// ---------------- مرتجعات المشتريات ----------------
export const preturnsPage = docScreen({
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
