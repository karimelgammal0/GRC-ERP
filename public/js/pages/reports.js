import { h, GET, L, META, can, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, modal, nameOf, labelOf, CLASS_OPTS } from '../core.js';
import { barChart, donutChart, chartCard, chartsGrid } from '../charts.js';

const CT = [['', 'الكل'], ['material', 'خامات'], ['labor', 'عمالة'], ['expense', 'مصروفات']];
const REP_CLASS = [...CLASS_OPTS, ['transfer', 'تحويلات للمواقع']];
const SCOPES = [['manufacturing', 'تصنيع (بدون التحويلات للمواقع)'], ['transfer', 'تحويلات للمواقع'], ['all', 'الكل']];
const COSTF = [{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'cost_type', l: 'نوع التكلفة', t: 'select', options: CT }, { k: 'scope', l: 'النطاق', t: 'select', options: SCOPES }];

// ---------- طباعة التقارير: ترويسة للطباعة بس + زر طباعة + ملخص الفلاتر ----------
let PH = null;
const describeFilters = (fields, v) => fields.map((f) => {
  const val = v[f.k]; if (val === undefined || val === null || val === '') return '';
  const txt = f.t === 'fk' ? nameOf(f.ref, val) : f.t === 'select' ? labelOf(f.options || [], val) : val;
  return txt ? `${f.l}: ${String(txt).split(' (')[0]}` : '';
}).filter(Boolean).join('  |  ');
const fbar = (fields, run, init) => filterBar(fields, async (v) => { if (PH) PH.querySelector('.ph-filters').textContent = describeFilters(fields, v); return run(v); }, init);
const printReport = (title) => {
  const st = h('style', '@page { size: A4 landscape; margin: 10mm; }'); const old = document.title; document.title = title;
  document.head.append(st); const done = () => { st.remove(); document.title = old; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); window.print();
};
const rhead = (title) => {
  PH = h('div.print-only.print-head', h('div.ph-co', META.settings?.company_name || ''), h('div.ph-title', title), h('div.ph-filters'), h('div.ph-date', `تاريخ الطباعة: ${today()}`));
  return [PH, pageHead(title, h('button.btn.sm', { onclick: () => printReport(title) }, '🖨 طباعة التقرير'))];
};
const sumBy = (rows, keyFn, valFn = (r) => r.amount) => { const m = new Map(); for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) || 0) + (Number(valFn(r)) || 0)); return [...m].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })); };

export async function hub(root) {
  const items = [
    ['تكلفة المشاريع حسب المرحلة', 'كل مشروع وتكلفة كل مرحلة فيه (قوالب/صب/تشطيب)', '#/reports/project-stage'],
    ['تكلفة المراحل على كل المشاريع', 'كل مرحلة وتوزيعها على المشروعات', '#/reports/stage-project'],
    ['تحليل مشروع (بند × مرحلة)', 'تفصيل مشروع واحد على البنود والمراحل — بداية تكلفة البند', '#/reports/project-analysis'],
    ['استهلاك الخامات', 'الخامة × المشروع أو المرحلة', '#/reports/material-usage'],
    ['تكاليف المصنع', 'إجمالي تكاليف المصنع مصنفة مباشرة / غير مباشرة / إدارية (شهري أو حسب النوع)', '#/reports/factory-cost'],
    ['تفاصيل التكاليف', 'كل سطر تكلفة بفلاتر مشروع/بند/مرحلة/نوع', '#/reports/cost-detail'],
    ['المصروفات', 'حسب الفئة/التصنيف/المشروع/الشهر', '#/reports/expenses'],
    ['العمالة', 'حسب العامل/المرحلة/المشروع/التصنيف', '#/reports/labor'],
    ['ميزان المراجعة', 'أرصدة الحسابات بالفترة', '#/reports/trial-balance'],
    ['كشف حساب أستاذ', 'حركة أي حساب بالتفصيل', '#/reports/ledger'],
    ['قائمة الدخل المبسطة', 'الإيرادات والمصروفات', '#/reports/income'],
    ['أرصدة المخزون', 'كميات وقيم الخامات بالمتوسط المرجح', '#/inventory/balances'], ['أرصدة الموردين', 'المستحق مع أعمار الديون', '#/purchases/supplier-balances'], ['الخزن والعهد', 'أرصدة الخزن والبنوك والعهد', '#/finance/treasuries'],
  ];
  root.replaceChildren(pageHead('التقارير'), h('div.cards-hub', items.filter(([, , href]) => { const [, m, pg] = href.slice(1).split('/'); return can(`${m}.${pg}`); }).map(([t, d, href]) => h('a.hub-card', { href }, h('b', t), h('span', d)))));
}

function openDrill(filters, title) {
  const body = h('div', 'جاري التحميل…'); modal({ title, wide: true, body });
  GET('/reports/cost-lines', filters).then((rows) => body.replaceChildren(costTable(rows)));
}
// رابط المستند المصدر لسطر تكلفة: [الصفحة, مفتاح الصلاحية]
const VOUCHER_PG = { supplier_payment: 'expenses', expense: 'expenses', disbursement: 'expenses', wage_payment: 'wages', custody_issue: 'custody', custody_return: 'custody', transfer: 'custody', receipt: 'other', payment_other: 'other', collection: 'other' };
const docPage = (r) => {
  const t = r.source_type;
  if (t === 'issue') return ['inventory', r.doc_kind === 'site' ? 'site-transfers' : r.doc_kind === 'return' ? 'returns' : 'issues'];
  if (t === 'voucher') return VOUCHER_PG[r.doc_kind] ? ['finance', VOUCHER_PG[r.doc_kind]] : null;
  return { receipt: ['purchases', 'receipts'], invoice: ['purchases', 'invoices'], preturn: ['purchases', 'returns'], adjustment: ['inventory', 'adjustments'],
    labor: ['hr', 'labor'], labor_advance: ['hr', 'labor-advances'], payroll: ['hr', 'payroll'] }[t] || null;
};
const docLink = (r) => {
  if (!r.doc_no) return '';
  const pg = docPage(r);
  return pg && can(`${pg[0]}.${pg[1]}`) ? h('a', { href: `#/${pg[0]}/${pg[1]}?id=${r.source_id}`, title: 'فتح المستند' }, r.doc_no) : r.doc_no;
};
const costTable = (rows) => table({ name: 'تفاصيل التكلفة', compact: true, rows,
  cols: [{ k: 'date', l: 'التاريخ' }, { k: 'doc_no', l: 'رقم المستند', render: docLink, text: (r) => r.doc_no || '' }, { k: 'project_name', l: 'المشروع' }, { k: 'item_name', l: 'البند' }, { k: 'stage_name', l: 'المرحلة' }, { k: 'cost_type', l: 'النوع', text: (r) => labelOf(CT, r.cost_type) },
    { k: 'cost_class', l: 'التصنيف', text: (r) => labelOf(REP_CLASS, r.cost_class).split(' (')[0] }, { k: 'desc', l: 'البيان', text: (r) => r.material_name || r.employee_name || r.category_name || r.site_name || r.description || '' },
    { k: 'qty', l: 'الكمية', num: true, fmt: (v) => fq(v) }, { k: 'amount', l: 'المبلغ', num: true, fmt: (v) => fmt(v) }],
  foot: (c, rows) => (c.k === 'amount' ? fmt(rows.reduce((s, r) => s + r.amount, 0)) : c.k === 'date' ? 'الإجمالي' : '') });

function pivotPage({ title, row, col, rowRef, colRef, rowLbl, extra = [], note }) {
  return async (root, params) => {
    const host = h('div');
    const run = async (v) => {
      const d = await GET('/reports/cost-pivot', { row, col, ...v });
      const dimKey = (dim) => ({ project: 'project_id', stage: 'stage_id', item: 'item_id', material: 'material_id' }[dim]);
      const drill = (r, c) => { const f = { ...v }; if (r != null) f[dimKey(row)] = r; if (c != null) f[dimKey(col)] = c; return () => openDrill(f, `${r != null ? nameOf(rowRef, r) || '' : ''} ${c != null ? nameOf(colRef, c) || '' : ''}`); };
      const cell = (val, fn) => (val ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); fn(); } }, fmt(val)) : '');
      const cols = [{ k: 'name', l: rowLbl, render: (r) => h('b', r.name || 'غير محدد') },
        ...d.cols.map((c) => ({ k: 'c' + c.key, l: c.name || 'غير محدد', num: true, render: (r) => cell(r.values[c.key], drill(Number(r.key) || null, Number(c.key) || null)) })),
        { k: 'material', l: 'خامات', num: true, fmt: (n) => fmt(n) }, { k: 'labor', l: 'عمالة', num: true, fmt: (n) => fmt(n) }, { k: 'expense', l: 'مصروفات', num: true, fmt: (n) => fmt(n) }, { k: 'total', l: 'الإجمالي', num: true, render: (r) => h('b', fmt(r.total)) }];
      const foot = (c) => (c.k === 'name' ? 'الإجمالي' : c.k.startsWith('c') ? fmt(d.totals.values[c.k.slice(1)]) : c.k === 'total' ? fmt(d.totals.total) : ['material', 'labor', 'expense'].includes(c.k) ? fmt(d.totals[c.k]) : '');
      const stacked = d.cols.length > 1 && d.cols.length <= 6;
      const rowItems = d.rows.map((r) => ({ label: r.name || 'غير محدد', value: r.total, series: stacked ? d.cols.map((c) => ({ name: c.name || 'غير محدد', value: r.values[c.key] || 0 })) : null }));
      host.replaceChildren(h('div.kpis', kpi('إجمالي التكلفة', fmt(d.totals.total)), kpi('خامات', fmt(d.totals.material)), kpi('عمالة', fmt(d.totals.labor)), kpi('مصروفات', fmt(d.totals.expense))),
        chartsGrid(chartCard('توزيع التكلفة حسب النوع', donutChart([{ label: 'خامات', value: d.totals.material }, { label: 'عمالة', value: d.totals.labor }, { label: 'مصروفات', value: d.totals.expense }])),
          chartCard(`أعلى ${rowLbl} تكلفة${stacked ? ' (مقسمة حسب ' + (col === 'stage' ? 'المرحلة' : 'العمود') + ')' : ''}`, barChart(rowItems))),
        table({ name: title, cols, rows: d.rows, foot }), h('div.hint', 'اضغط على أي رقم لعرض الحركات اللي كوّنته.'));
    };
    const fb = fbar([...COSTF, ...extra], run, { from: monthStart(), scope: 'manufacturing', project_id: params.project_id ? Number(params.project_id) : null });
    root.replaceChildren(...rhead(title), note ? h('div.note', note) : null, fb, host); fb.run();
  };
}
export const projectStagePage = pivotPage({ title: 'تكلفة المشاريع حسب المرحلة', row: 'project', col: 'stage', rowRef: 'projects', colRef: 'stages', rowLbl: 'المشروع', extra: [{ k: 'project_id', l: 'مشروع', t: 'fk', ref: 'projects', combo: true }] });
export const stageProjectPage = pivotPage({ title: 'تكلفة المراحل على كل المشاريع', row: 'stage', col: 'project', rowRef: 'stages', colRef: 'projects', rowLbl: 'المرحلة', extra: [{ k: 'stage_id', l: 'مرحلة', t: 'fk', ref: 'stages' }] });
export const projectAnalysisPage = async (root, params) => {
  const wrap = h('div'); let pid = params.project_id ? Number(params.project_id) : null;
  const inner = pivotPage({ title: 'تحليل مشروع (بند × مرحلة)', row: 'item', col: 'stage', rowRef: 'project_items', colRef: 'stages', rowLbl: 'البند', extra: [{ k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true, req: 1 }], note: 'اختر المشروع لعرض تكلفة كل بند داخله موزعة على المراحل. السطور «غير محدد» هي تكلفة غير مربوطة ببند.' });
  await inner(root, { project_id: pid });
};
export const materialUsagePage = pivotPage({ title: 'استهلاك الخامات', row: 'material', col: 'stage', rowRef: 'materials', colRef: 'stages', rowLbl: 'الخامة', extra: [{ k: 'project_id', l: 'مشروع', t: 'fk', ref: 'projects', combo: true }] });

export async function costDetailPage(root) {
  const host = h('div');
  const fb = fbar([...COSTF, { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', combo: true }, { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages' }, { k: 'cost_class', l: 'التصنيف', t: 'select', options: [['', 'الكل'], ...CLASS_OPTS] }],
    async (v) => { const rows = await GET('/reports/cost-lines', v); const TY = { material: 'خامات', labor: 'عمالة', expense: 'مصروفات' };
      host.replaceChildren(h('div.kpis', kpi('إجمالي التكلفة', fmt(rows.reduce((s, r) => s + r.amount, 0))), kpi('عدد السطور', String(rows.length))),
        chartsGrid(chartCard('توزيع التكلفة حسب النوع', donutChart(sumBy(rows, (r) => TY[r.cost_type] || r.cost_type))), chartCard('التكلفة حسب المرحلة', barChart(sumBy(rows, (r) => r.stage_name || 'غير محدد')))),
        costTable(rows)); }, { from: monthStart(), scope: 'manufacturing' });
  root.replaceChildren(...rhead('تفاصيل التكاليف'), fb, host); fb.run();
}
// تكاليف المصنع: كل التكاليف (بدون التحويلات للمواقع) مصنفة مباشرة / غير مباشرة / إدارية، شهرياً أو حسب نوع التكلفة
export async function factoryCostPage(root) {
  const host = h('div'); const ORD = ['direct', 'indirect', 'admin'];
  const link = (val, fn) => (val ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); fn(); } }, fmt(val)) : '');
  // تفصيل: مشروع × مرحلة × تصنيف
  const detail = async (v) => {
    const d = await GET('/reports/factory-cost', { from: v.from, to: v.to, project_id: v.project_id, stage_id: v.stage_id });
    const none = (x) => (x == null ? 'none' : x);
    const drill = (r, cls) => () => openDrill({ from: v.from, to: v.to, scope: 'manufacturing', project_id: r.project_id === undefined ? v.project_id : none(r.project_id), stage_id: r.stage_id === undefined ? v.stage_id : none(r.stage_id), cost_class: cls }, `${r.project_name || ''} ${r.stage_name ? '— ' + r.stage_name : ''} ${cls ? '— ' + labelOf(REP_CLASS, cls).split(' (')[0] : ''}`);
    // سطور المشروع + إجمالي كل مشروع
    const out = []; const byP = new Map();
    for (const r of d.rows) { const k = r.project_id ?? 'none'; if (!byP.has(k)) byP.set(k, []); byP.get(k).push(r); }
    for (const [, list] of byP) {
      out.push(...list);
      if (list.length > 1) out.push({ sub: true, project_id: list[0].project_id, project_name: list[0].project_name, stage_name: 'إجمالي المشروع', stage_id: undefined, ...Object.fromEntries(['direct', 'indirect', 'admin', 'total'].map((k) => [k, list.reduce((s, x) => s + (x[k] || 0), 0)])) });
    }
    const cell = (k) => ({ k, l: labelOf(REP_CLASS, k).split(' (')[0], num: true, render: (r) => (r.sub ? h('b', fmt(r[k])) : link(r[k], drill(r, k))) });
    const cols = [{ k: 'project_name', l: 'المشروع', render: (r) => (r.sub ? '' : h('b', r.project_name)) }, { k: 'stage_name', l: 'المرحلة', render: (r) => (r.sub ? h('b', r.stage_name) : r.stage_name) },
      ...ORD.map(cell), { k: 'total', l: 'الإجمالي', num: true, render: (r) => (r.sub ? h('b', fmt(r.total)) : h('b', link(r.total, drill(r, null)) || '')) }];
    const foot = (c) => (c.k === 'project_name' ? 'الإجمالي' : ORD.includes(c.k) || c.k === 'total' ? fmt(d.totals[c.k]) : '');
    const CL = { direct: 'مباشرة', indirect: 'غير مباشرة', admin: 'إدارية' };
    const perProject = [...byP].map(([, list]) => ({ label: list[0].project_name, value: list.reduce((s, x) => s + x.total, 0), series: ORD.map((k) => ({ name: CL[k], value: list.reduce((s, x) => s + (x[k] || 0), 0) })) }));
    host.replaceChildren(h('div.kpis', kpi('إجمالي تكاليف المصنع', fmt(d.totals.total)), kpi('مباشرة', fmt(d.totals.direct)), kpi('غير مباشرة', fmt(d.totals.indirect)), kpi('إدارية', fmt(d.totals.admin))),
      chartsGrid(chartCard('توزيع التكاليف حسب التصنيف', donutChart(ORD.map((k) => ({ label: CL[k], value: d.totals[k] })))), chartCard('التكلفة لكل مشروع (مقسمة حسب التصنيف)', barChart(perProject))),
      table({ name: 'تكاليف المصنع — مشروع × مرحلة × تصنيف', cols, rows: out, foot }), h('div.hint', 'التحويلات للمواقع غير محسوبة هنا. التكاليف غير المباشرة والإدارية غالباً بدون مشروع فبتظهر تحت «تكاليف عامة». اضغط على أي رقم لعرض السطور اللي كوّنته.'));
  };
  // ملخص: تصنيف × (شهر | نوع التكلفة)
  const summary = async (v, by) => {
    const d = await GET('/reports/cost-pivot', { row: 'class', col: by, from: v.from, to: v.to, project_id: v.project_id, stage_id: v.stage_id });
    const rows = [...d.rows].sort((a, b) => ORD.indexOf(a.key) - ORD.indexOf(b.key));
    const drill = (cls, ck) => () => { const f = { from: v.from, to: v.to, project_id: v.project_id, stage_id: v.stage_id, cost_class: cls }; if (ck != null) { if (by === 'type') f.cost_type = ck; else { f.from = `${ck}-01`; f.to = `${ck}-31`; if (v.from && v.from > f.from) f.from = v.from; if (v.to && v.to < f.to) f.to = v.to; } } openDrill(f, `${labelOf(REP_CLASS, cls).split(' (')[0]}${ck != null ? ' — ' + (d.cols.find((c) => String(c.key) === String(ck))?.name || ck) : ''}`); };
    const cols = [{ k: 'name', l: 'التصنيف', render: (r) => h('b', r.name) },
      ...d.cols.map((c) => ({ k: 'c' + c.key, l: c.name || 'غير محدد', num: true, render: (r) => link(r.values[c.key], drill(r.key, c.key)) })),
      { k: 'total', l: 'الإجمالي', num: true, render: (r) => h('b', link(r.total, drill(r.key, null)) || '') }];
    const foot = (c) => (c.k === 'name' ? 'الإجمالي' : c.k.startsWith('c') ? fmt(d.totals.values[c.k.slice(1)]) : c.k === 'total' ? fmt(d.totals.total) : '');
    const tot = Object.fromEntries(rows.map((r) => [r.key, r.total]));
    const CL = { direct: 'مباشرة', indirect: 'غير مباشرة', admin: 'إدارية' };
    const colItems = d.cols.map((c) => ({ label: c.name || 'غير محدد', value: d.totals.values[c.key] || 0, series: rows.map((r) => ({ name: CL[r.key] || r.name, value: r.values[c.key] || 0 })) }));
    host.replaceChildren(h('div.kpis', kpi('إجمالي تكاليف المصنع', fmt(d.totals.total)), kpi('مباشرة', fmt(tot.direct || 0)), kpi('غير مباشرة', fmt(tot.indirect || 0)), kpi('إدارية', fmt(tot.admin || 0))),
      chartsGrid(chartCard('توزيع التكاليف حسب التصنيف', donutChart(ORD.map((k) => ({ label: CL[k], value: tot[k] || 0 })))), chartCard(by === 'month' ? 'التكلفة شهرياً (مقسمة حسب التصنيف)' : 'التكلفة حسب النوع (مقسمة حسب التصنيف)', barChart(colItems, { max: 12 }))),
      table({ name: 'تكاليف المصنع', cols, rows, foot }), h('div.hint', 'التحويلات للمواقع غير محسوبة هنا. اضغط على أي رقم لعرض السطور اللي كوّنته.'));
  };
  // كارت «التكلفة حسب المشروع»: المشروعات اللي عليها تكلفة في الفترة بس (بدون التحويلات للمواقع)
  const projectCard = async (v) => {
    const d = await GET('/reports/factory-cost', { from: v.from, to: v.to, project_id: v.project_id, stage_id: v.stage_id });
    const m = new Map();
    for (const r of d.rows) { if (!r.project_id) continue; const x = m.get(r.project_id) || { project_id: r.project_id, name: r.project_name, direct: 0, indirect: 0, admin: 0, total: 0 }; for (const k of ['direct', 'indirect', 'admin', 'total']) x[k] += r[k] || 0; m.set(r.project_id, x); }
    const rows = [...m.values()].filter((x) => Math.abs(x.total) > 0.004).sort((a, b) => b.total - a.total);
    const sum = rows.reduce((s2, x) => s2 + x.total, 0);
    const dr = (r, cls) => () => openDrill({ from: v.from, to: v.to, scope: 'manufacturing', project_id: r.project_id, stage_id: v.stage_id, cost_class: cls }, `${r.name}${cls ? ' — ' + labelOf(REP_CLASS, cls).split(' (')[0] : ''}`);
    const cell = (k) => ({ k, l: labelOf(REP_CLASS, k).split(' (')[0], num: true, render: (r) => link(r[k], dr(r, k)) });
    return card('التكلفة حسب المشروع', rows.length ? table({ name: 'التكلفة حسب المشروع', compact: true, search: false, rows,
      cols: [{ k: 'name', l: 'المشروع', render: (r) => h('b', r.name) }, ...ORD.map(cell), { k: 'total', l: 'الإجمالي', num: true, render: (r) => h('b', link(r.total, dr(r, null)) || '') }, { k: 'pct', l: 'النسبة', num: true, text: (r) => (sum ? (r.total / sum * 100).toFixed(1) + '%' : '') }],
      foot: (c) => (c.k === 'name' ? `الإجمالي (${rows.length} مشروع)` : ORD.includes(c.k) ? fmt(rows.reduce((s2, x) => s2 + x[c.k], 0)) : c.k === 'total' ? fmt(sum) : c.k === 'pct' ? '100%' : '') })
      : h('div.empty-state', 'لا توجد مشروعات عليها تكلفة في الفترة المحددة'));
  };
  const fb = fbar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages' },
    { k: 'by', l: 'العرض', t: 'select', options: [['detail', 'مفصل: مشروع × مرحلة × تصنيف'], ['month', 'ملخص: التصنيف × الشهر'], ['type', 'ملخص: التصنيف × نوع التكلفة']] }],
  async (v) => { const by = v.by || 'detail'; await (by === 'detail' ? detail(v) : summary(v, by)); const pc = await projectCard(v); (host.querySelector('.chart-grid') || host.querySelector('.kpis'))?.after(pc); }, { from: monthStart(), by: 'detail' });
  root.replaceChildren(...rhead('تكاليف المصنع'), fb, host); fb.run();
}
function groupReport(title, endpoint, groups, cols, extraFilters = []) {
  return async (root) => {
    const host = h('div');
    const fb = fbar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'group', l: 'تجميع حسب', t: 'select', options: groups }, ...extraFilters],
      async (v) => { const rows = await GET(endpoint, v); const nm = (r) => (v.group === 'class' ? labelOf(CLASS_OPTS, r.name).split(' (')[0] : r.name);
      const items = sumBy(rows, nm, (r) => r.amount);
      host.replaceChildren(h('div.kpis', kpi('الإجمالي', fmt(rows.reduce((s, r) => s + r.amount, 0)))), chartsGrid(chartCard('أعلى البنود', barChart(items)), chartCard('نسبة كل بند من الإجمالي', donutChart(items))), table({ name: title, rows, cols, foot: (c) => (c.k === 'amount' ? fmt(rows.reduce((s, r) => s + r.amount, 0)) : c.k === 'name' ? 'الإجمالي' : '') })); }, { from: monthStart() });
    root.replaceChildren(...rhead(title), fb, host); fb.run();
  };
}
export const expensesReport = groupReport('تقرير المصروفات', '/reports/expenses', [['category', 'الفئة'], ['class', 'التصنيف'], ['project', 'المشروع'], ['month', 'الشهر']],
  [{ k: 'name', l: 'البند', render: (r) => h('b', labelOf(CLASS_OPTS, r.name).split(' (')[0]) }, { k: 'cost_class', l: 'التصنيف', text: (r) => labelOf(CLASS_OPTS, r.cost_class).split(' (')[0] }, { k: 'n', l: 'عدد', num: true }, { k: 'amount', l: 'المبلغ', num: true, fmt: (v) => fmt(v) }]);
export const laborReport = groupReport('تقرير العمالة', '/reports/labor', [['employee', 'العامل'], ['stage', 'المرحلة'], ['project', 'المشروع'], ['class', 'التصنيف'], ['month', 'الشهر']],
  [{ k: 'name', l: 'البند', render: (r) => h('b', labelOf(CLASS_OPTS, r.name).split(' (')[0]) }, { k: 'units', l: 'أيام/وحدات', num: true, fmt: (v) => fq(v) }, { k: 'amount', l: 'التكلفة', num: true, fmt: (v) => fmt(v) }]);

export async function trialBalancePage(root) {
  const host = h('div');
  const fb = fbar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }], async (v) => {
    const d = await GET('/reports/trial-balance', v);
    host.replaceChildren(h('div.kpis', kpi('مدين', fmt(d.totals.debit)), kpi('دائن', fmt(d.totals.credit)), kpi('الفرق', fmt(d.totals.closing), d.totals.closing === 0 ? 'الميزان متزن ✓' : 'غير متزن!', d.totals.closing === 0 ? '' : 'bad')),
      table({ name: 'ميزان المراجعة', compact: true, rows: d.rows, onRow: (r) => { location.hash = `#/reports/ledger?account_id=${r.id}&from=${v.from || ''}&to=${v.to || ''}`; }, cols: [
        { k: 'code', l: 'الكود', render: (r) => h('span', { style: { fontWeight: r.postable ? 400 : 700 } }, r.code) }, { k: 'name', l: 'الحساب', render: (r) => h('span', { style: { fontWeight: r.postable ? 400 : 700 } }, r.name) },
        { k: 'opening', l: 'رصيد أول', num: true, fmt: (n) => fmt(n) }, { k: 'debit', l: 'مدين', num: true, fmt: (n) => fmt(n) }, { k: 'credit', l: 'دائن', num: true, fmt: (n) => fmt(n) }, { k: 'closing', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
  }, { from: monthStart() });
  root.replaceChildren(...rhead('ميزان المراجعة'), fb, host); fb.run();
}
export async function ledgerPage(root, params) {
  const host = h('div');
  const fb = fbar([{ k: 'account_id', l: 'الحساب', t: 'fk', ref: 'accounts', combo: true, req: 1, filter: (x) => x.postable }, { k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'project_id', l: 'مشروع', t: 'fk', ref: 'projects', combo: true }], async (v) => {
    if (!v.account_id) { host.replaceChildren(h('div.empty-state', 'اختر الحساب')); return; }
    const d = await GET('/reports/ledger', v);
    host.replaceChildren(h('div.kpis', kpi('رصيد أول', fmt(d.opening)), kpi('الرصيد الختامي', fmt(d.closing))),
      table({ name: 'كشف حساب أستاذ ' + d.account.name, compact: true, rows: [{ date: v.from || '', description: 'رصيد أول المدة', balance: d.opening }, ...d.rows], cols: [{ k: 'date', l: 'التاريخ' }, { k: 'no', l: 'القيد' }, { k: 'description', l: 'البيان', text: (r) => r.line_desc || r.description }, { k: 'debit', l: 'مدين', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'credit', l: 'دائن', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'balance', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
  }, { account_id: params.account_id ? Number(params.account_id) : null, from: params.from || monthStart(), to: params.to || '' });
  root.replaceChildren(...rhead('كشف حساب أستاذ'), fb, host); if (params.account_id) fb.run();
}
export async function incomePage(root) {
  const host = h('div');
  const t = (rows) => table({ search: false, compact: true, name: 'قائمة الدخل', rows, cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'الحساب' }, { k: 'amount', l: 'المبلغ', num: true, fmt: (n) => fmt(n) }] });
  const fb = fbar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }], async (v) => {
    const d = await GET('/reports/income-summary', v);
    host.replaceChildren(h('div.kpis', kpi('الإيرادات', fmt(d.total_revenue)), kpi('المصروفات', fmt(d.total_expenses)), kpi('صافي الربح/الخسارة', fmt(d.net), '', d.net < 0 ? 'bad' : '')), chartsGrid(chartCard('الإيرادات مقابل المصروفات', barChart([{ label: 'الإيرادات', value: d.total_revenue }, { label: 'المصروفات', value: d.total_expenses }])), chartCard('توزيع المصروفات', donutChart(d.expenses.map((x) => ({ label: x.name, value: x.amount }))))),
      h('div.grid2', card('الإيرادات', t(d.revenue)), card('المصروفات', t(d.expenses))));
  }, { from: monthStart() });
  root.replaceChildren(...rhead('قائمة الدخل المبسطة'), h('div.note', 'تُحسب من القيود: تكلفة المنتج تحت التشغيل تبقى أصل (WIP) إلى أن تُنقل للتكلفة عند البيع (مرحلة المنتجات التامة لاحقاً).'), fb, host); fb.run();
}
