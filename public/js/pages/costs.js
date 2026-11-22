import { h, GET, PUT, POST, L, META, can, fmt, fq, today, table, filterBar, formGrid, pageHead, card, kpi, badge, modal, toast, guard, confirmBox, nameOf } from '../core.js';
import { barChart } from '../charts.js';

const curMonth = () => today().slice(0, 7);
const blank = (v) => (v === null || v === undefined ? '—' : fmt(v));

// ---------- جدول مرحلة (صب / تشطيب): خامات + أجور + مرتبات ----------
function stageTable(b, { perBag = false, bags = 0 } = {}) {
  if (!b) return card('المرحلة غير مربوطة', h('div.note.bad', 'اربط المرحلة من زر «ربط المراحل والأسمنت».'));
  const rows = [
    ...b.materials.map((m) => ({ k: 'm', name: m.name, unit: m.unit, qty: m.qty, per_bag: m.per_bag, amount: m.amount })),
    { k: 't', name: 'إجمالي الخامات', amount: b.mat_total },
    { k: 'l', name: 'أجور العمال (يوميات)', amount: b.labor_daily },
    { k: 'l', name: 'المرتبات الشهرية', amount: b.labor_monthly },
    ...(b.expense ? [{ k: 'l', name: 'مصروفات مباشرة على المرحلة', amount: b.expense }] : []),
    { k: 'g', name: `إجمالي تكلفة مرحلة ${b.name}`, amount: b.total },
    { k: 'g', name: `تكلفة المتر المسطح — ${b.name}`, amount: b.per_m2, bold: true },
  ];
  const cols = [{ k: 'name', l: 'البند' }, { k: 'unit', l: 'الوحدة' }, { k: 'qty', l: 'الكمية', num: true, fmt: (v) => fq(v) }];
  if (perBag) cols.push({ k: 'per_bag', l: 'معيار الشيكارة', num: true, fmt: (v) => (v === null || v === undefined ? '' : fq(Math.round(v * 10000) / 10000)) });
  cols.push({ k: 'amount', l: 'الإجمالي', num: true, fmt: (v) => blank(v) });
  return card(`مرحلة ${b.name}`, table({ cols, rows, search: false, compact: true, name: `تكلفة ${b.name}`, rowClass: (r) => (r.k === 'g' ? 'tot' : r.k === 't' ? 'sub' : '') }));
}

// ---------- ربط المراحل والأسمنت ----------
function configModal(onSaved) {
  GET('/costs/config').then((c) => {
    const f = formGrid([
      { k: 'cast_stage_id', l: 'مرحلة الصب', t: 'fk', ref: 'stages', req: 1 }, { k: 'finish_stage_id', l: 'مرحلة التشطيب', t: 'fk', ref: 'stages', req: 1 },
      { k: 'mold_stage_id', l: 'مرحلة القوالب (على المشروع)', t: 'fk', ref: 'stages' },
      { k: 'cement_material_id', l: 'خامة الأسمنت (المقاس بها الإنتاج)', t: 'fk', ref: 'materials', combo: true, help: 'لو فاضية: النظام بيختار أكتر صنف «اسمنت» صرفاً للصب في الشهر.' },
    ], c, 1);
    modal({ title: 'ربط المراحل والأسمنت', body: f.el, buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => { await PUT('/costs/config', f.values()); toast('تم الحفظ'); onSaved(); } }, { label: 'إلغاء' }] });
  });
}

// ---------- سعر المتر الشهري ----------
export async function unitCostPage(root, params = {}) {
  const host = h('div');
  let cur = { month: params.month || curMonth(), project_id: params.project_id ? Number(params.project_id) : null };
  const bar = filterBar([{ k: 'month', l: 'الشهر', t: 'month', req: 1 }, { k: 'project_id', l: 'المشروع (اختياري — الافتراضي كل المشاريع)', t: 'fk', ref: 'projects', combo: true }],
    async (v) => { cur = { month: v.month || curMonth(), project_id: v.project_id || null }; await load(); }, { month: cur.month, project_id: cur.project_id });
  const q = () => ({ month: cur.month, project_id: cur.project_id || 0 });
  const load = async () => draw(await GET('/costs/sheet', q()));
  const call = (fn) => guard(async () => { draw(await fn()); });

  const draw = (s) => {
    const approved = s.status === 'approved'; const i = s.inputs;
    const f = formGrid([
      { k: 'cement_material_id', l: 'خامة الأسمنت', t: 'fk', ref: 'materials', combo: true, readonly: approved },
      { k: 'bags_override', l: `عدد الشكاير (بالنظام: ${fq(i.bags_system)}) — اتركه فاضي لاستخدام رقم النظام`, t: 'number', readonly: approved },
      { k: 'spread_rate', l: 'معدل فرد الشيكارة (م² / شيكارة) — يدوي', t: 'number', step: '0.01', req: 1, readonly: approved },
      { k: 'notes', l: 'ملاحظات', t: 'text', readonly: approved, wide: true },
    ], { cement_material_id: i.cement_material_id, bags_override: i.bags_override, spread_rate: i.spread_rate || '', notes: s.notes }, 2);
    const body = () => ({ ...q(), ...f.values() });
    const acts = [
      !approved && can('costs.unit-cost.save') ? h('button.btn.primary', { onclick: call(() => PUT('/costs/period', body())) }, 'حفظ وحساب') : null,
      !approved && can('costs.unit-cost.approve') ? h('button.btn', { onclick: guard(async () => { if (!(await confirmBox(`اعتماد سعر المتر لشهر ${s.month}؟ بعد الاعتماد بيتثبّت السعر ولا يتأثر بأي تعديل لاحق.`, 'اعتماد'))) return; await PUT('/costs/period', body()); draw(await POST('/costs/approve', q())); toast('تم اعتماد سعر المتر'); }) }, '✔ اعتماد الشهر') : null,
      approved && can('costs.unit-cost.reopen') ? h('button.btn', { onclick: guard(async () => { if (await confirmBox('إعادة فتح الشهر بتلغي السعر المعتمد وتعيد الحساب من الأرقام الحالية. متأكد؟', 'إعادة فتح', true)) draw(await POST('/costs/reopen', q())); }) }, 'إعادة فتح') : null,
      can('costs.unit-cost.config') ? h('button.btn', { onclick: () => configModal(load) }, '⚙ ربط المراحل والأسمنت') : null,
      h('button.btn', { onclick: () => window.print() }, '🖨 طباعة'),
    ];
    const u = s.unit_cost;
    host.replaceChildren(
      h('div.row', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' } },
        approved ? badge(`معتمد ${s.approved_at || ''}`, 'ok') : badge(s.status === 'new' ? 'لم يُحفظ بعد' : 'مسودة', 'warn'), s.project_id ? badge(`مشروع: ${nameOf('projects', s.project_id)}`, 'info') : badge('كل المشاريع', '')),
      approved && s.drift ? h('div.note.bad', `تنبيه: الأرقام الحالية اختلفت عن وقت الاعتماد (السعر الحالي ${blank(s.live_unit_cost?.total)} مقابل المعتمد ${blank(u.total)}) — السعر المعتمد لسه ثابت. أعد فتح الشهر لو عايز تحدّثه.`) : null,
      h('div.kpis', kpi('شكاير الأسمنت للصب', fq(i.bags), i.bags_override !== null && i.bags_override !== undefined ? 'رقم يدوي' : 'من المنصرف بالنظام'), kpi('معدل فرد الشيكارة', i.spread_rate ? fq(i.spread_rate) : '—', 'م² / شيكارة'),
        kpi('المتر المسطح المنتج', i.area ? fmt(i.area) : '—', 'م²'), kpi('تكلفة الصب / م²', blank(u.cast)), kpi('تكلفة التشطيب / م²', blank(u.finish)), kpi('سعر المتر الإجمالي', blank(u.total), 'صب + تشطيب', 'ok')),
      card('مدخلات الشهر', f.el, h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, acts)),
      !i.area ? h('div.note', 'أدخل معدل فرد الشيكارة واضغط «حفظ وحساب» عشان يظهر المتر المنتج وتكلفة المتر.') : null,
      h('div.chart-grid', stageTable(s.cast, { perBag: true }), stageTable(s.finish)),
      card(`مرحلة ${s.mold?.name || 'القوالب'} — محمّلة على المشروع (لا تدخل في سعر المتر)`, s.mold ? table({ name: 'القوالب', search: false, compact: true, rows: s.mold.by_project,
        cols: [{ k: 'name', l: 'المشروع' }, { k: 'material', l: 'خامات', num: true, fmt: (v) => fmt(v) }, { k: 'labor', l: 'عمالة', num: true, fmt: (v) => fmt(v) }, { k: 'expense', l: 'مصروفات', num: true, fmt: (v) => fmt(v) }, { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }],
        foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'total' ? fmt(s.mold.total) : ''), empty: 'لا توجد تكاليف قوالب في هذا الشهر' }) : h('div.note', 'مرحلة القوالب غير مربوطة.')),
    );
  };
  root.replaceChildren(pageHead('سعر المتر الشهري'), h('div.note', 'تكلفة المتر لكل مرحلة = إجمالي تكلفة المرحلة في الشهر ÷ المتر المسطح المنتج، والمتر المنتج = شكاير الأسمنت المصروفة للصب × معدل فرد الشيكارة. الأرقام بتتسحب تلقائياً من الصرف واليوميات والرواتب.'), bar, host);
  await load();
}
unitCostPage.newInfo = null;

// ---------- سجل أسعار المتر ----------
export async function historyPage(root) {
  const host = h('div');
  const bar = filterBar([{ k: 'from', l: 'من شهر', t: 'month' }, { k: 'to', l: 'إلى شهر', t: 'month' }], async (v) => {
    const rows = await GET('/costs/history', { from: v.from, to: v.to });
    host.replaceChildren(
      card('سعر المتر الإجمالي لكل شهر', barChart(rows.filter((r) => r.unit_cost).map((r) => ({ label: r.month + (r.project_id ? ` — ${r.project_name}` : ''), value: r.unit_cost })), { max: 12 })),
      table({ name: 'سجل أسعار المتر', rows, compact: true,
        cols: [{ k: 'month', l: 'الشهر', render: (r) => h('a', { href: `#/costs/unit-cost?month=${r.month}${r.project_id ? '&project_id=' + r.project_id : ''}` }, r.month) , text: (r) => r.month }, { k: 'project_name', l: 'النطاق' },
          { k: 'status', l: 'الحالة', render: (r) => (r.status === 'approved' ? badge(r.drift ? 'معتمد — الأرقام اختلفت' : 'معتمد', r.drift ? 'warn' : 'ok') : badge('مسودة', 'warn')), text: (r) => (r.status === 'approved' ? 'معتمد' : 'مسودة') },
          { k: 'bags', l: 'الشكاير', num: true, fmt: (v) => fq(v) }, { k: 'spread_rate', l: 'معدل الفرد', num: true, fmt: (v) => fq(v) }, { k: 'area', l: 'المتر المنتج', num: true, fmt: (v) => fmt(v) },
          { k: 'cast_total', l: 'تكلفة الصب', num: true, fmt: (v) => fmt(v) }, { k: 'finish_total', l: 'تكلفة التشطيب', num: true, fmt: (v) => fmt(v) },
          { k: 'cast_per_m2', l: 'صب / م²', num: true, fmt: blank }, { k: 'finish_per_m2', l: 'تشطيب / م²', num: true, fmt: blank }, { k: 'unit_cost', l: 'سعر المتر', num: true, fmt: blank }, { k: 'mold_total', l: 'قوالب (على المشروع)', num: true, fmt: (v) => fmt(v) }] }));
  }, {});
  root.replaceChildren(pageHead('سجل أسعار المتر'), bar, host);
  bar.run();
}
