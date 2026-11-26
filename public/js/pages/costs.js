import { h, GET, PUT, POST, L, META, can, fieldInput, byId, fmt, fq, today, table, filterBar, formGrid, pageHead, card, kpi, badge, modal, toast, guard, confirmBox, nameOf } from '../core.js';
import { barChart } from '../charts.js';

const curMonth = () => today().slice(0, 7);
// اسم الصنف كرابط لكارت الصنف
const matLink = (id, name) => (id ? h('a', { href: `#/inventory/stock-card?material_id=${id}`, title: 'فتح كارت الصنف' }, name) : name);
const blank = (v) => (v === null || v === undefined ? '—' : fmt(v));

// ---------- جدول مرحلة (صب / تشطيب): أصناف + أجور + مرتبات ----------
function stageTable(b, { perBag = false, bags = 0, perCol = 'معيار الشيكارة' } = {}) {
  if (!b) return card('المرحلة غير مربوطة', h('div.note.bad', 'اربط المرحلة من زر «ربط المراحل والمواد».'));
  const rows = [
    ...b.materials.map((m) => ({ k: 'm', material_id: m.material_id, name: m.name, unit: m.unit, qty: m.qty, per_bag: m.per_bag, amount: m.amount })),
    { k: 't', name: 'إجمالي الأصناف', amount: b.mat_total },
    { k: 'l', name: 'أجور العمال (يوميات)', amount: b.labor_daily },
    { k: 'l', name: 'المرتبات الشهرية', amount: b.labor_monthly },
    ...(b.expense ? [{ k: 'l', name: 'مصروفات مباشرة على المرحلة', amount: b.expense }] : []),
    ...(b.auto_additives ? [{ k: 'l', name: 'مواد مضافة محسوبة تلقائياً (من الغير مباشر)', amount: b.auto_additives }] : []),
    { k: 'g', name: `إجمالي تكلفة مرحلة ${b.name}`, amount: b.total },
    { k: 'g', name: `تكلفة المتر المسطح — ${b.name}`, amount: b.per_m2, bold: true },
  ];
  const cols = [{ k: 'name', l: 'البند', render: (r) => (r.k === 'm' ? matLink(r.material_id, r.name) : r.name), text: (r) => r.name }, { k: 'unit', l: 'الوحدة' }, { k: 'qty', l: 'الكمية', num: true, fmt: (v) => fq(v) }];
  if (perBag) cols.push({ k: 'per_bag', l: perCol, num: true, fmt: (v) => (v === null || v === undefined ? '' : fq(Math.round(v * 10000) / 10000)) });
  cols.push({ k: 'amount', l: 'الإجمالي', num: true, fmt: (v) => blank(v) });
  return card(`مرحلة ${b.name}`, table({ cols, rows, search: false, compact: true, name: `تكلفة ${b.name}`, rowClass: (r) => (r.k === 'g' ? 'tot' : r.k === 't' ? 'sub' : '') }));
}

// ---------- ربط المراحل والمواد (تبويب مستقل): المراحل + أصناف أساس المتر المنتج لكل نوع منتج ----------
//  GRC: أسمنت (شيكارة 50 كجم) — GRP: بوليستر — GRG: جبس (Gypro وغيره)، وتقدر تضيف أي صنف تاني لأي نوع
export async function configPage(root, params = {}) {
  const canEdit = can('costs.config.edit'); let kind = params.kind || null;
  const host = h('div');
  const load = async () => {
    const c = await GET('/costs/config', kind ? { kind } : {}); kind = c.kind; const bm = c.basis_meta;
    const isG = String(kind).toUpperCase() === 'GRG';   // GRG: مرحلة واحدة (صب GRG) بدون تشطيب
    const f = formGrid(isG ? [{ k: 'grg_stage_id', l: 'مرحلة صب GRG (المرحلة الوحيدة للنوع)', t: 'fk', ref: 'stages', req: 1, readonly: !canEdit }] : [
      { k: 'cast_stage_id', l: 'مرحلة الصب', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, req: 1, readonly: !canEdit }, { k: 'finish_stage_id', l: 'مرحلة التشطيب', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, req: 1, readonly: !canEdit },
      { k: 'mold_stage_id', l: 'مرحلة القوالب (على المشروع)', t: 'fk', ref: 'stages', filter: (x) => !x.parent_id, readonly: !canEdit }], c, 3);
    // مواد مضافة لخلطة GRG: كل سطر = صنف + معيار (كمية لكل شيكارة جبس معيارية)
    const hasAdds = ['GRG', 'GRP'].includes(String(kind).toUpperCase()); const addsKey = `${String(kind).toLowerCase()}_additives`; const adds = (c[addsKey] || []).map((a) => ({ ...a })); const addBox = h('div');
    const drawAdds = () => addBox.replaceChildren(adds.length ? h('table.tbl.compact', h('thead', h('tr', ['الصنف المضاف', `المعيار لكل ${bm.unit_short} ${bm.title.replace(/^ال/, '')}`, 'الوحدة', ''].map((x) => h('th', x)))), h('tbody', adds.map((a, i) => h('tr',
      h('td', nameOf('materials', a.material_id) || a.material_id),
      h('td', h('input', { type: 'number', step: 'any', min: 0, value: a.ratio, disabled: !canEdit, style: { width: '110px' }, onchange: (e) => { a.ratio = Number(e.target.value); } })),
      h('td', byId('materials', a.material_id)?.unit_id ? nameOf('units', byId('materials', a.material_id).unit_id) : ''),
      h('td', canEdit ? h('button.btn.sm', { onclick: () => { adds.splice(i, 1); drawAdds(); } }, 'حذف') : null)))))
      : h('div.note', `مفيش مواد مضافة للخلطة لسه — ضيف الأصناف اللي بتتضاف على ${bm.unit_short} ${bm.title.replace(/^ال/, '')}.`));
    const addPick = fieldInput({ t: 'fk', ref: 'materials', combo: true, filter: (x) => !adds.some((a) => a.material_id === x.id) }, null); addPick.style.minWidth = '280px';
    const addAdd = h('button.btn', { onclick: () => { const id = addPick.get(); if (!id || adds.some((a) => a.material_id === id)) return; adds.push({ material_id: id, ratio: 1 }); addPick.set?.(null); drawAdds(); } }, '＋ إضافة مادة للخلطة');
    drawAdds();
    const rows = c.candidates.map((m) => ({ m, sel: m.selected, kg: m.kg }));
    const tbl = h('div'); const warn = h('div');
    const drawRows = () => {
      tbl.replaceChildren(rows.length
        ? h('table.tbl.compact', h('thead', h('tr', ['', 'الصنف', bm.factor_label].map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr',
          h('td', h('input', { type: 'checkbox', checked: r.sel, disabled: !canEdit, onchange: (e) => { r.sel = e.target.checked; } })),
          h('td', r.m.name, r.m.kg_guessed ? h('span.badge.warn', { style: { marginInlineStart: '8px' } }, 'الوزن متخمّن — راجعه') : null),
          h('td', h('input', { type: 'number', step: 'any', min: 0, value: r.kg, disabled: !canEdit, style: { width: '90px' }, onchange: (e) => { r.kg = Number(e.target.value); } }))))))
        : h('div', `مفيش أصناف مرتبطة بأساس ${kind} لسه — ضيف الأصناف من الأسفل.`));
      warn.replaceChildren(...(rows.some((r) => r.m.kg_guessed) ? [h('div.note.bad', `⚠ في أصناف وزنها متخمّن ${bm.std} كجم لأنه مش مكتوب في الاسم ولا محفوظ هنا. لو الوزن مختلف عدّله واضغط حفظ، لأنه بيأثر على عدد الشكاير وسعر المتر.`)] : []));
    };
    drawRows();
    const pick = fieldInput({ t: 'fk', ref: 'materials', combo: true, filter: (x) => !rows.some((r) => r.m.id === x.id) }, null); pick.style.minWidth = '280px';
    const add = h('button.btn', { onclick: () => { const id = pick.get(); const m = id && byId('materials', id); if (!m) return; if (!rows.some((r) => r.m.id === m.id)) rows.push({ m: { id: m.id, name: m.name }, sel: true, kg: bm.std || 1 }); pick.set?.(null); drawRows(); } }, '＋ إضافة صنف');
    const save = guard(async () => {
      const sel = rows.filter((r) => r.sel);
      await PUT('/costs/config', { ...f.values(), ...(hasAdds ? { [addsKey]: adds.map((a) => ({ material_id: a.material_id, ratio: a.ratio })) } : {}), basis: { kind, ids: sel.map((r) => r.m.id), factor: Object.fromEntries(rows.map((r) => [r.m.id, Number(r.kg) || 1])) } }); toast('تم الحفظ'); await load();
    });
    const tabs = h('div', { style: { display: 'flex', gap: '8px', margin: '4px 0 10px', flexWrap: 'wrap' } }, c.kinds.map((k) => h('button.btn.sm' + (k === kind ? '.primary' : ''), { onclick: () => { kind = k; load(); } }, k)));
    host.replaceChildren(card(isG ? 'مرحلة GRG' : 'المراحل', f.el),
      card(`أساس المتر المنتج حسب نوع المنتج التام`, tabs,
        h('div.note', `نوع ${kind}: المتر المنتج = كمية ${bm.title.replace(/^ال/, '')} المصروفة للصب ${bm.divide ? '÷' : '×'} ${bm.spread_label} (${bm.per_unit}) بيتدخل شهرياً في «تكلفة المتر».${bm.bagged ? ` الوحدة المعيارية شيكارة ${bm.std} كجم.` : ' الكمية بوحدة الصنف نفسها × المعامل (كجم لكل وحدة) — سيبه 1 لو الصنف بالكيلو.'}`),
        tbl, warn,
        canEdit ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, h('span', 'إضافة صنف تاني للأساس:'), pick, add) : null),
      hasAdds ? card(`المواد المضافة للخلطة (بالنسبة لـ${bm.unit_short} ${bm.title.replace(/^ال/, '')})`, h('div.note', `كل سطر = مادة بتتضاف للخلطة ومعيارها لكل ${bm.unit_short} ${bm.title.replace(/^ال/, '')}${bm.bagged ? ` معيارية (${bm.std} كجم)` : ''}. المادة اللي مش موجودة ضمن مصروفات صب ${kind} بتتحسب بالمعيار وبتتنقل من مرحلة صرفها (تشغيل غير مباشر) لمرحلة الصب عند «توزيع غير المباشر».`), addBox,
        canEdit ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, h('span', 'مادة مضافة:'), addPick, addAdd) : null) : null,
      canEdit ? h('div', { style: { marginTop: '12px' } }, h('button.btn.primary', { onclick: save }, 'حفظ')) : null);
  };
  root.replaceChildren(pageHead('ربط المراحل والمواد'), host);
  await load();
}

// ---------- تكلفة المتر (شهرياً) — GRC / GRP / GRG حسب أنواع المنتج التام ----------
const LEGACY_BASIS = { std: 50, bagged: true, title: 'الأسمنت', qty_label: 'شكاير الأسمنت للصب (معيارية 50 كجم)', spread_label: 'معدل فرد الشيكارة', per_unit: 'م² / شيكارة', per_col: 'معيار الشيكارة', lines_title: 'أسمنت الصب محوّل لشكاير 50 كجم', std_col: 'ما يعادل شكاير 50 كجم', factor_label: 'وزن الوحدة (كجم)' };
export async function unitCostPage(root, params = {}) {
  const host = h('div');
  const kinds = () => (L.finished_types || []).filter((x) => x.active).map((x) => x.name);   // أنواع المنتج التام من الإعدادات
  let cur = { month: params.month || curMonth(), kind: params.kind || kinds()[0] || 'GRC', project_id: params.project_id ? Number(params.project_id) : null };
  const bar = filterBar([{ k: 'month', l: 'الشهر', t: 'month', req: 1 }, { k: 'spread_rate', l: 'معدل فرد الشيكارة (م² / شيكارة)', t: 'number', step: '0.01' }, { k: 'kind', l: 'نوع المنتج التام', t: 'select', options: kinds().map((k) => [k, k]), def: cur.kind }, { k: 'project_id', l: 'عرض مشروع محدد (اختياري — للاعتماد اتركه فاضي)', t: 'fk', ref: 'projects', combo: true }],
    async (v) => { cur = { month: v.month || curMonth(), kind: v.kind || kinds()[0] || 'GRC', project_id: v.project_id || null }; await load(); }, { month: cur.month, kind: cur.kind, project_id: cur.project_id });
  const pageTitle = () => `تكلفة المتر ${kinds().join(' / ')}`;
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
    const pv = !!s.project_view; const approved = s.status === 'approved' || pv; const i = s.inputs; const bm = { ...LEGACY_BASIS, ...(i.basis || {}) };
    { const sp = bar.querySelectorAll('label.fld')[1]?.querySelector('span'); if (sp?.firstChild) sp.firstChild.textContent = `${bm.spread_label} (${bm.per_unit})`; }
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
      pv ? h('div.note', 'عرض تحليلي لمشروع واحد: معدل الفرد هو معدل الشهر الواحد لكل المشروعات، والاعتماد يتم على مستوى الشهر (بدون اختيار مشروع).') : null,
      approved && s.drift ? h('div.note.bad', `تنبيه: الأرقام الحالية اختلفت عن وقت الاعتماد (السعر الحالي ${blank(s.live_unit_cost?.total)} مقابل المعتمد ${blank(u.total)}) — السعر المعتمد لسه ثابت. أعد فتح الشهر لو عايز تحدّثه.`) : null,
      h('div.kpis', kpi(bm.qty_label, fq(i.bags), 'من المنصرف بالنظام'), kpi(bm.spread_label, i.spread_rate ? fq(i.spread_rate) : '—', bm.per_unit),
        kpi('المتر المسطح المنتج', i.area ? fmt(i.area) : '—', 'م²'), kpi(s.kind === 'GRG' ? 'تكلفة صب GRG / م²' : 'تكلفة الصب / م²', blank(u.cast)), ...(s.stage_ids?.finish?.length ? [kpi('تكلفة التشطيب / م²', blank(u.finish))] : []), kpi('سعر المتر الإجمالي', blank(u.total), s.stage_ids?.finish?.length ? 'صب + تشطيب' : 'صب', 'ok')),
      i.cement_lines?.some((x) => x.kg_guessed) ? h('div.note.bad', `⚠ وزن الوحدة متخمّن (${bm.std} كجم) للأصناف: ` + i.cement_lines.filter((x) => x.kg_guessed).map((x) => x.name).join('، ') + ' — راجعه من «ربط المراحل والمواد» لأنه بيأثر على المتر المنتج.') : null,
      i.cement_lines?.length ? card(bm.lines_title, table({ name: bm.lines_title, search: false, compact: true, rows: i.cement_lines, cols: [{ k: 'name', l: 'الصنف', render: (r) => matLink(r.material_id, r.name), text: (r) => r.name }, { k: 'qty', l: 'الكمية المصروفة', num: true, fmt: (v) => fq(v) }, { k: 'kg', l: bm.factor_label, num: true, fmt: (v) => fq(v) }, { k: 'std_bags', l: bm.std_col, num: true, fmt: (v) => fq(v) }], foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'std_bags' ? fq(i.bags_system) : '') })) : null,
      // الصفحة بتعرض المراحل المتكوّدة للنوع فقط (GRG: صب GRG بس)
      h('div.chart-grid', ...[s.stage_ids?.cast?.length ? stageTable(s.cast, { perBag: true, perCol: bm.per_col }) : null, s.stage_ids?.finish?.length ? stageTable(s.finish) : null].filter(Boolean)),
      !s.stage_ids?.cast?.length && !s.stage_ids?.finish?.length ? h('div.note.bad', `مفيش مراحل متكوّدة لنوع ${s.kind} — اربطها من «ربط المراحل والمواد».`) : null,
      s.additives?.lines?.length ? card(`المواد المضافة للخلطة (بالنسبة لـ${bm.unit_short} ${bm.title.replace(/^ال/, '')})`, table({ name: 'المواد المضافة', search: false, compact: true, rows: s.additives.lines,
        cols: [{ k: 'name', l: 'الصنف', render: (r) => matLink(r.material_id, r.name), text: (r) => r.name }, { k: 'unit', l: 'الوحدة' }, { k: 'ratio', l: 'المعيار / شيكارة', num: true, fmt: (v) => fq(v) },
          { k: 'expected_qty', l: 'الكمية المعيارية', num: true, fmt: (v) => fq(v) }, { k: 'issued_qty', l: 'المصروف لصب GRG', num: true, fmt: (v) => fq(v) },
          { k: 'auto', l: 'الاحتساب', render: (r) => (r.auto ? badge('تلقائي', 'warn') : badge('فعلي', 'ok')), text: (r) => (r.auto ? 'تلقائي' : 'فعلي') },
          { k: 'amount', l: 'القيمة', num: true, fmt: (v) => fmt(v) }, { k: 'deduct_qty', l: 'مخصوم من الغير مباشر (كمية)', num: true, fmt: (v) => (v ? fq(v) : '') }, { k: 'deduct_amount', l: 'مخصوم من الغير مباشر (قيمة)', num: true, fmt: (v) => (v ? fmt(v) : '') }],
        foot: (c) => (c.k === 'name' ? 'الإجمالي (التلقائي)' : c.k === 'amount' ? fmt(s.additives.auto_total) : c.k === 'deduct_amount' ? fmt(s.additives.deduct_total) : '') })) : null,
      acts.some(Boolean) ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '14px 0' } }, acts) : null,
    );
  };
  root.replaceChildren(h('div.print-only.print-head', h('div.ph-co', META.settings?.company_logo ? h('img.ph-logo', { src: META.settings.company_logo }) : null, META.settings?.company_name || ''), h('div.ph-title', pageTitle())), pageHead(pageTitle()), bar, host);
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
          { k: 'cast_per_m2', l: 'صب / م²', num: true, fmt: blank }, { k: 'finish_per_m2', l: 'تشطيب / م²', num: true, fmt: blank }, { k: 'unit_cost', l: 'سعر المتر', num: true, fmt: blank }] }));
  }, {});
  root.replaceChildren(pageHead('سجل أسعار المتر'), bar, host);
  bar.run();
}

// ---------- تكاليف مشروعات: تكلفة المنتج التام لكل مشروع وشهر ----------
const RUN_ST = { new: ['لم يُحسب', ''], draft: ['مسودة', 'warn'], approved: ['معتمد', 'ok'] };
export async function projectsCostPage(root, params = {}) {
  const host = h('div');
  const overview = async (v) => {
    const rows = await GET('/costs/runs', { month: v.month });
    host.replaceChildren(h('div.kpis', kpi('مشروعات فيها إنتاج تام', String(rows.length), v.month), kpi('معتمد', String(rows.filter((r) => r.status === 'approved').length)), kpi('لسه ما اتعتمدش', String(rows.filter((r) => r.status !== 'approved').length), '', rows.some((r) => r.status !== 'approved') ? 'warn' : '')),
      h('div.note', 'آخر الشهر: اعتمد سعر المتر الأول من «تكلفة المتر»، وبعدها اعتمد تكلفة كل مشروع هنا. تكلفة المشروع = سعر المتر × الأمتار التامة + القوالب + المباشر + نصيبه من غير المباشر، وبتتوزع على بنوده بالمتر التام.'),
      table({ name: 'تكاليف-مشروعات', rows, onRow: (r) => detail(v.month, r.project_id), empty: 'لا يوجد إنتاج تام مسجّل في الشهر ده',
        cols: [{ k: 'project_name', l: 'المشروع', render: (r) => h('b', r.project_name) }, { k: 'qty', l: 'القطع', num: true, fmt: (n) => fq(n) }, { k: 'meters', l: 'الأمتار التامة', num: true, fmt: (n) => fq(n) },
          { k: 'status', l: 'الحالة', render: (r) => badge(RUN_ST[r.status][0], RUN_ST[r.status][1]), text: (r) => RUN_ST[r.status][0] }, { k: 'total', l: 'تكلفة المشروع', num: true, fmt: (n) => (n === null ? '' : fmt(n)) }, { k: 'per_meter', l: 'تكلفة المتر', num: true, fmt: (n) => (n === null ? '' : fmt(n)) }] }));
  };
  const detail = guard(async (month, projectId) => {
    const r = await GET('/costs/run', { month, project_id: projectId });
    const approved = r.status === 'approved'; const carry = h('input', { type: 'number', step: 'any', value: r.carry || 0, disabled: approved || !can('costs.projects-cost.save') });
    const reload = () => detail(month, projectId);
    const act = (label, cls, fn) => h('button.btn' + (cls ? '.' + cls : ''), { onclick: guard(async () => { if ((await fn()) !== false) reload(); }) }, label);
    const P = r.parts || {};
    const back = h('a', { href: '#', onclick: (e) => { e.preventDefault(); fb.run(); root.replaceChildren(pageHead('تكاليف مشروعات'), fb, host); } }, '← تكاليف مشروعات');
    host.replaceChildren(h('div.crumb', back),
      h('div.kpis', kpi('المشروع', r.project_name, month), kpi('الحالة', RUN_ST[r.status || 'new'][0], approved ? r.approved_at || '' : '', approved ? '' : 'warn'), kpi('الأمتار التامة', fq(r.total_meters)), r.total ? kpi('تكلفة المشروع', fmt(r.total), `تكلفة المتر ${fmt(r.per_meter)}`) : null),
      ...(r.problems || []).map((p) => h('div.note.bad', '⚠ ' + p)),
      r.items?.length ? card('توزيع التكلفة على البنود التامة', table({ name: `تكلفة-تامة-${month}`, compact: true, search: false, rows: r.items,
        cols: [{ k: 'name', l: 'البند', render: (x) => h('b', x.name) }, { k: 'kind', l: 'النوع' }, { k: 'qty', l: 'القطع', num: true, fmt: (n) => fq(n) }, { k: 'meters', l: 'الأمتار', num: true, fmt: (n) => fq(n) },
          { k: 'pool', l: 'سعر المتر (صب+تشطيب)', num: true, fmt: (n) => fmt(n) }, { k: 'extras', l: 'قوالب + مباشر + غير مباشر', num: true, fmt: (n) => fmt(n) }, { k: 'value', l: 'قيمة البند', num: true, fmt: (n) => fmt(n) }, { k: 'unit_cost', l: 'تكلفة القطعة', num: true, fmt: (n) => fmt(n) }],
        foot: (c) => (c.k === 'value' ? fmt(r.total) : c.k === 'name' ? 'الإجمالي' : '') })) : null,
      r.parts ? card('مكونات تكلفة المشروع', h('div.kpis', kpi('صب بسعر المتر', fmt(P.pool_cast)), kpi('تشطيب بسعر المتر', fmt(P.pool_finish)), kpi('قوالب', fmt(P.mold)), kpi('مباشر خارج المتر', fmt(P.other_direct)),
        kpi('غير مباشر محمّل', fmt(P.indirect), `${fq((P.indirect_share || 0) * 100)}% من ${fmt(P.indirect_pool)}`), kpi('مرحّل (نصف مصنّع)', fmt(P.carry), 'يفضل تحت التشغيل'))) : null,
      r.credits?.length ? card('القيد اللي هيتعمل عند الاعتماد', table({ name: 'قيد-التحميل', compact: true, search: false, rows: [{ name: 'من ح/ مخزن المنتجات التامة', amount: r.total }, ...r.credits.map((c) => ({ name: `إلى ${nameOf('accounts', c.account_id) || ''} — ${c.label}`, amount: c.amount }))],
        cols: [{ k: 'name', l: 'البيان' }, { k: 'amount', l: 'المبلغ', num: true, fmt: (n) => fmt(n) }] })) : null,
      card('الإجراءات', h('div.actions', h('label', 'نصف مصنّع مرحّل للشهر الجاي (قوالب/مباشر لسه ما خلصش): ', carry), 
        !approved && can('costs.projects-cost.save') ? act('حفظ المرحّل', '', async () => { await PUT('/costs/run', { month, project_id: projectId, carry: Number(carry.value) || 0 }); toast('اتحفظ'); }) : null,
        !approved && can('costs.projects-cost.approve') ? act('اعتماد تكلفة المنتج التام', 'primary', async () => { if (!(await confirmBox(`اعتماد تكلفة ${r.project_name} لشهر ${month}؟ هيدخل المنتج التام مخزن المنتجات التامة بالقيم دي ويتعمل القيد.`, 'اعتماد'))) return false; await POST('/costs/run/approve', { month, project_id: projectId }); toast('اتعتمد'); }) : null,
        approved && can('costs.projects-cost.reopen') ? act('إعادة فتح', 'danger', async () => { if (!(await confirmBox('إعادة فتح التشغيل بتشيل القيد وحركات مخزن التام — مش هتنفع لو في تسليمات مبنية عليها.', 'إعادة فتح', true))) return false; await POST('/costs/run/reopen', { month, project_id: projectId }); toast('اتفتح'); }) : null)));
  });
  const fb = filterBar([{ k: 'month', l: 'الشهر', t: 'month' }], overview, { month: params.month || curMonth() });
  root.replaceChildren(pageHead('تكاليف مشروعات'), fb, host); fb.run();
  if (params.project_id) detail(params.month || curMonth(), Number(params.project_id));
}

// ---------- توزيع التكاليف غير المباشرة (شهري) — قبل اعتماد سعر المتر ----------
export async function allocPage(root, params = {}) {
  const host = h('div');
  const fb = filterBar([{ k: 'month', l: 'الشهر', t: 'month', req: 1 }], async (v) => { await load(v.month || curMonth()); }, { month: params.month || curMonth() });
  const load = async (month) => {
    const a = await GET('/costs/alloc', { month }); const approved = a.status === 'approved';
    const reload = () => load(month);
    host.replaceChildren(
      h('div.row', { style: { display: 'flex', gap: '8px', margin: '8px 0' } }, approved ? badge(`معتمد ${a.approved_at || ''}`, 'ok') : badge(a.status === 'new' ? 'لم يُعتمد بعد' : 'مسودة', 'warn')),
      h('div.note', 'آخر الشهر: التكاليف غير المباشرة (أجور غير مباشرة + مصروفات التشغيل غير المباشرة) بتتوزع على مراحل الصب والتشطيب بنسبة تكلفة كل مرحلة: مدين إنتاج تحت التشغيل للمرحلة ودائن حساب المصروف نفسه. لازم يتعتمد قبل اعتماد سعر المتر. والمواد غير المباشرة بتتوزع وقت الصرف على المرحلة.'),
      ...(a.problems || []).map((p) => h('div.note.bad', '⚠ ' + p)),
      approved && a.drift !== null && a.drift !== undefined ? h('div.note.bad', `تنبيه: التكاليف غير المباشرة اتغيّرت بعد الاعتماد (الحالي ${fmt(a.drift)} مقابل المعتمد ${fmt(a.total)}) — أعد فتح التوزيع لو عايز تحدّثه.`) : null,
      h('div.kpis', kpi('إجمالي غير المباشر الموزَّع', fmt(a.total)), kpi('عدد البنود', String((a.pool || []).length)), kpi('المراحل المستلمة', String((a.targets || []).length))),
      card('المصدر — دائن (حسابات المصروف غير المباشر)', table({ name: 'مصدر-التوزيع', search: false, compact: true, rows: a.pool || [], empty: 'لا توجد تكاليف غير مباشرة في الشهر ده',
        cols: [{ k: 'name', l: 'البند' }, { k: 'account_id', l: 'الحساب', render: (r) => nameOf('accounts', r.account_id), text: (r) => nameOf('accounts', r.account_id) }, { k: 'amount', l: 'المبلغ', num: true, fmt: (v) => fmt(v) }],
        foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'amount' ? fmt(a.total) : '') })),
      card('المستلم — مدين (إنتاج تحت التشغيل للمرحلة)', table({ name: 'مستلم-التوزيع', search: false, compact: true, rows: a.targets || [], empty: 'لا يوجد',
        cols: [{ k: 'name', l: 'المرحلة' }, { k: 'account_id', l: 'الحساب', render: (r) => nameOf('accounts', r.account_id), text: (r) => nameOf('accounts', r.account_id) }, { k: 'base', l: 'تكلفة المرحلة (الأساس)', num: true, fmt: (v) => fmt(v) }, { k: 'share', l: 'النسبة', num: true, fmt: (v) => fq(v * 100) + '%' }, { k: 'amount', l: 'نصيبها', num: true, fmt: (v) => fmt(v) }],
        foot: (c) => (c.k === 'name' ? 'الإجمالي' : c.k === 'amount' ? fmt(a.total) : '') })),
      (a.reclass || []).length ? card('نقل المواد المضافة للخلطة (غير مصروفة لمرحلة الصب)', table({ name: 'نقل-GRG', search: false, compact: true, rows: a.reclass,
        cols: [{ k: 'kind', l: 'النوع' }, { k: 'name', l: 'الصنف' }, { k: 'from_stage_id', l: 'من مرحلة', render: (r) => nameOf('stages', r.from_stage_id), text: (r) => nameOf('stages', r.from_stage_id) }, { k: 'to_stage_id', l: 'إلى مرحلة', render: (r) => nameOf('stages', r.to_stage_id), text: (r) => nameOf('stages', r.to_stage_id) }, { k: 'qty', l: 'الكمية', num: true, fmt: (v) => fq(v) }, { k: 'amount', l: 'القيمة', num: true, fmt: (v) => fmt(v) }] })) : null,
      h('div', { style: { display: 'flex', gap: '8px', margin: '14px 0' } },
        !approved && can('costs.alloc.approve') ? h('button.btn.primary', { onclick: guard(async () => { if (!(await confirmBox(`اعتماد توزيع التكاليف غير المباشرة لشهر ${month}؟ هيتعمل القيد وتدخل التكاليف في تكلفة مراحل الصب والتشطيب.`, 'اعتماد'))) return; await POST('/costs/alloc/approve', { month }); toast('تم اعتماد التوزيع'); await reload(); }) }, '✔ اعتماد التوزيع') : null,
        approved && can('costs.alloc.reopen') ? h('button.btn', { onclick: guard(async () => { if (await confirmBox('إعادة فتح التوزيع بتشيل القيد وتكاليف التوزيع من المراحل. متأكد؟', 'إعادة فتح', true)) { await POST('/costs/alloc/reopen', { month }); await reload(); } }) }, 'إعادة فتح') : null));
  };
  root.replaceChildren(pageHead('توزيع التكاليف غير المباشرة'), fb, host); fb.run();
}
