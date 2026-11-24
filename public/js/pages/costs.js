import { h, GET, PUT, POST, L, META, can, fmt, fq, today, table, filterBar, formGrid, pageHead, card, kpi, badge, modal, toast, guard, confirmBox, nameOf } from '../core.js';
import { barChart } from '../charts.js';

const curMonth = () => today().slice(0, 7);
// اسم الصنف كرابط لكارت الصنف
const matLink = (id, name) => (id ? h('a', { href: `#/inventory/stock-card?material_id=${id}`, title: 'فتح كارت الصنف' }, name) : name);
const blank = (v) => (v === null || v === undefined ? '—' : fmt(v));

// ---------- جدول مرحلة (صب / تشطيب): أصناف + أجور + مرتبات ----------
function stageTable(b, { perBag = false, bags = 0 } = {}) {
  if (!b) return card('المرحلة غير مربوطة', h('div.note.bad', 'اربط المرحلة من زر «ربط المراحل والأسمنت».'));
  const rows = [
    ...b.materials.map((m) => ({ k: 'm', material_id: m.material_id, name: m.name, unit: m.unit, qty: m.qty, per_bag: m.per_bag, amount: m.amount })),
    { k: 't', name: 'إجمالي الأصناف', amount: b.mat_total },
    { k: 'l', name: 'أجور العمال (يوميات)', amount: b.labor_daily },
    { k: 'l', name: 'المرتبات الشهرية', amount: b.labor_monthly },
    ...(b.expense ? [{ k: 'l', name: 'مصروفات مباشرة على المرحلة', amount: b.expense }] : []),
    { k: 'g', name: `إجمالي تكلفة مرحلة ${b.name}`, amount: b.total },
    { k: 'g', name: `تكلفة المتر المسطح — ${b.name}`, amount: b.per_m2, bold: true },
  ];
  const cols = [{ k: 'name', l: 'البند', render: (r) => (r.k === 'm' ? matLink(r.material_id, r.name) : r.name), text: (r) => r.name }, { k: 'unit', l: 'الوحدة' }, { k: 'qty', l: 'الكمية', num: true, fmt: (v) => fq(v) }];
  if (perBag) cols.push({ k: 'per_bag', l: 'معيار الشيكارة', num: true, fmt: (v) => (v === null || v === undefined ? '' : fq(Math.round(v * 10000) / 10000)) });
  cols.push({ k: 'amount', l: 'الإجمالي', num: true, fmt: (v) => blank(v) });
  return card(`مرحلة ${b.name}`, table({ cols, rows, search: false, compact: true, name: `تكلفة ${b.name}`, rowClass: (r) => (r.k === 'g' ? 'tot' : r.k === 't' ? 'sub' : '') }));
}

// ---------- ربط المراحل والأسمنت (تبويب مستقل — الوحدة المعيارية: شيكارة 50 كجم) ----------
export async function configPage(root) {
  const c = await GET('/costs/config'); const canEdit = can('costs.config.edit');
  const f = formGrid([
    { k: 'cast_stage_id', l: 'مرحلة الصب', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, req: 1, readonly: !canEdit }, { k: 'finish_stage_id', l: 'مرحلة التشطيب', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, req: 1, readonly: !canEdit },
    { k: 'mold_stage_id', l: 'مرحلة القوالب (على المشروع)', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, readonly: !canEdit }], c, 3);
  const rows = c.cement_candidates.map((m) => ({ m, cb: h('input', { type: 'checkbox', checked: m.selected, disabled: !canEdit }), kg: h('input', { type: 'number', step: 'any', min: 0, value: m.kg, disabled: !canEdit, style: { width: '90px' } }) }));
  const save = guard(async () => {
    const sel = rows.filter((r) => r.cb.checked); const all = sel.length === rows.length;
    await PUT('/costs/config', { ...f.values(), cement_material_ids: all ? [] : sel.map((r) => r.m.id), cement_kg: Object.fromEntries(rows.map((r) => [r.m.id, Number(r.kg.value)])) }); toast('تم الحفظ');
  });
  root.replaceChildren(pageHead('ربط المراحل والأسمنت'),
    card('المراحل', f.el),
    card('أصناف الأسمنت المحسوبة في المتر المنتج (الوحدة المعيارية شيكارة 50 كجم)', rows.length
      ? h('table.tbl.compact', h('thead', h('tr', ['', 'الصنف', 'وزن الوحدة (كجم)'].map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr', h('td', r.cb), h('td', r.m.name, r.m.kg_guessed ? h('span.badge.warn', { style: { marginInlineStart: '8px' } }, 'الوزن متخمّن — راجعه') : null), h('td', r.kg)))))
      : h('div', 'لا توجد أصناف اسمها فيه «اسمنت». لإضافة صنف جديد: الإعدادات ← الأصناف، واكتب «اسمنت» في الاسم مع الوزن (مثال: اسمنت ابيض *50ك).')),
    rows.some((r) => r.m.kg_guessed) ? h('div.note.bad', '⚠ في أصناف أسمنت وزنها متخمّن 50 كجم لأنه مش مكتوب في الاسم ولا محفوظ هنا. لو الوزن مختلف عدّله واضغط حفظ، لأنه بيأثر على عدد الشكاير وسعر المتر.') : null,
    canEdit ? h('div', { style: { marginTop: '12px' } }, h('button.btn.primary', { onclick: save }, 'حفظ')) : null);
}

// ---------- تكلفة المتر GRC / GRP (شهرياً) ----------
export async function unitCostPage(root, params = {}) {
  const host = h('div');
  let cur = { month: params.month || curMonth(), kind: params.kind === 'GRP' ? 'GRP' : 'GRC', project_id: params.project_id ? Number(params.project_id) : null };
  const bar = filterBar([{ k: 'month', l: 'الشهر', t: 'month', req: 1 }, { k: 'spread_rate', l: 'معدل فرد الشيكارة (م² / شيكارة)', t: 'number', step: '0.01' }, { k: 'kind', l: 'GRC / GRP', t: 'select', options: [['GRC', 'GRC'], ['GRP', 'GRP']], def: cur.kind }, { k: 'project_id', l: 'عرض مشروع محدد (اختياري — للاعتماد اتركه فاضي)', t: 'fk', ref: 'projects', combo: true }],
    async (v) => { cur = { month: v.month || curMonth(), kind: v.kind || 'GRC', project_id: v.project_id || null }; await load(); }, { month: cur.month, kind: cur.kind, project_id: cur.project_id });
  bar.append(h('button.btn', { onclick: () => window.print() }, '🖨 طباعة'));
  const rateEl = () => bar.querySelectorAll('label.fld')[1]?.querySelector('input');
  const rateVal = () => { const v = rateEl()?.value; return v === '' || v === undefined ? 0 : Number(v); };
  const saveBtn = h('button.btn.primary', { onclick: () => doSave() }, 'حفظ');
  { const lab = bar.querySelectorAll('label.fld')[1], inp = lab.querySelector('input'); const row = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }); inp.replaceWith(row); row.append(inp, saveBtn); inp.style.flex = '1'; }
  const q = () => ({ month: cur.month, kind: cur.kind, project_id: cur.project_id || 0 });
  const load = async () => draw(await GET('/costs/sheet', q()));
  const call = (fn) => guard(async () => { draw(await fn()); });
  let doSave = () => {};

  const draw = (s) => {
    const pv = !!s.project_view; const approved = s.status === 'approved' || pv; const i = s.inputs;
    { const el = rateEl(); if (el) { el.value = i.spread_rate || ''; el.disabled = approved; el.onkeydown = (e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); doSave(); } }; } }
    const body = () => ({ ...q(), spread_rate: rateVal() });
    doSave = guard(async () => { const typed = rateEl()?.value; draw(await PUT('/costs/period', body())); const el = rateEl(); if (el && el.value === '' && typed) el.value = typed; });
    saveBtn.style.display = !approved && !pv && can('costs.unit-cost.save') ? '' : 'none';
    const acts = [
      !approved && !pv && can('costs.unit-cost.approve') ? h('button.btn.primary', { onclick: guard(async () => { if (!(await confirmBox(`اعتماد سعر المتر لشهر ${s.month}؟ بعد الاعتماد بيتثبّت السعر ولا يتأثر بأي تعديل لاحق.`, 'اعتماد'))) return; await PUT('/costs/period', body()); draw(await POST('/costs/approve', q())); toast('تم اعتماد سعر المتر'); }) }, '✔ اعتماد الشهر') : null,
      approved && !pv && can('costs.unit-cost.reopen') ? h('button.btn', { onclick: guard(async () => { if (await confirmBox('إعادة فتح الشهر بتلغي السعر المعتمد وتعيد الحساب من الأرقام الحالية. متأكد؟', 'إعادة فتح', true)) draw(await POST('/costs/reopen', q())); }) }, 'إعادة فتح') : null,
    ];
    const u = s.unit_cost;
    host.replaceChildren(
      h('div.row', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' } },
        pv ? badge(s.status === 'approved_view' ? 'الشهر معتمد' : s.status === 'new' ? 'الشهر لم يُحفظ بعد' : 'الشهر مسودة', 'info') : pv ? badge(s.status === 'approved_view' ? 'الشهر معتمد' : s.status === 'new' ? 'الشهر لم يُحفظ بعد' : 'الشهر مسودة', 'info') : approved ? badge(`معتمد ${s.approved_at || ''}`, 'ok') : badge(s.status === 'new' ? 'لم يُحفظ بعد' : 'مسودة', 'warn'), s.project_id ? badge(`مشروع: ${nameOf('projects', s.project_id)}`, 'info') : badge('كل المشاريع', '')),
      pv ? h('div.note', 'عرض تحليلي لمشروع واحد: معدل فرد الشيكارة هو معدل الشهر الواحد لكل المشروعات، والاعتماد يتم على مستوى الشهر (بدون اختيار مشروع).') : null,
      approved && s.drift ? h('div.note.bad', `تنبيه: الأرقام الحالية اختلفت عن وقت الاعتماد (السعر الحالي ${blank(s.live_unit_cost?.total)} مقابل المعتمد ${blank(u.total)}) — السعر المعتمد لسه ثابت. أعد فتح الشهر لو عايز تحدّثه.`) : null,
      h('div.kpis', kpi('شكاير الأسمنت للصب (معيارية 50 كجم)', fq(i.bags), 'من المنصرف بالنظام'), kpi('معدل فرد الشيكارة', i.spread_rate ? fq(i.spread_rate) : '—', 'م² / شيكارة'),
        kpi('المتر المسطح المنتج', i.area ? fmt(i.area) : '—', 'م²'), kpi('تكلفة الصب / م²', blank(u.cast)), kpi('تكلفة التشطيب / م²', blank(u.finish)), kpi('سعر المتر الإجمالي', blank(u.total), 'صب + تشطيب', 'ok')),
      i.cement_lines?.some((x) => x.kg_guessed) ? h('div.note.bad', '⚠ وزن الوحدة متخمّن (50 كجم) للأصناف: ' + i.cement_lines.filter((x) => x.kg_guessed).map((x) => x.name).join('، ') + ' — راجعه من «ربط المراحل والأسمنت» لأنه بيأثر على المتر المنتج.') : null,
      i.cement_lines?.length ? card('أسمنت الصب محوّل لشكاير 50 كجم', table({ name: 'أسمنت الصب', search: false, compact: true, rows: i.cement_lines, cols: [{ k: 'name', l: 'الصنف', render: (r) => matLink(r.material_id, r.name), text: (r) => r.name }, { k: 'qty', l: 'الكمية المصروفة', num: true, fmt: (v) => fq(v) }, { k: 'kg', l: 'وزن الوحدة (كجم)', num: true, fmt: (v) => fq(v) }, { k: 'std_bags', l: 'ما يعادل شكاير 50 كجم', num: true, fmt: (v) => fq(v) }], foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'std_bags' ? fq(i.bags_system) : '') })) : null,
      h('div.chart-grid', stageTable(s.cast, { perBag: true }), stageTable(s.finish)),
      card(`مرحلة ${s.mold?.name || 'القوالب'} — محمّلة على المشروع (لا تدخل في سعر المتر)`, s.mold ? table({ name: 'القوالب', search: false, compact: true, rows: s.mold.by_project,
        cols: [{ k: 'name', l: 'المشروع' }, { k: 'material', l: 'أصناف', num: true, fmt: (v) => fmt(v) }, { k: 'labor', l: 'عمالة', num: true, fmt: (v) => fmt(v) }, { k: 'expense', l: 'مصروفات', num: true, fmt: (v) => fmt(v) }, { k: 'direct', l: 'مباشر', num: true, fmt: (v) => fmt(v) }, { k: 'allocated', l: 'موزّع من «غير محدد»', num: true, fmt: (v) => (v ? fmt(v) : '') }, { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }],
        foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'total' ? fmt(s.mold.total) : ''), empty: 'لا توجد تكاليف قوالب في هذا الشهر' }) : h('div.note', 'مرحلة القوالب غير مربوطة.')),
      s.mold?.allocated_unassigned ? h('div.note', 'تكلفة القوالب اللي من غير مشروع اتوزعت على المشروعات بنسبة تكلفة قوالب كل مشروع من إجمالي الشهر.') : null,
      acts.some(Boolean) ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '14px 0' } }, acts) : null,
    );
  };
  root.replaceChildren(h('div.print-only.print-head', h('div.ph-co', META.settings?.company_logo ? h('img.ph-logo', { src: META.settings.company_logo }) : null, META.settings?.company_name || ''), h('div.ph-title', 'تكلفة المتر GRC / GRP')), pageHead('تكلفة المتر GRC / GRP'), bar, host);
  await load();
}
unitCostPage.newInfo = null;

// ---------- سجل أسعار المتر ----------
export async function historyPage(root) {
  const host = h('div');
  const bar = filterBar([{ k: 'from', l: 'من شهر', t: 'month' }, { k: 'to', l: 'إلى شهر', t: 'month' }], async (v) => {
    const rows = await GET('/costs/history', { from: v.from, to: v.to });
    host.replaceChildren(
      card('سعر المتر الإجمالي لكل شهر', barChart(rows.filter((r) => r.unit_cost).map((r) => ({ label: r.month + ' ' + (r.kind || 'GRC') + (r.project_id ? ` — ${r.project_name}` : ''), value: r.unit_cost })), { max: 12 })),
      table({ name: 'سجل أسعار المتر', rows, compact: true,
        cols: [{ k: 'month', l: 'الشهر', render: (r) => h('a', { href: `#/costs/unit-cost?month=${r.month}&kind=${r.kind || 'GRC'}${r.project_id ? '&project_id=' + r.project_id : ''}` }, r.month) , text: (r) => r.month }, { k: 'kind', l: 'النوع' }, { k: 'project_name', l: 'النطاق' },
          { k: 'status', l: 'الحالة', render: (r) => (r.status === 'approved' ? badge(r.drift ? 'معتمد — الأرقام اختلفت' : 'معتمد', r.drift ? 'warn' : 'ok') : badge('مسودة', 'warn')), text: (r) => (r.status === 'approved' ? 'معتمد' : 'مسودة') },
          { k: 'bags', l: 'الشكاير', num: true, fmt: (v) => fq(v) }, { k: 'spread_rate', l: 'معدل الفرد', num: true, fmt: (v) => fq(v) }, { k: 'area', l: 'المتر المنتج', num: true, fmt: (v) => fmt(v) },
          { k: 'cast_total', l: 'تكلفة الصب', num: true, fmt: (v) => fmt(v) }, { k: 'finish_total', l: 'تكلفة التشطيب', num: true, fmt: (v) => fmt(v) },
          { k: 'cast_per_m2', l: 'صب / م²', num: true, fmt: blank }, { k: 'finish_per_m2', l: 'تشطيب / م²', num: true, fmt: blank }, { k: 'unit_cost', l: 'سعر المتر', num: true, fmt: blank }, { k: 'mold_total', l: 'قوالب (على المشروع)', num: true, fmt: (v) => fmt(v) }] }));
  }, {});
  root.replaceChildren(pageHead('سجل أسعار المتر'), bar, host);
  bar.run();
}

// ---------- تكاليف مشروعات (تبويب مبدئي — المحتوى لاحقاً) ----------
export async function projectsCostPage(root) {
  root.replaceChildren(pageHead('تكاليف مشروعات'), card('قيد التجهيز', h('div.note', 'التبويب ده متخصص لتكاليف المشروعات — هنحدد محتواه في خطوة جاية.')));
}
