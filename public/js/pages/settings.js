import { h, GET, POST, PUT, DEL, L, META, loadLookups, loadMeta, fmt, fq, table, formGrid, fieldInput, pageHead, card, modal, toast, guard, confirmBox, badge, nameOf, byId, codeName, labelOf, filterBar } from '../core.js';

const ACCOUNT_FILTER = (x) => x.postable === 1 && x.active !== 0;
const fieldDefs = (M) => M.fields.map((f) => ({
  ...f, filter: f.ref === 'accounts' ? ACCOUNT_FILTER : f.filter, combo: f.t === 'fk' && f.ref !== 'accounts' && (L[f.ref] || []).length > 14,
}));

/** شاشة تكويد عامة مبنية من مواصفات السيرفر */
export function masterPage(name, opts = {}) {
  return async (root) => {
    const M = META.masters[name]; const title = opts.title || M.title;
    let showInactive = false; let filterVal = {};
    const tableHost = h('div');
    const colDefs = () => [
      { k: 'code', l: 'الكود', w: '110px', render: (r) => h('b', r.code) },
      ...M.cols.filter((c) => c !== 'code').map((c) => {
        const f = M.fields.find((x) => x.k === c) || { l: c, t: 'text' };
        if (f.t === 'fk') return { k: c, l: f.l, text: (r) => (f.ref === 'accounts' ? codeName(byId('accounts', r[c])) : nameOf(f.ref, r[c])) };
        if (f.t === 'multifk') return { k: c, l: f.l, text: (r) => ((r[c] || []).length ? r[c].map((i) => nameOf(f.ref, i)).join('، ') : 'كل الخامات') };
        if (f.t === 'select') return { k: c, l: f.l, text: (r) => labelOf(f.options, r[c]) };
        if (f.t === 'number') return { k: c, l: f.l, num: true, text: (r) => (r[c] === null ? '' : fq(r[c])) };
        return { k: c, l: f.l, text: (r) => r[c] ?? '' };
      }),
      { k: 'active', l: 'الحالة', text: (r) => (r.active ? 'نشط' : 'معطّل'), render: (r) => (r.active ? badge('نشط', 'ok') : badge('معطّل', 'bad')) },
    ];
    const load = async () => {
      await loadLookups();
      let rows = L[name] || [];
      if (!showInactive) rows = rows.filter((r) => r.active);
      if (opts.filterBy && filterVal[opts.filterBy]) rows = rows.filter((r) => r[opts.filterBy] === Number(filterVal[opts.filterBy]));
      tableHost.replaceChildren(table({ cols: colDefs(), rows, onRow: (r) => edit(r), name: title, empty: 'لا توجد بيانات — اضغط «جديد» لإضافة أول سجل' }));
    };
    const edit = (rec) => {
      let lastAuto = null;   // آخر اسم اتعبّى تلقائياً من حقل مرتبط (علشان منكتبش فوق اسم كتبه المستخدم بإيده)
      const defs = fieldDefs(M).map((f) => (f.fills ? { ...f, onChange: (v) => {
        const src = byId(f.ref, v); if (!src || !fg) return;
        const cur = fg.values()[f.fills];
        if (!cur || cur === lastAuto) { fg.set(f.fills, src.name); lastAuto = src.name; }
      } } : f));
      const fg = formGrid([{ k: 'code', l: 'الكود', t: 'text', ph: rec ? '' : 'تلقائي — اتركه فارغاً' }, ...defs], rec || (opts.defaults || {}), 2);
      const body = h('div', fg.el, rec ? h('label.fld', { style: { marginTop: '10px', flexDirection: 'row', alignItems: 'center', gap: '8px' } }, (() => { const c = fieldInput({ t: 'bool' }, rec.active); fg.active = c; return c; })(), h('span', 'نشط')) : null);
      modal({
        title: rec ? `تعديل — ${rec.name}` : `إضافة — ${title}`, body, buttons: [
          { label: 'حفظ', cls: 'primary', onClick: async () => { const v = fg.values(); if (rec) v.active = fg.active.get(); if (!rec && !v.code) delete v.code;
            if (rec) await PUT(`/m/${name}/${rec.id}`, v); else await POST(`/m/${name}`, v); toast('تم الحفظ'); await load(); } },
          rec ? { label: 'حذف', cls: 'danger', close: false, onClick: async (close) => { if (!(await confirmBox(`حذف «${rec.name}»؟ لو الكود مستخدم في حركات هيتعطّل بدل الحذف.`, 'حذف', true))) return false;
            const r = await DEL(`/m/${name}/${rec.id}`); toast(r.message || 'تم الحذف'); close(); await load(); return false; } } : null].filter(Boolean),
      });
    };
    const bar = h('div.filters', { style: { alignItems: 'center' } },
      opts.filterBy ? (() => { const sel = fieldInput({ t: 'fk', ref: opts.filterRef, combo: true, onChange: (v) => { filterVal[opts.filterBy] = v; load(); } }, null); sel.style.minWidth = '280px'; return h('label.fld', h('span', opts.filterLabel), sel); })() : null,
      h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', onchange: (e) => { showInactive = e.target.checked; load(); } }), 'إظهار المعطّل'));
    root.replaceChildren(pageHead(title, h('button.btn.primary', { onclick: () => edit(null) }, '＋ جديد')), opts.note ? h('div.note', opts.note) : null, bar, tableHost);
    await load();
  };
}

// ------------------------------------------------------------
export async function generalPage(root) {
  const S = META.settings; const isNeg = S.allow_negative_stock === '1';
  const accFields = Object.entries(META.acc_keys).map(([k, l]) => ({ k, l, t: 'fk', ref: 'accounts', filter: ACCOUNT_FILTER, combo: true, req: 1 }));
  const g1 = formGrid([{ k: 'company_name', l: 'اسم الشركة', t: 'text', wide: true }, { k: 'currency', l: 'العملة', t: 'text' },
    { k: 'allow_negative_stock', l: 'السماح بالصرف على المكشوف (رصيد سالب)', t: 'select', options: [['0', 'لا — منع (موصى به)'], ['1', 'نعم']] }], S, 2);
  const g2 = formGrid(accFields, Object.fromEntries(Object.keys(META.acc_keys).map((k) => [k, Number(S[k])])), 2);
  const save = guard(async () => {
    const v = { ...g1.values(), ...g2.values() }; await PUT('/settings', v); await loadMeta(); toast('تم حفظ الإعدادات');
  });
  root.replaceChildren(pageHead('الإعدادات العامة وربط الحسابات', h('button.btn.primary', { onclick: save }, 'حفظ')),
    card('بيانات الشركة', g1.el),
    card('ربط الحسابات (تُستخدم في القيود التلقائية)', h('div.note', 'كل مستند بيولّد قيده تلقائياً على الحسابات دي. حسابات «إنتاج تحت التشغيل» لكل مرحلة بتتحدد من شاشة المراحل، وحسابات الخزن من شاشة الخزن والبنوك.'), g2.el));
}

export async function sequencesPage(root) {
  const rows = await GET('/sequences'); const tb = h('tbody');
  rows.forEach((r) => {
    const inp = { p: h('input', { type: 'text', value: r.prefix, style: { width: '110px' } }), pad: h('input', { type: 'number', value: r.padding, style: { width: '70px' } }), n: h('input', { type: 'number', value: r.next_no, style: { width: '110px' } }) };
    tb.append(h('tr', h('td', r.label), h('td', inp.p), h('td', inp.pad), h('td', inp.n), h('td.num', `${inp.p.value}${String(inp.n.value).padStart(Number(inp.pad.value), '0')}`),
      h('td', h('button.btn.sm', { onclick: guard(async () => { await PUT(`/sequences/${r.key}`, { prefix: inp.p.value, padding: Number(inp.pad.value), next_no: Number(inp.n.value) }); toast('تم'); }) }, 'حفظ'))));
  });
  root.replaceChildren(pageHead('الترقيم والتكويد التلقائي'), h('div.note', 'كل كود أو رقم مستند بيتولّد تلقائياً من هنا (بادئة + رقم تسلسلي). تقدر تغيّر البادئة أو الرقم التالي، ولو كتبت كود يدوي في أي شاشة تكويد هيتحقق من عدم التكرار.'),
    h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', ['النوع', 'البادئة', 'عدد الخانات', 'الرقم التالي', 'مثال', ''].map((x) => h('th', x)))), tb)));
}

// ------------------------------------------------------------
export async function openingPage(root) {
  let data = await GET('/opening'); const me = META.me;
  const edits = { stock: {}, suppliers: {}, treasuries: {}, custodians: {} };
  let tab = 'stock'; let q = ''; let onlyNonZero = false;
  const host = h('div');
  const dateInp = fieldInput({ t: 'date' }, data.date);
  const status = () => h('div.chips', data.locked ? badge('مقفلة — لا يمكن التعديل', 'bad') : data.applied ? badge('مُطبّقة (قابلة للتعديل)', 'warn') : badge('لم تُطبّق بعد', 'info'));
  const collect = () => ({
    date: dateInp.get(),
    stock: Object.entries(edits.stock).map(([material_id, v]) => ({ material_id: Number(material_id), ...v })),
    suppliers: Object.entries(edits.suppliers).map(([id, v]) => ({ id: Number(id), opening_balance: v })),
    treasuries: Object.entries(edits.treasuries).map(([id, v]) => ({ id: Number(id), opening_balance: v })),
    custodians: Object.entries(edits.custodians).map(([id, v]) => ({ id: Number(id), opening_balance: v })),
  });
  const saveOnly = async () => { await PUT('/opening', collect()); for (const k of Object.keys(edits)) edits[k] = {}; data = await GET('/opening'); };
  const draw = () => {
    const dis = data.locked;
    let content;
    if (tab === 'stock') {
      const rows = data.stock.filter((r) => (!q || `${r.code} ${r.name}`.toLowerCase().includes(q)) && (!onlyNonZero || r.qty > 0));
      const sum = () => data.stock.reduce((s, r) => s + (edits.stock[r.material_id]?.value ?? r.value), 0);
      const totalEl = h('b', fmt(sum()));
      content = h('div', h('div.tbl-bar', h('input.search', { type: 'search', placeholder: 'بحث بالاسم أو الكود…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: onlyNonZero, onchange: (e) => { onlyNonZero = e.target.checked; draw(); } }), 'الأصناف ذات الرصيد فقط'),
        h('span.grow'), h('span', 'إجمالي قيمة المخزون الافتتاحي: ', totalEl)),
        h('div.tbl-wrap', h('table.tbl.compact', h('thead', h('tr', ['الكود', 'الخامة', 'الوحدة', 'الكمية', 'القيمة', 'تكلفة الوحدة', 'مصدر القيمة', 'ملاحظة'].map((x) => h('th', x)))),
          h('tbody', rows.map((r) => {
            const cur = () => edits.stock[r.material_id] || { qty: r.qty, value: r.value };
            const uc = h('td.num', r.qty > 0 ? fmt(r.value / r.qty, 4) : '');
            const upd = (k, v) => { edits.stock[r.material_id] = { ...cur(), [k]: v, source: 'معدّل يدوياً' }; const c = cur(); uc.textContent = c.qty > 0 ? fmt(c.value / c.qty, 4) : ''; totalEl.textContent = fmt(sum()); };
            return h('tr' + (r.note ? '.low' : ''), h('td', r.code), h('td', r.name), h('td', r.unit),
              h('td', h('input', { type: 'number', step: 'any', min: 0, value: r.qty, disabled: dis, style: { width: '110px' }, oninput: (e) => upd('qty', Number(e.target.value) || 0) })),
              h('td', h('input', { type: 'number', step: 'any', min: 0, value: r.value, disabled: dis, style: { width: '130px' }, oninput: (e) => upd('value', Number(e.target.value) || 0) })),
              uc, h('td', r.source ? badge(r.source, r.source === 'الشيت' ? 'ok' : r.source === 'آخر مشتريات' ? 'warn' : r.source === 'بدون سعر' ? 'bad' : '') : ''), h('td', { style: { maxWidth: '280px', fontSize: '12.5px', color: 'var(--ink2)' } }, r.note || ''));
          })))));
    } else {
      const key = tab; const label = { suppliers: 'رصيد مستحق للمورد (دائن)', treasuries: 'رصيد الخزينة/البنك', custodians: 'رصيد العهدة بذمة صاحبها' }[key];
      content = h('div', h('div.note', key === 'suppliers' ? 'الأرصدة المستحقة للموردين أول المدة — موجب = علينا للمورد.' : key === 'treasuries' ? 'الرصيد النقدي أو البنكي أول المدة.' : 'العهد المصروفة ولم تُسوَّ بعد أول المدة.'),
        h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', ['الكود', 'الاسم', label].map((x) => h('th', x)))),
          h('tbody', data[key].map((r) => h('tr', h('td', r.code), h('td', r.name), h('td', h('input', { type: 'number', step: 'any', value: r.opening_balance, disabled: dis, style: { width: '160px' }, oninput: (e) => { edits[key][r.id] = Number(e.target.value) || 0; } }))))))));
    }
    host.replaceChildren(h('div.chips', [['stock', 'المخزون'], ['suppliers', 'الموردين'], ['treasuries', 'الخزن والبنوك'], ['custodians', 'العهد']].map(([k, l]) => h('button.chip' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; draw(); } }, l))), content);
  };
  const apply = guard(async () => {
    await saveOnly(); const r = await POST('/opening/apply');
    toast(`تم تطبيق الأرصدة الافتتاحية بتاريخ ${r.date} — قيمة المخزون ${fmt(r.stock_value)}`); data = await GET('/opening'); top(); draw();
  });
  const lock = guard(async () => {
    if (!(await confirmBox('قفل الأرصدة الافتتاحية نهائي ولن تقدر تعدّلها بعد كده (إلا بفك القفل من المدير). متأكد إنك راجعت الكميات والقيم؟', 'قفل الأرصدة', true))) return;
    await saveOnly(); await POST('/opening/lock'); data = await GET('/opening'); top(); draw(); toast('تم قفل الأرصدة الافتتاحية');
  });
  const unlock = guard(async () => { if (await confirmBox('فك قفل الأرصدة الافتتاحية؟', 'فك القفل', true)) { await POST('/opening/unlock'); data = await GET('/opening'); top(); draw(); } });
  const head = h('div');
  const top = () => head.replaceChildren(
    h('div.note', 'عدّل الكمية أو القيمة الافتتاحية لأي صنف (أو رصيد مورد/خزينة/عهدة)، ثم «حفظ وتطبيق» لتوليد حركات المخزون والقيد المحاسبي. تقدر تعيد التطبيق أي عدد مرات لحد ما تقفل الأرصدة. الأصناف المظلّلة قيمتها محتاجة مراجعتك (عمود القيمة في شيت الإكسل بيبوظ بعد أي لحظة الرصيد فيها بيوصل صفر).'),
    h('div.filters', { style: { alignItems: 'center' } }, h('label.fld', h('span', 'تاريخ الأرصدة الافتتاحية'), dateInp), status(), h('span.grow'),
      data.locked ? h('button.btn', { onclick: unlock }, 'فك القفل (مدير)') : [h('button.btn', { onclick: guard(async () => { await saveOnly(); toast('تم الحفظ'); draw(); }) }, 'حفظ فقط'), h('button.btn.primary', { onclick: apply }, 'حفظ وتطبيق'), h('button.btn.warnb', { onclick: lock }, 'قفل نهائي')]));
  if (data.locked) dateInp.setAttribute('disabled', '');
  root.replaceChildren(pageHead('الأرصدة الافتتاحية'), head, host); top(); draw();
}

// ------------------------------------------------------------
export async function usersPage(root) {
  const users = await GET('/users'); const modsAll = META.modules.filter(([k]) => k !== 'dashboard');
  const open = (u) => {
    const fg = formGrid([{ k: 'username', l: 'اسم المستخدم', t: 'text', readonly: !!u, req: 1 }, { k: 'name', l: 'الاسم', t: 'text', req: 1 }, { k: 'password', l: u ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور', t: 'password' },
      { k: 'role', l: 'الدور', t: 'select', options: [['user', 'مستخدم (حسب الموديولات)'], ['admin', 'مدير (كل الصلاحيات)']] }], u || {}, 2);
    const checks = modsAll.map(([k, l]) => { const c = h('input', { type: 'checkbox', checked: u?.modules?.includes(k) }); return { k, c, el: h('label', { style: { display: 'flex', gap: '6px', margin: '3px 0' } }, c, l) }; });
    modal({ title: u ? `تعديل ${u.name}` : 'مستخدم جديد', body: h('div', fg.el, h('h4', { style: { margin: '14px 0 4px' } }, 'الموديولات والصلاحيات المسموحة'), h('div', checks.map((x) => x.el))), buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => {
      const v = fg.values(); v.modules = checks.filter((x) => x.c.checked).map((x) => x.k); if (!v.password) delete v.password;
      if (u) await PUT(`/users/${u.id}`, v); else await POST('/users', v); toast('تم'); usersPage(root); } },
    u ? { label: u.active ? 'تعطيل' : 'تفعيل', close: true, onClick: async () => { await PUT(`/users/${u.id}`, { active: !u.active }); usersPage(root); } } : null].filter(Boolean) });
  };
  root.replaceChildren(pageHead('المستخدمون والصلاحيات', h('button.btn.primary', { onclick: () => open(null) }, '＋ مستخدم')),
    table({ cols: [{ k: 'username', l: 'المستخدم' }, { k: 'name', l: 'الاسم' }, { k: 'role', l: 'الدور', text: (r) => (r.role === 'admin' ? 'مدير' : 'مستخدم') },
      { k: 'modules', l: 'الموديولات', text: (r) => (r.role === 'admin' ? 'الكل' : r.modules.map((m) => META.modules.find(([k]) => k === m)?.[1]).join('، ')) }, { k: 'active', l: 'الحالة', render: (r) => (r.active ? badge('نشط', 'ok') : badge('معطّل', 'bad')) }], rows: users, onRow: open }));
}

export async function auditPage(root) {
  const rows = await GET('/audit');
  root.replaceChildren(pageHead('سجل العمليات (آخر 500)'), table({ cols: [{ k: 'at', l: 'الوقت' }, { k: 'username', l: 'المستخدم' }, { k: 'action', l: 'العملية' }, { k: 'entity', l: 'الكيان' }, { k: 'entity_id', l: '#' }, { k: 'details', l: 'تفاصيل' }], rows, name: 'audit' }));
}
