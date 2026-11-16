import { h, GET, fmt, fq, kpi, card, pageHead } from '../core.js';
const bars = (rows) => { const mx = Math.max(1, ...rows.map((r) => r.amt)); return h('div', rows.length ? rows.map((r) => h('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr 110px', gap: '10px', alignItems: 'center', margin: '8px 0' } }, h('span', r.name), h('div.bar', h('i', { style: { width: (r.amt / mx * 100) + '%' } })), h('b', { style: { textAlign: 'left' } }, fmt(r.amt)))) : h('div.empty-state', 'لا توجد بيانات بعد')); };
function lowStockCard(items) {
  let all = false; const host = h('div');
  const row = (x) => { const col = x.pct <= 25 ? 'var(--bad, #dc2626)' : x.pct <= 60 ? 'var(--warn, #d97706)' : 'var(--ok, #16a34a)';
    return h('div', { style: { background: 'var(--bg, #f1f5f9)', borderRadius: '12px', padding: '10px 14px', margin: '8px 0' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px' } }, h('b', x.name), h('span.muted', `${fq(x.qty)} / ${fq(x.min_qty)} ${x.unit || ''}`)),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } }, h('b', { style: { color: col, minWidth: '42px' } }, x.pct + '%'), h('div.bar', { style: { flex: '1' } }, h('i', { style: { width: Math.min(100, x.pct) + '%', background: col } })))); };
  const more = h('button.btn', { onclick: () => { all = !all; draw(); } });
  const draw = () => { const list = all ? items : items.slice(0, 5);
    host.replaceChildren(...(list.length ? list.map(row) : [h('div.empty-state', 'لا توجد أصناف بحد أدنى')]));
    more.textContent = all ? 'أقل' : 'مزيد'; more.style.display = items.length > 5 ? '' : 'none'; };
  draw();
  const c = card('تنبيهات المخزون', host); const head = c.firstChild; if (head && head.appendChild) { head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.alignItems = 'center'; head.appendChild(more); } else c.appendChild(more);
  return c;
}
export async function dashboardPage(root) {
  const d = await GET('/reports/dashboard'); const mc = Object.fromEntries(d.month_cost.map((x) => [x.cost_type, x.amt]));
  root.replaceChildren(pageHead('لوحة التحكم'),
    h('div.kpis', kpi('قيمة المخزون', fmt(d.stock_value), d.low_stock ? `${d.low_stock} صنف تحت الحد الأدنى` : '', d.low_stock ? 'warn' : ''), kpi('مستحق للموردين', fmt(d.ap_total), d.overdue_ap ? `متأخر: ${fmt(d.overdue_ap)}` : '', d.overdue_ap ? 'warn' : ''), kpi('رصيد عهد', fmt(d.custody)),
      kpi(`تكلفة ${d.month}`, fmt((mc.material || 0) + (mc.labor || 0) + (mc.expense || 0)), `خامات ${fmt(mc.material || 0)} · عمالة ${fmt(mc.labor || 0)} · مصروفات ${fmt(mc.expense || 0)}`)),
    h('div.grid2', card('التكلفة حسب المرحلة (كل المشاريع)', bars(d.by_stage)), card('أعلى المشروعات تكلفة', bars(d.top_projects))),
    lowStockCard(d.low_items || []));
}
