import { h, GET, fmt, kpi, card, pageHead, table } from '../core.js';
const bars = (rows) => { const mx = Math.max(1, ...rows.map((r) => r.amt)); return h('div', rows.length ? rows.map((r) => h('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr 110px', gap: '10px', alignItems: 'center', margin: '8px 0' } }, h('span', r.name), h('div.bar', h('i', { style: { width: (r.amt / mx * 100) + '%' } })), h('b', { style: { textAlign: 'left' } }, fmt(r.amt)))) : h('div.empty-state', 'لا توجد بيانات بعد')); };
export async function dashboardPage(root) {
  const d = await GET('/reports/dashboard'); const cash = d.treasuries.reduce((s, t) => s + t.balance, 0); const mc = Object.fromEntries(d.month_cost.map((x) => [x.cost_type, x.amt]));
  root.replaceChildren(pageHead('لوحة التحكم'),
    h('div.kpis', kpi('قيمة المخزون', fmt(d.stock_value), d.low_stock ? `${d.low_stock} صنف تحت الحد الأدنى` : '', d.low_stock ? 'warn' : ''), kpi('النقدية والبنوك', fmt(cash)), kpi('مستحق للموردين', fmt(d.ap_total), d.overdue_ap ? `متأخر: ${fmt(d.overdue_ap)}` : '', d.overdue_ap ? 'warn' : ''), kpi('عهد بذمة أصحابها', fmt(d.custody)),
      kpi(`تكلفة ${d.month}`, fmt((mc.material || 0) + (mc.labor || 0) + (mc.expense || 0)), `خامات ${fmt(mc.material || 0)} · عمالة ${fmt(mc.labor || 0)} · مصروفات ${fmt(mc.expense || 0)}`)),
    h('div.grid2', card('التكلفة حسب المرحلة (كل المشاريع)', bars(d.by_stage)), card('أعلى المشروعات تكلفة', bars(d.top_projects))),
    card('الخزن والبنوك', table({ search: false, rows: d.treasuries, cols: [{ k: 'name', l: 'الخزينة' }, { k: 'balance', l: 'الرصيد', num: true, fmt: (v) => fmt(v) }] })));
}
