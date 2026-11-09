import { h, GET, L, META, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, modal, nameOf, labelOf, CLASS_OPTS } from '../core.js';

const CT = [['', 'الكل'], ['material', 'خامات'], ['labor', 'عمالة'], ['expense', 'مصروفات']];
const COSTF = [{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'cost_type', l: 'نوع التكلفة', t: 'select', options: CT }];

export async function hub(root) {
  const items = [
    ['تكلفة المشاريع حسب المرحلة', 'كل مشروع وتكلفة كل مرحلة فيه (قوالب/صب/تشطيب)', '#/reports/project-stage'],
    ['تكلفة المراحل على كل المشاريع', 'كل مرحلة وتوزيعها على المشروعات', '#/reports/stage-project'],
    ['تحليل مشروع (بند × مرحلة)', 'تفصيل مشروع واحد على البنود والمراحل — بداية تكلفة البند', '#/reports/project-analysis'],
    ['استهلاك الخامات', 'الخامة × المشروع أو المرحلة', '#/reports/material-usage'],
    ['تفاصيل التكاليف', 'كل سطر تكلفة بفلاتر مشروع/بند/مرحلة/نوع', '#/reports/cost-detail'],
    ['المصروفات', 'حسب الفئة/التصنيف/المشروع/الشهر', '#/reports/expenses'],
    ['العمالة', 'حسب العامل/المرحلة/المشروع/التصنيف', '#/reports/labor'],
    ['ميزان المراجعة', 'أرصدة الحسابات بالفترة', '#/reports/trial-balance'],
    ['أستاذ الحساب', 'حركة أي حساب بالتفصيل', '#/reports/ledger'],
    ['قائمة الدخل المبسطة', 'الإيرادات والمصروفات', '#/reports/income'],
    ['أرصدة المخزون', 'كميات وقيم الخامات بالمتوسط المرجح', '#/inventory/balances'], ['أرصدة الموردين', 'المستحق مع أعمار الديون', '#/purchases/supplier-balances'], ['الخزن والعهد', 'أرصدة الخزن والبنوك والعهد', '#/finance/treasuries'],
  ];
  root.replaceChildren(pageHead('التقارير'), h('div.cards-hub', items.map(([t, d, href]) => h('a.hub-card', { href }, h('b', t), h('span', d)))));
}

function openDrill(filters, title) {
  const body = h('div', 'جاري التحميل…'); modal({ title, wide: true, body });
  GET('/reports/cost-lines', filters).then((rows) => body.replaceChildren(costTable(rows)));
}
const costTable = (rows) => table({ name: 'تفاصيل التكلفة', compact: true, rows,
  cols: [{ k: 'date', l: 'التاريخ' }, { k: 'project_name', l: 'المشروع' }, { k: 'item_name', l: 'البند' }, { k: 'stage_name', l: 'المرحلة' }, { k: 'cost_type', l: 'النوع', text: (r) => labelOf(CT, r.cost_type) },
    { k: 'cost_class', l: 'التصنيف', text: (r) => labelOf(CLASS_OPTS, r.cost_class).split(' (')[0] }, { k: 'desc', l: 'البيان', text: (r) => r.material_name || r.employee_name || r.category_name || r.site_name || r.description || '' },
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
      host.replaceChildren(h('div.kpis', kpi('إجمالي التكلفة', fmt(d.totals.total)), kpi('خامات', fmt(d.totals.material)), kpi('عمالة', fmt(d.totals.labor)), kpi('مصروفات', fmt(d.totals.expense))),
        table({ name: title, cols, rows: d.rows, foot }), h('div.hint', 'اضغط على أي رقم لعرض الحركات اللي كوّنته.'));
    };
    const fb = filterBar([...COSTF, ...extra], run, { from: monthStart(), project_id: params.project_id ? Number(params.project_id) : null });
    root.replaceChildren(pageHead(title), note ? h('div.note', note) : null, fb, host); fb.run();
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
  const fb = filterBar([...COSTF, { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true }, { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', combo: true }, { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages' }, { k: 'cost_class', l: 'التصنيف', t: 'select', options: [['', 'الكل'], ...CLASS_OPTS] }],
    async (v) => host.replaceChildren(costTable(await GET('/reports/cost-lines', v))), { from: monthStart() });
  root.replaceChildren(pageHead('تفاصيل التكاليف'), fb, host); fb.run();
}
function groupReport(title, endpoint, groups, cols, extraFilters = []) {
  return async (root) => {
    const host = h('div');
    const fb = filterBar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'group', l: 'تجميع حسب', t: 'select', options: groups }, ...extraFilters],
      async (v) => { const rows = await GET(endpoint, v); host.replaceChildren(h('div.kpis', kpi('الإجمالي', fmt(rows.reduce((s, r) => s + r.amount, 0)))), table({ name: title, rows, cols, foot: (c) => (c.k === 'amount' ? fmt(rows.reduce((s, r) => s + r.amount, 0)) : c.k === 'name' ? 'الإجمالي' : '') })); }, { from: monthStart() });
    root.replaceChildren(pageHead(title), fb, host); fb.run();
  };
}
export const expensesReport = groupReport('تقرير المصروفات', '/reports/expenses', [['category', 'الفئة'], ['class', 'التصنيف'], ['project', 'المشروع'], ['month', 'الشهر']],
  [{ k: 'name', l: 'البند', render: (r) => h('b', labelOf(CLASS_OPTS, r.name).split(' (')[0]) }, { k: 'cost_class', l: 'التصنيف', text: (r) => labelOf(CLASS_OPTS, r.cost_class).split(' (')[0] }, { k: 'n', l: 'عدد', num: true }, { k: 'amount', l: 'المبلغ', num: true, fmt: (v) => fmt(v) }]);
export const laborReport = groupReport('تقرير العمالة', '/reports/labor', [['employee', 'العامل'], ['stage', 'المرحلة'], ['project', 'المشروع'], ['class', 'التصنيف'], ['month', 'الشهر']],
  [{ k: 'name', l: 'البند', render: (r) => h('b', labelOf(CLASS_OPTS, r.name).split(' (')[0]) }, { k: 'units', l: 'أيام/وحدات', num: true, fmt: (v) => fq(v) }, { k: 'amount', l: 'التكلفة', num: true, fmt: (v) => fmt(v) }]);

export async function trialBalancePage(root) {
  const host = h('div');
  const fb = filterBar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }], async (v) => {
    const d = await GET('/reports/trial-balance', v);
    host.replaceChildren(h('div.kpis', kpi('مدين', fmt(d.totals.debit)), kpi('دائن', fmt(d.totals.credit)), kpi('الفرق', fmt(d.totals.closing), d.totals.closing === 0 ? 'الميزان متزن ✓' : 'غير متزن!', d.totals.closing === 0 ? '' : 'bad')),
      table({ name: 'ميزان المراجعة', compact: true, rows: d.rows, onRow: (r) => { location.hash = `#/reports/ledger?account_id=${r.id}&from=${v.from || ''}&to=${v.to || ''}`; }, cols: [
        { k: 'code', l: 'الكود', render: (r) => h('span', { style: { fontWeight: r.postable ? 400 : 700 } }, r.code) }, { k: 'name', l: 'الحساب', render: (r) => h('span', { style: { fontWeight: r.postable ? 400 : 700 } }, r.name) },
        { k: 'opening', l: 'رصيد أول', num: true, fmt: (n) => fmt(n) }, { k: 'debit', l: 'مدين', num: true, fmt: (n) => fmt(n) }, { k: 'credit', l: 'دائن', num: true, fmt: (n) => fmt(n) }, { k: 'closing', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
  }, { from: monthStart() });
  root.replaceChildren(pageHead('ميزان المراجعة'), fb, host); fb.run();
}
export async function ledgerPage(root, params) {
  const host = h('div');
  const fb = filterBar([{ k: 'account_id', l: 'الحساب', t: 'fk', ref: 'accounts', combo: true, req: 1 }, { k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'project_id', l: 'مشروع', t: 'fk', ref: 'projects', combo: true }], async (v) => {
    if (!v.account_id) { host.replaceChildren(h('div.empty-state', 'اختر الحساب')); return; }
    const d = await GET('/reports/ledger', v);
    host.replaceChildren(h('div.kpis', kpi('رصيد أول', fmt(d.opening)), kpi('الرصيد الختامي', fmt(d.closing))),
      table({ name: 'أستاذ ' + d.account.name, compact: true, rows: [{ date: v.from || '', description: 'رصيد أول المدة', balance: d.opening }, ...d.rows], cols: [{ k: 'date', l: 'التاريخ' }, { k: 'no', l: 'القيد' }, { k: 'description', l: 'البيان', text: (r) => r.line_desc || r.description }, { k: 'debit', l: 'مدين', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'credit', l: 'دائن', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'balance', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
  }, { account_id: params.account_id ? Number(params.account_id) : null, from: params.from || monthStart(), to: params.to || '' });
  root.replaceChildren(pageHead('أستاذ الحساب'), fb, host); if (params.account_id) fb.run();
}
export async function incomePage(root) {
  const host = h('div');
  const t = (rows) => table({ search: false, compact: true, name: 'قائمة الدخل', rows, cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'الحساب' }, { k: 'amount', l: 'المبلغ', num: true, fmt: (n) => fmt(n) }] });
  const fb = filterBar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }], async (v) => {
    const d = await GET('/reports/income-summary', v);
    host.replaceChildren(h('div.kpis', kpi('الإيرادات', fmt(d.total_revenue)), kpi('المصروفات', fmt(d.total_expenses)), kpi('صافي الربح/الخسارة', fmt(d.net), '', d.net < 0 ? 'bad' : '')), h('div.grid2', card('الإيرادات', t(d.revenue)), card('المصروفات', t(d.expenses))));
  }, { from: monthStart() });
  root.replaceChildren(pageHead('قائمة الدخل المبسطة'), h('div.note', 'تُحسب من القيود: تكلفة المنتج تحت التشغيل تبقى أصل (WIP) إلى أن تُنقل للتكلفة عند البيع (مرحلة المنتجات التامة لاحقاً).'), fb, host); fb.run();
}
