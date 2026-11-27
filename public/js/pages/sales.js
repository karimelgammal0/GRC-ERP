// ============================================================
//  المرحلة 3: الإنتاج التام ← التسليم للعميل ← المستخلص
// ============================================================
import { h, GET, L, fmt, fq, table, filterBar, pageHead, kpi, nameOf, byId, statusBadge, printSheet, META } from '../core.js';
import { docScreen, dateF, notesF, total } from '../docs-ui.js';

const itemOf = (id) => byId('project_items', id);
const unitOfItem = (id) => nameOf('units', itemOf(id)?.unit_id);
const prjF = { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true, req: 1, lockOnEdit: true };
const itemsOfPrj = (ctx) => (x) => x.active !== 0 && Number(x.project_id) === Number(ctx.header.project_id);
const sitesOf = (projectId) => (L.sites || []).filter((x) => x.active !== 0 && projectId && Number(x.project_id) === Number(projectId));
const pct = () => Number(META.settings?.profit_pct) || 0;

// ---------------- سجل الإنتاج التام (كميات فقط) ----------------
export const productionLogPage = docScreen({ perm: 'production.log', type: 'production_log', title: 'سجل الإنتاج التام', noun: 'سجل إنتاج', newLabel: 'تسجيل إنتاج جديد', nextNoKey: 'production_log',
  note: 'سجّل هنا كميات المنتج التام اللي خلصت في اليوم. القيمة مش بتتحدد هنا — بتتحدد في آخر الشهر من «تكاليف مشروعات» (سعر المتر + قوالب + مباشر + غير مباشر) وبعدها بيدخل مخزن المنتجات التامة.',
  filters: [{ k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }],
  print: (doc) => printSheet({ title: 'سجل إنتاج تام', no: doc.no, date: doc.date, meta: [['المشروع', doc.project_name]],
    cols: ['البند', 'الوحدة', 'الكمية', 'م² للقطعة', 'الأمتار'], rows: doc.lines.map((l) => [nameOf('project_items', l.item_id), unitOfItem(l.item_id), fq(l.qty), fq(l.area_m2), fq(Number(l.qty) * Number(l.area_m2))]),
    totals: [['إجمالي الأمتار', fq(total(doc.lines, (l) => l.qty * l.area_m2))]], notes: doc.notes, module: 'production', by: doc.created_by_name, sign: ['مسؤول الإنتاج', 'مراقب الجودة', 'مدير المصنع'] }),
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'project_name', l: 'المشروع' }, { k: 'n_lines', l: 'عدد البنود', num: true },
    { k: 'qty', l: 'إجمالي القطع', num: true, fmt: (v) => fq(v) }, { k: 'meters', l: 'الأمتار', num: true, fmt: (v) => fq(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, header: [dateF, prjF, { ...notesF }],
    onHeader: (k, v, ctx) => { if (k === 'project_id') ctx.setLines([{}]); },
    lines: { blank: () => ({}), cols: [
      { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', req: 1, combo: true, w: '40%', filter: (x, l, ctx) => itemsOfPrj(ctx)(x), onChange: (v, l, ctx) => ctx.setLines(ctx.lines) },
      { l: 'الوحدة', calc: (l) => unitOfItem(l.item_id), w: '80px' },
      { k: 'qty', l: 'الكمية (قطعة)', t: 'number', w: '130px' },
      { l: 'م² للقطعة', calc: (l) => (itemOf(l.item_id)?.area_m2 ? fq(itemOf(l.item_id).area_m2) : '⚠ حدّد المتر في بنود المشروعات'), w: '150px' },
      { l: 'الأمتار', calc: (l) => Number(l.qty || 0) * Number(itemOf(l.item_id)?.area_m2 || 0), fmt: (v) => fq(v), w: '110px' }] },
    totals: (ctx) => [['إجمالي القطع', fq(total(ctx.lines, (l) => l.qty))], ['إجمالي الأمتار', fq(total(ctx.lines, (l) => Number(l.qty || 0) * Number(itemOf(l.item_id)?.area_m2 || 0)))]],
  },
});

// ---------------- إذن تسليم للعميل ----------------
const loadAvail = async (ctx) => {
  const p = ctx.header.project_id; if (!p) { ctx.st.av = {}; ctx.setLines(ctx.lines); return; }
  const rows = await GET('/p3/availability', { project_id: p, date: ctx.header.date || '' });
  ctx.st.av = Object.fromEntries(rows.map((r) => [r.item_id, r])); ctx.setLines(ctx.lines);
};
export const deliveriesPage = docScreen({ perm: 'sales.deliveries', type: 'delivery_note', title: 'إذونات التسليم للعملاء', noun: 'إذن تسليم', newLabel: 'إذن تسليم جديد', nextNoKey: 'delivery_note',
  note: 'إذن التسليم بيخرّج المنتج من مخزن المنتجات التامة وبيسجّل الكمية اللي استلمها العميل بس. السعر والقيمة بيتحسبوا في «مستخلصات العملاء». تقدر تعمل أكتر من إذن لنفس المشروع في اليوم.',
  filters: [{ k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'client_id', l: 'العميل', t: 'fk', ref: 'clients', combo: true }],
  print: (doc) => printSheet({ title: 'إذن تسليم', no: doc.no, date: doc.date, meta: [['العميل', doc.client_name], ['المشروع', doc.project_name], ...(doc.site_id ? [['الموقع', nameOf('sites', doc.site_id)]] : []), ...(doc.vehicle_no ? [['رقم السيارة', doc.vehicle_no]] : []), ...(doc.driver_name ? [['السائق', doc.driver_name]] : [])],
    cols: doc.lines.some((l) => l.notes) ? ['البند', 'الوحدة', 'الكمية', 'ملاحظات'] : ['البند', 'الوحدة', 'الكمية'],
    rows: doc.lines.map((l) => [nameOf('project_items', l.item_id), unitOfItem(l.item_id), fq(l.qty), ...(doc.lines.some((x) => x.notes) ? [l.notes || ''] : [])]),
    totals: [['إجمالي القطع', fq(total(doc.lines, (l) => l.qty))]], notes: doc.notes, module: 'sales', by: doc.created_by_name, sign: ['أمين المخزن', 'المستلم (العميل)', 'مدير المبيعات'] }),
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'client_name', l: 'العميل' }, { k: 'project_name', l: 'المشروع' }, { k: 'site_name', l: 'الموقع' },
    { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, rebuildOn: ['project_id'],
    header: (ctx) => [dateF, prjF, sitesOf(ctx.header.project_id).length > 0 && { k: 'site_id', l: 'الموقع', t: 'fk', ref: 'sites', combo: true, req: 1, filter: (x) => Number(x.project_id) === Number(ctx.header.project_id) },
      { k: 'vehicle_no', l: 'رقم السيارة', t: 'text' }, { k: 'driver_name', l: 'اسم السائق', t: 'text' }, { ...notesF }].filter(Boolean),
    onHeader: (k, v, ctx) => { if (k === 'project_id') { ctx.header.client_id = byId('projects', v)?.client_id || null; const ss = sitesOf(v); ctx.header.site_id = ss.length === 1 ? ss[0].id : null; ctx.setLines([{}]); } if (k === 'project_id' || k === 'date') loadAvail(ctx); },
    afterOpen: loadAvail,
    lines: { blank: () => ({}), cols: [
      { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', req: 1, combo: true, w: '36%', filter: (x, l, ctx) => itemsOfPrj(ctx)(x) && (!ctx.st.av || ctx.st.av[x.id]), onChange: (v, l, ctx) => ctx.setLines(ctx.lines) },
      { l: 'الوحدة', calc: (l) => unitOfItem(l.item_id), w: '80px' },
      { k: 'qty', l: 'الكمية', t: 'number', w: '120px' },
      { l: 'المتاح بالمخزن', calc: (l, ctx) => (l.item_id && ctx.st.av?.[l.item_id] ? fq(ctx.st.av[l.item_id].qty) : ''), w: '120px' },
      { k: 'notes', l: 'ملاحظات', t: 'text', w: '24%' }] },
    totals: (ctx) => [['إجمالي القطع', fq(total(ctx.lines, (l) => l.qty)), 'big']],
  },
});

// ---------------- مستخلص العميل ----------------
const adjAmount = (a, gross) => (a.method === 'percent' ? gross * Number(a.rate || 0) / 100 : Number(a.rate || 0));
const certNums = (ctx) => {
  const gross = total(ctx.lines, (l) => l.amount); const adj = (ctx.header.adjustments || []).map((a) => ({ ...a, amount: adjAmount(a, gross) }));
  const ded = total(adj.filter((a) => a.kind === 'deduction'), (a) => a.amount), add = total(adj.filter((a) => a.kind === 'addition'), (a) => a.amount);
  return { gross, adj, ded, add, net: gross - ded + add };
};
const adjEditor = (ctx) => {
  const readonly = ctx.doc?.status === 'void'; const cur = ctx.header.adjustments ||= [];
  const types = (L.deduction_types || []).filter((t) => t.active !== 0);
  if (!types.length) return h('div.note', 'مفيش خصومات أو إضافات متكوّدة — كوّدها من الإعدادات ← الخصومات والإضافات.');
  const n = certNums(ctx); const gross = n.gross;
  return h('table.lines', h('thead', h('tr', ['', 'البند', 'النوع', 'الطريقة', 'القيمة', 'المبلغ'].map((t) => h('th', t)))),
    h('tbody', types.map((t) => {
      const a = cur.find((x) => Number(x.type_id) === t.id);
      const box = h('input', { type: 'checkbox', checked: !!a, disabled: readonly, onchange: () => { if (box.checked) cur.push({ type_id: t.id, name: t.name, kind: t.kind, method: t.method, rate: Number(t.value) || 0 }); else cur.splice(cur.indexOf(cur.find((x) => Number(x.type_id) === t.id)), 1); ctx.refresh(); ctx.redrawExtra(); } });
      const rate = h('input', { type: 'number', step: 'any', value: a ? a.rate : t.value, disabled: readonly || !a, onchange: () => { a.rate = Number(rate.value) || 0; ctx.refresh(); ctx.redrawExtra(); } });
      return h('tr', h('td', box), h('td', h('b', t.name)), h('td', t.kind === 'deduction' ? 'خصم' : 'إضافة'), h('td', t.method === 'percent' ? '% من الإجمالي' : 'مبلغ ثابت'), h('td', rate), h('td.ro', a ? fmt(adjAmount(a, gross)) : ''));
    })));
};
const loadCertLines = async (ctx) => {
  if (!ctx.header.project_id) throw new Error('اختر المشروع أولاً');
  const rows = await GET('/p3/certifiable', { project_id: ctx.header.project_id, from: ctx.header.period_from || '', to: ctx.header.period_to || '', cert_id: ctx.doc?.id || '' });
  if (!rows.length) { ctx.toast('مفيش بنود تسليم متاحة للمستخلص في الفترة دي'); return; }
  ctx.setLines(rows); ctx.redrawExtra();
};
export const certificatesPage = docScreen({ perm: 'sales.certificates', type: 'client_certificate', title: 'مستخلصات العملاء', noun: 'مستخلص', newLabel: 'مستخلص جديد', nextNoKey: 'client_certificate',
  note: 'المستخلص بيجمّع إذونات التسليم اللي لسه ما دخلتش في مستخلص، وبتتطبّق عليه الخصومات والإضافات المتكوّدة (نسبة أو مبلغ). الأسعار مأخوذة من إذن التسليم (التكلفة + نسبة الربح).',
  filters: [{ k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'client_id', l: 'العميل', t: 'fk', ref: 'clients', combo: true }],
  print: (doc) => {
    const g = Number(doc.gross) || 0;
    return printSheet({ title: 'مستخلص', no: doc.no, date: doc.date, meta: [['العميل', doc.client_name], ['المشروع', doc.project_name], ['الفترة', `${doc.period_from || '—'} → ${doc.period_to || '—'}`]],
      cols: ['إذن التسليم', 'التاريخ', 'البند', 'الوحدة', 'الكمية', 'سعر الوحدة', 'القيمة'], rows: doc.lines.map((l) => [l.note_no, l.note_date, l.item_name, l.unit_name || '', fq(l.qty), fmt(l.unit_price), fmt(l.amount)]),
      totals: [['إجمالي المستخلص', fmt(g)], ...doc.adjustments.map((a) => [`${a.kind === 'deduction' ? '(−)' : '(+)'} ${a.name}${a.method === 'percent' ? ` ${fq(a.rate)}%` : ''}`, fmt(a.amount)]), ['صافي المستخلص', fmt(doc.net)]],
      notes: doc.notes, module: 'sales', by: doc.created_by_name, sign: ['المحاسب', 'المراجع', 'مدير المبيعات', 'اعتماد العميل'] });
  },
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'client_name', l: 'العميل' }, { k: 'project_name', l: 'المشروع' },
    { k: 'gross', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }, { k: 'deductions_total', l: 'الخصومات', num: true, fmt: (v) => fmt(v) }, { k: 'additions_total', l: 'الإضافات', num: true, fmt: (v) => fmt(v) }, { k: 'net', l: 'الصافي', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, header: [dateF, prjF, { k: 'period_from', l: 'من تاريخ (للتحميل)', t: 'date' }, { k: 'period_to', l: 'إلى تاريخ (للتحميل)', t: 'date' }, { ...notesF }],
    onHeader: (k, v, ctx) => { if (k === 'project_id') { ctx.setLines([{}]); } },
    tools: [{ label: '⬇ تحميل بنود التسليم غير المستخلصة', run: loadCertLines }],
    lines: { blank: () => ({}), addLabel: '＋ سطر', cols: [
      { l: 'إذن التسليم', calc: (l) => l.note_no || '', w: '110px' }, { l: 'التاريخ', calc: (l) => l.note_date || '', w: '110px' }, { l: 'البند', calc: (l) => l.item_name || '' },
      { l: 'الوحدة', calc: (l) => l.unit_name || '', w: '80px' }, { l: 'الكمية', calc: (l) => (l.qty ? fq(l.qty) : ''), w: '100px' }, { l: 'سعر الوحدة', calc: (l) => (l.unit_price ? fmt(l.unit_price) : ''), w: '110px' }, { l: 'القيمة', calc: (l) => (l.amount ? fmt(l.amount) : ''), w: '120px' }] },
    extraTitle: 'الخصومات والإضافات', extra: (ctx) => adjEditor(ctx),
    totals: (ctx) => { const n = certNums(ctx); return [['إجمالي المستخلص', fmt(n.gross)], ['الخصومات', fmt(n.ded)], ['الإضافات', fmt(n.add)], ['صافي المستخلص', fmt(n.net), 'big']]; },
  },
});

// ---------------- مخزن المنتجات التامة ----------------
export async function fgStockPage(root) {
  const host = h('div'); const wh = (L.warehouses || []).find((w) => w.type === 'finished' && w.active !== 0);
  const run = async (v) => {
    if (!wh) { host.replaceChildren(h('div.empty-state', 'لسه مفيش إنتاج تام معتمد التكلفة — اعتمد تكلفة أول شهر من «تكاليف مشروعات»')); return; }
    const r = await GET('/reports/stock-balances', { warehouse_id: wh.id, hide_zero: v.hide_zero, as_of: v.as_of || '' });
    host.replaceChildren(h('div.kpis', kpi('قيمة المنتج التام بالمخزن', fmt(r.total_value), `${r.rows.length} بند`)),
      table({ name: 'مخزن-المنتجات-التامة', center: true, rows: r.rows, onRow: (x) => { location.hash = `#/inventory/stock-card?material_id=${x.id}&warehouse_id=${wh.id}`; },
        cols: [{ k: 'name', l: 'البند', render: (x) => h('b', x.name) }, { k: 'unit', l: 'الوحدة' }, { k: 'qty', l: 'الكمية', num: true, fmt: (n) => fq(n) }, { k: 'avg_cost', l: 'متوسط تكلفة القطعة', num: true, fmt: (n) => fmt(n) }, { k: 'value', l: 'القيمة', num: true, fmt: (n) => fmt(n) }],
        foot: (c) => (c.k === 'value' ? fmt(r.total_value) : c.k === 'name' ? 'الإجمالي' : '') }));
  };
  const fb = filterBar([{ k: 'as_of', l: 'الأرصدة حتى تاريخ', t: 'date' }, { k: 'hide_zero', l: 'عرض', t: 'select', options: [['1', 'أصحاب الأرصدة فقط'], ['0', 'كل البنود']] }], run, { hide_zero: '1' });
  root.replaceChildren(pageHead('مخزن المنتجات التامة'), h('div.note', 'الرصيد والمتوسط المرجح لكل بند تام. اضغط على البند لفتح كارت الصنف.'), fb, host); fb.run();
}
