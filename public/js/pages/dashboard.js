import { h, GET, PUT, META, APP, modal, toast, fmt, fq, kpi, card, pageHead } from '../core.js';
const DEFAULT_SHORTCUTS = ['inventory/issues?new=1', 'purchases/invoices?new=1', 'finance/expenses?new=1', 'reports/hub'];
const savedShortcuts = () => { try { const v = JSON.parse(META.me.shortcuts || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
function quickAccessCard() {
  const host = h('div');
  const draw = () => {
    const cat = APP.catalog(); const byKey = Object.fromEntries(cat.map((c) => [c.key, c]));
    const keys = savedShortcuts() ?? DEFAULT_SHORTCUTS; const items = keys.map((k) => byKey[k]).filter(Boolean);
    host.replaceChildren(items.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } }, items.map((c) => h('a.btn' + (c.isNew ? '.primary' : ''), { href: c.href }, (c.isNew ? '＋ ' : '') + c.label.replace(/^＋\s*/, ''))))
      : h('div.empty-state', 'لا توجد اختصارات — اضغط «تخصيص» لإضافة الصفحات والأزرار اللي بتستخدمها كتير'));
  };
  const edit = () => {
    const cat = APP.catalog(); const chosen = new Set(savedShortcuts() ?? DEFAULT_SHORTCUTS); const groups = [...new Set(cat.map((c) => c.group))];
    const body = h('div', { style: { maxHeight: '60vh', overflow: 'auto' } }, h('div.note', 'علّم على الصفحات والأزرار اللي عايزها تظهر في «وصول سريع». زر «＋ جديد» بيفتح الشاشة على مستند جديد مباشرة.'),
      groups.map((g) => h('div', { style: { margin: '12px 0' } }, h('b', g), h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '6px', marginTop: '6px' } },
        cat.filter((c) => c.group === g).map((c) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: chosen.has(c.key), onchange: (e) => { e.target.checked ? chosen.add(c.key) : chosen.delete(c.key); } }), c.isNew ? `＋ ${c.label}` : c.label))))));
    modal({ title: 'تخصيص الوصول السريع', wide: true, body, buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => {
      const list = cat.map((c) => c.key).filter((k) => chosen.has(k)); await PUT('/me/shortcuts', { shortcuts: list }); META.me.shortcuts = JSON.stringify(list); draw(); toast('تم حفظ الوصول السريع'); } }] });
  };
  draw();
  const c = card('وصول سريع', host); const head = c.firstChild;
  const btn = h('button.btn.sm', { onclick: edit }, '⚙ تخصيص');
  if (head && head.appendChild) { head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.alignItems = 'center'; head.appendChild(btn); } else c.append(btn);
  return c;
}
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
  root.replaceChildren(pageHead('لوحة التحكم'), quickAccessCard(),
    h('div.kpis', kpi('قيمة المخزون', fmt(d.stock_value), d.low_stock ? `${d.low_stock} صنف تحت الحد الأدنى` : '', d.low_stock ? 'warn' : ''), kpi('مستحق للموردين', fmt(d.ap_total), d.overdue_ap ? `متأخر: ${fmt(d.overdue_ap)}` : '', d.overdue_ap ? 'warn' : ''), kpi('رصيد عهد', fmt(d.custody)),
      kpi(`تكلفة ${d.month}`, fmt((mc.material || 0) + (mc.labor || 0) + (mc.expense || 0)), `خامات ${fmt(mc.material || 0)} · عمالة ${fmt(mc.labor || 0)} · مصروفات ${fmt(mc.expense || 0)}`)),
    h('div.grid2', card('التكلفة حسب المرحلة (كل المشاريع)', bars(d.by_stage)), card('أعلى المشروعات تكلفة', bars(d.top_projects))),
    lowStockCard(d.low_items || []));
}
