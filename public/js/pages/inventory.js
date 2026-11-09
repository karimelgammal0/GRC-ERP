import { h, GET, POST, L, META, loadLookups, modal, formGrid, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, codeName, statusBadge, labelOf, toast, guard } from '../core.js';
import { docScreen, dateF, notesF, total, qtyCol, matChange } from '../docs-ui.js';

export const KINDS = [['production', 'صرف إنتاج (مشروع + بند + مرحلة)'], ['site', 'تحويل لموقع'], ['overhead', 'تشغيل غير مباشر (بدون مشروع)']];
export const DOC_LABEL = { receipt: 'إذن استلام', invoice: 'فاتورة شراء', preturn: 'مرتجع مشتريات', issue: 'صرف', adjustment: 'جرد وتسوية', opening: 'رصيد افتتاحي' };
const unitOf = (mid) => nameOf('units', byId('materials', mid)?.unit_id);
const mapStock = async (ctx) => {
  const wh = ctx.header.warehouse_id; if (!wh) { ctx.stock = {}; return; }
  const rows = await GET('/helpers/stock-all', { warehouse_id: wh }); ctx.stock = Object.fromEntries(rows.map((r) => [r.material_id, r])); ctx.refresh();
};
// الخامات المتاحة في مخزن: لو المخزن مربوط بفئات خامات تظهر خاماتها بس، ولو مش مربوط بأي فئة تظهر كل الخامات
const whAllows = (wid) => { const cats = byId('warehouses', wid)?.category_ids || []; return cats.length ? (m) => cats.includes(m.category_id) : () => true; };
const canAddItems = () => { const me = META.me || {}; return me.role === 'admin' || (me.modules || []).some((m) => m === 'perm_add_items' || m === 'settings'); };
const addItemDialog = (ctx) => {
  const p = ctx.header.project_id; if (!p) { toast('اختر المشروع الأول', 'err'); return; }
  const fg = formGrid([{ k: 'name', l: 'اسم البند', t: 'text', req: 1 }, { k: 'qty', l: 'الكمية (اختياري)', t: 'number' }, { k: 'unit_id', l: 'الوحدة (اختياري)', t: 'fk', ref: 'units' }], {}, 1);
  modal({ title: `بند جديد في مشروع ${nameOf('projects', p)}`, body: fg.el, buttons: [{ label: 'حفظ واختيار البند', cls: 'primary', onClick: async () => {
    const it = await POST('/helpers/quick-item', { ...fg.values(), project_id: p }); await loadLookups();
    ctx.setHeader('item_id', it.id); ctx.rebuildHeader(); toast(`تم إضافة البند ${it.code}`);
  } }] });
};
const defaultWh = () => (L.warehouses.find((w) => w.type === 'raw' && w.active) || {}).id;

// ---------------- إذن صرف ----------------
// المواقع المكوّدة لمشروع (نشطة فقط)
const sitesOf = (projectId) => (L.sites || []).filter((x) => x.active !== 0 && projectId && x.project_id === Number(projectId));
const ISSUE_KINDS = KINDS.filter(([k]) => k !== 'site');
const issueLines = { blank: () => ({ material_id: null, qty: null }), cols: [
  { k: 'material_id', l: 'الخامة', t: 'fk', ref: 'materials', req: 1, w: '36%', onChange: matChange, filter: (x, l, c) => whAllows(c.header.warehouse_id)(x) }, qtyCol({ l: 'الكمية', w: '170px' }),
  { l: 'الوحدة', calc: (l) => unitOf(l.material_id), w: '80px' },
  { l: 'الرصيد المتاح', calc: (l, c) => c.stock?.[l.material_id]?.qty ?? 0, fmt: fq, w: '110px' },
  { l: 'متوسط التكلفة', calc: (l, c) => c.stock?.[l.material_id]?.avg_cost ?? 0, fmt: (v) => fmt(v, 4), w: '110px' },
  { l: 'التكلفة', calc: (l, c) => (l.total ?? (Number(l.qty) || 0) * (c.stock?.[l.material_id]?.avg_cost ?? 0)), fmt: (v) => fmt(v), w: '110px' }] };
const issueTotals = (ctx) => { const t = total(ctx.lines, (l) => l.total ?? (Number(l.qty) || 0) * (ctx.stock?.[l.material_id]?.avg_cost ?? 0)); return [[ctx.doc ? 'إجمالي تكلفة الصرف' : 'تكلفة تقديرية (الفعلية تُحسب عند الحفظ)', fmt(t)]]; };
const whF = (ctx) => ({ k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, filter: (x) => x.type === 'raw', onChange: (v) => {
  const ok = whAllows(v); let n = 0;
  ctx.lines.forEach((l) => { if (l.material_id && !ok(byId('materials', l.material_id))) { l.material_id = null; l.qty = null; l._eu = null; l._ev = undefined; n++; } });
  if (n) { ctx.setLines(ctx.lines); toast(`تم مسح ${n} خامة مش تابعة لفئات المخزن المختار`, 'err'); }
  mapStock(ctx);
} });
const receivedF = { k: 'received_by_id', l: 'المستلم', t: 'fk', ref: 'employees', combo: true };

// ---------------- إذن صرف (إنتاج / تشغيل غير مباشر) ----------------
export const issuesPage = docScreen({
  type: 'stock_issue', title: 'أذون الصرف', noun: 'إذن صرف', newLabel: 'إذن صرف جديد', fixed: { only: 'issues' }, defaultFrom: monthStart, defaultTo: today,
  note: 'كل صرف من المخزن بيتحدد له: المشروع + البند + المرحلة — ومنها بتتجمّع تكلفة كل مشروع وكل مرحلة تلقائياً بالمتوسط المرجح. (تحويل الخامات لمواقع المشاريع له شاشة منفصلة.)',
  filters: [{ k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages' }, { k: 'kind', l: 'النوع', t: 'select', options: [['', 'الكل'], ...ISSUE_KINDS] }],
  listCols: [
    { k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'kind', l: 'النوع', text: (r) => labelOf(KINDS, r.kind).split(' (')[0] },
    { k: 'project_name', l: 'المشروع' }, { k: 'item_name', l: 'البند' }, { k: 'stage_name', l: 'المرحلة' },
    { k: 'total', l: 'التكلفة', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    cols: 3, rebuildOn: ['kind', 'project_id'], defaults: () => ({ kind: 'production', warehouse_id: defaultWh() }),
    header: (ctx) => {
      const k = ctx.header.kind; const p = ctx.header.project_id;
      return [dateF, { k: 'kind', l: 'نوع الصرف', t: 'select', options: ISSUE_KINDS, lockOnEdit: true, req: 1, help: k === 'overhead' ? 'مواد تشغيل عامة للمصنع (زيوت، أدوات، نظافة…) مش تابعة لمشروع: تتحمّل كتكلفة غير مباشرة ومبتدخلش في تكلفة أي مشروع.' : 'مواد داخلة في تصنيع بند معين: تتحمّل على المشروع + البند + المرحلة وتدخل في تكلفة الإنتاج.' }, whF(ctx),
        k !== 'overhead' && { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', req: 1, combo: true, onChange: (v, c) => { const it = byId('project_items', c.header.item_id); if (it && it.project_id !== v) c.setHeader('item_id', null); c.header.site_id = null; } },
        k === 'production' && { k: 'item_id', l: 'البند داخل المشروع', t: 'fk', ref: 'project_items', req: 1, combo: true, filter: (x) => !p || x.project_id === p, help: p ? '' : 'اختر المشروع أولاً', action: canAddItems() ? { label: '＋ بند جديد', onClick: () => addItemDialog(ctx) } : null },
        { k: 'stage_id', l: k === 'overhead' ? 'المرحلة (اختياري)' : 'مرحلة التصنيع', t: 'fk', ref: 'stages', req: k === 'production' },
        receivedF, { ...notesF, wide: false }].filter(Boolean);
    },
    lines: issueLines, totals: issueTotals,
    onOpen: (ctx) => mapStock(ctx),
  },
});

// ---------------- تحويل خامات لموقع (منفصل عن صرف الإنتاج) ----------------
export const siteTransfersPage = docScreen({
  type: 'stock_issue', title: 'التحويل للمواقع', noun: 'تحويل لموقع', newLabel: 'تحويل جديد', fixed: { only: 'site_transfers' }, defaultFrom: monthStart, defaultTo: today,
  note: 'تحويل خامات من المخزن لمشروع. لو المشروع ليه مواقع مكوّدة في الإعدادات بيظهر حقل الموقع للاختيار منها، ولو مفيهوش مواقع الحقل مبيظهرش.',
  filters: (() => { let fp = null; return [
    { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true, onChange: (v) => { fp = v; } },
    { k: 'site_id', l: 'الموقع', t: 'fk', ref: 'sites', combo: true, showIf: (vals) => sitesOf(vals.project_id).length > 0, filter: (x) => !fp || x.project_id === Number(fp) }]; })(),
  listCols: [
    { k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'project_name', l: 'المشروع' }, { k: 'site_name', l: 'الموقع' },
    { k: 'total', l: 'التكلفة', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    cols: 3, rebuildOn: ['project_id'], defaults: () => ({ kind: 'site', warehouse_id: defaultWh() }),
    header: (ctx) => {
      const p = ctx.header.project_id; const sites = sitesOf(p);
      return [dateF, whF(ctx),
        { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', req: 1, combo: true, onChange: (v, c) => { const s = sitesOf(v); c.header.site_id = s.length === 1 ? s[0].id : null; } },
        sites.length ? { k: 'site_id', l: 'الموقع', t: 'fk', ref: 'sites', req: 1, readonly: sites.length === 1, filter: (x) => x.project_id === Number(p) } : null,
        receivedF, { ...notesF, wide: false }].filter(Boolean);
    },
    prepare: (payload) => { payload.kind = 'site'; const ss = sitesOf(payload.project_id); if (!ss.length) payload.site_id = null; else if (ss.length === 1) payload.site_id = ss[0].id; },
    lines: issueLines, totals: issueTotals,
    onOpen: (ctx) => mapStock(ctx),
  },
});

// ---------------- مرتجع صرف ----------------
export const returnsPage = docScreen({
  type: 'stock_issue', title: 'مرتجعات للمخزن', noun: 'مرتجع صرف', newLabel: 'مرتجع جديد', fixed: { only: 'returns' }, canCreate: true,
  note: 'المرتجع بيرجع للمخزن بنفس تكلفة الصرف الأصلي (مش بمتوسط يوم الرجوع)، وبيخصم من تكلفة المشروع/البند/المرحلة.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'project_name', l: 'المشروع' }, { k: 'item_name', l: 'البند' }, { k: 'stage_name', l: 'المرحلة' },
    { k: 'total', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ kind: 'return' }),
    header: (ctx) => [dateF, { k: 'ref_issue_id', l: 'إذن الصرف الأصلي', t: 'select', req: 1, lockOnEdit: true, options: [['', '— اختر —'], ...(ctx.issuesOpts || [])], onChange: async (v, c) => {
      if (!v) return c.setLines([]);
      const rows = await GET('/helpers/issue-lines', { issue_id: v });
      c.setLines(rows.filter((r) => r.remaining > 1e-6).map((r) => ({ ref_line_id: r.id, material_id: r.material_id, qty: r.remaining, _max: r.remaining, _issued: r.qty })));
    } }, { ...notesF, wide: false }],
    lines: { fixed: true, cols: [{ l: 'الخامة', calc: (l) => nameOf('materials', l.material_id), w: '40%' }, { k: 'qty', l: 'كمية المرتجع', t: 'number', w: '140px' }, { l: 'الحد الأقصى', calc: (l) => l._max, fmt: fq }, { l: 'المصروف أصلاً', calc: (l) => l._issued, fmt: fq }] },
    totals: (ctx) => [['بنود المرتجع', String(ctx.lines.length)]],
    onOpen: async (ctx) => {
      const iss = await GET('/helpers/returnable-issues'); ctx.issuesOpts = iss.map((i) => [String(i.id), `${i.no} — ${i.date} — ${i.project_name || 'تشغيل'}`]);
      if (ctx.doc) { const rows = await GET('/helpers/issue-lines', { issue_id: ctx.doc.ref_issue_id }); const m = Object.fromEntries(rows.map((r) => [r.id, r]));
        ctx.lines.forEach((l) => { const r = m[l.ref_line_id]; if (r) { l._max = r.remaining + l.qty; l._issued = r.qty; } });
        if (!ctx.issuesOpts.find(([k]) => Number(k) === ctx.doc.ref_issue_id)) ctx.issuesOpts.push([String(ctx.doc.ref_issue_id), `#${ctx.doc.ref_issue_id}`]); }
      ctx.rebuildHeader(); ctx.setLines(ctx.lines);
    },
    prepare: (p) => { p.ref_issue_id = Number(p.ref_issue_id); p.kind = 'return'; },
  },
});

// ---------------- جرد وتسوية ----------------
export const adjustmentsPage = docScreen({
  type: 'stock_adjustment', title: 'الجرد والتسوية', noun: 'جرد', newLabel: 'جرد جديد',
  note: 'أدخل الكمية الفعلية المجرودة؛ النظام يحسب الفرق عن رصيد الدفتر ويسوّيه (العجز بالمتوسط المرجح، والزيادة بمتوسط التكلفة الحالي) ويرحّل القيد.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'warehouse_name', l: 'المخزن' }, { k: 'net_value', l: 'صافي الفرق (قيمة)', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ warehouse_id: defaultWh() }),
    header: (ctx) => [dateF, { k: 'warehouse_id', l: 'المخزن', t: 'fk', ref: 'warehouses', req: 1, lockOnEdit: true, onChange: () => mapStock(ctx) }, { ...notesF, wide: false }],
    lines: { blank: () => ({ material_id: null, counted_qty: null }), cols: [
      { k: 'material_id', l: 'الخامة', t: 'fk', ref: 'materials', req: 1, w: '38%' }, { k: 'counted_qty', l: 'الكمية المجرودة', t: 'number', w: '140px' },
      { l: 'رصيد الدفتر', calc: (l, c) => (c.doc ? l.system_qty : (c.stock?.[l.material_id]?.qty ?? 0)), fmt: fq },
      { l: 'الفرق', calc: (l, c) => (c.doc ? l.diff_qty : (Number(l.counted_qty) || 0) - (c.stock?.[l.material_id]?.qty ?? 0)), fmt: fq },
      { l: 'قيمة الفرق', calc: (l, c) => (c.doc ? l.value : ((Number(l.counted_qty) || 0) - (c.stock?.[l.material_id]?.qty ?? 0)) * (c.stock?.[l.material_id]?.avg_cost ?? 0)), fmt: (v) => fmt(v) }],
    },
    tools: [{ label: 'تحميل كل الأصناف ذات الرصيد', run: async (ctx) => {
      await mapStock(ctx); const rows = Object.values(ctx.stock).filter((r) => r.qty > 0).sort((a, b) => a.material_id - b.material_id);
      ctx.setLines(rows.map((r) => ({ material_id: r.material_id, counted_qty: r.qty }))); toast(`تم تحميل ${rows.length} صنف — عدّل الكميات المجرودة`);
    } }],
    totals: (ctx) => [['صافي قيمة الفروق (تقديري)', fmt(total(ctx.lines, (l) => (ctx.doc ? l.value : ((Number(l.counted_qty) || 0) - (ctx.stock?.[l.material_id]?.qty ?? 0)) * (ctx.stock?.[l.material_id]?.avg_cost ?? 0))))]],
    onOpen: (ctx) => mapStock(ctx),
  },
});

// ---------------- أرصدة المخزن ----------------
export async function balancesPage(root, params) {
  const host = h('div'); const kp = h('div.kpis');
  const run = async (v) => {
    const r = await GET('/reports/stock-balances', { ...v, hide_zero: v.hide_zero === '1' ? '1' : '' });
    const nLow = r.rows.filter((x) => x.low).length;
    kp.replaceChildren(kpi('إجمالي قيمة المخزون', fmt(r.total_value), 'بالمتوسط المرجح'), kpi('عدد الأصناف', String(r.rows.length), v.hide_zero === '1' ? 'ذات رصيد' : 'كلها'), kpi('أصناف تحت حد الطلب', String(nLow), nLow ? 'محتاجة شراء' : 'تمام', nLow ? 'warn' : ''));
    host.replaceChildren(table({ name: 'أرصدة-المخزن', rowClass: (x) => (x.low ? 'low' : x.qty < 0 ? 'neg' : ''), onRow: (x) => { location.hash = `#/inventory/card?material_id=${x.id}`; },
      cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'الخامة', render: (x) => h('b', x.name) }, { k: 'category', l: 'الفئة' }, { k: 'unit', l: 'الوحدة' },
        { k: 'qty', l: 'الكمية', num: true, fmt: fq }, { k: 'avg_cost', l: 'متوسط التكلفة', num: true, fmt: (n) => fmt(n, 4) }, { k: 'value', l: 'القيمة', num: true, fmt: (n) => fmt(n) },
        { k: 'min_qty', l: 'حد الطلب', num: true, fmt: (n) => (n ? fq(n) : '') }, { l: '', render: (x) => (x.low ? badge('تحت الحد', 'warn') : '') }],
      rows: r.rows, foot: (c) => (c.k === 'value' ? fmt(r.total_value) : c.k === 'name' ? 'الإجمالي' : '') }));
  };
  const fb = filterBar([{ k: 'category_id', l: 'الفئة', t: 'fk', ref: 'material_categories' }, { k: 'as_of', l: 'الأرصدة في تاريخ (اختياري)', t: 'date' },
    { k: 'hide_zero', l: 'عرض', t: 'select', options: [['1', 'الأصناف ذات الرصيد فقط'], ['0', 'كل الأصناف']] }], run, { hide_zero: '1' });
  root.replaceChildren(pageHead('أرصدة مخزن الخامات', h('a.btn', { href: '#/inventory/card' }, 'كارت صنف')), fb, kp, host); fb.run();
}

// ---------------- كارت الصنف (بنفس شكل شيت الإكسل) ----------------
export async function stockCardPage(root, params) {
  const host = h('div');
  const run = async (v) => {
    if (!v.material_id) { host.replaceChildren(h('div.empty-state', 'اختر الخامة لعرض كارت الصنف')); return; }
    const r = await GET('/reports/stock-card', v);
    const unit = r.material.unit_name;
    const rows = [];
    if (v.from || true) rows.push({ _open: true, date: v.from || '', party: 'رصيد أول المدة', bq: r.opening.qty, bp: r.opening.avg, bv: r.opening.value });
    for (const m of r.moves) rows.push({ date: m.date, party: m.party || '', notes: [DOC_LABEL[m.doc_type], m.notes].filter(Boolean).join(' — '), iq: m.direction === 'in' ? m.qty : null, ip: m.direction === 'in' ? m.unit_cost : null, iv: m.direction === 'in' ? m.value : null,
      oq: m.direction === 'out' ? m.qty : null, op: m.direction === 'out' ? m.unit_cost : null, ov: m.direction === 'out' ? m.value : null, bq: m.bal_qty, bp: m.avg_cost, bv: m.bal_value });
    const N = (k, f = fmt) => ({ num: true, fmt: f });
    host.replaceChildren(h('div.kpis', kpi('الخامة', r.material.name, `${r.material.code} — الوحدة: ${unit}`), kpi('الرصيد الحالي', fq(r.closing.qty), unit), kpi('متوسط التكلفة', fmt(r.closing.avg, 4)), kpi('قيمة الرصيد', fmt(r.closing.value))),
      table({ name: `كارت-${r.material.code}`, compact: true, rows, maxRows: 2000, rowClass: (x) => (x._open ? 'low' : ''),
        cols: [{ k: 'date', l: 'التاريخ' }, { k: 'party', l: 'الجهة' }, { k: 'notes', l: 'البيان' },
          { k: 'iq', l: 'وارد: كمية', ...N(), fmt: fq }, { k: 'ip', l: 'سعر', ...N(), fmt: (n) => fmt(n, 3) }, { k: 'iv', l: 'قيمة', ...N() },
          { k: 'oq', l: 'صادر: كمية', ...N(), fmt: fq }, { k: 'op', l: 'سعر', ...N(), fmt: (n) => fmt(n, 3) }, { k: 'ov', l: 'قيمة', ...N() },
          { k: 'bq', l: 'الرصيد: كمية', ...N(), fmt: fq }, { k: 'bp', l: 'سعر', ...N(), fmt: (n) => fmt(n, 3) }, { k: 'bv', l: 'قيمة', ...N() }] }));
  };
  const fb = filterBar([{ k: 'material_id', l: 'الخامة', t: 'fk', ref: 'materials', combo: true, req: 1 }, { k: 'from', l: 'من تاريخ', t: 'date' }, { k: 'to', l: 'إلى تاريخ', t: 'date' }], run, { material_id: params.material_id ? Number(params.material_id) : null });
  root.replaceChildren(pageHead('كارت الصنف', h('a.btn', { href: '#/inventory/balances' }, 'الأرصدة')), h('div.note', 'نفس تصميم شيت المخزون القديم: وارد / صادر / رصيد (كمية — سعر — قيمة) بالمتوسط المرجح.'), fb, host); fb.run();
}

// ---------------- حركة المخزون ----------------
export async function movesPage(root) {
  const host = h('div');
  const run = async (v) => {
    const rows = await GET('/reports/stock-moves', v);
    host.replaceChildren(table({ name: 'حركة-المخزون', compact: true, rows, cols: [{ k: 'date', l: 'التاريخ' }, { k: 'material_name', l: 'الخامة' }, { k: 'doc_type', l: 'المستند', text: (r) => DOC_LABEL[r.doc_type] || r.doc_type },
      { k: 'party', l: 'الجهة' }, { k: 'direction', l: 'الاتجاه', render: (r) => (r.direction === 'in' ? badge('وارد', 'ok') : badge('صادر', 'warn')) },
      { k: 'qty', l: 'الكمية', num: true, fmt: fq }, { k: 'unit_cost', l: 'التكلفة', num: true, fmt: (n) => fmt(n, 3) }, { k: 'value', l: 'القيمة', num: true, fmt: (n) => fmt(n) }, { k: 'bal_qty', l: 'الرصيد بعدها', num: true, fmt: fq }] }));
  };
  const fb = filterBar([{ k: 'material_id', l: 'الخامة', t: 'fk', ref: 'materials', combo: true }, { k: 'direction', l: 'الاتجاه', t: 'select', options: [['', 'الكل'], ['in', 'وارد'], ['out', 'صادر']] }, { k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }], run, { from: monthStart() });
  root.replaceChildren(pageHead('حركة المخزون'), fb, host); fb.run();
}
