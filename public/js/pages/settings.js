import { h, GET, POST, PUT, DEL, L, META, loadLookups, loadMeta, fmt, fq, table, formGrid, fieldInput, pageHead, card, modal, toast, guard, confirmBox, badge, nameOf, byId, codeName, labelOf, filterBar, can } from '../core.js';

const ACCOUNT_FILTER = (x) => x.postable === 1 && x.active !== 0;
const fieldDefs = (M) => M.fields.map((f) => ({
  ...f, filter: f.ref === 'accounts' ? ACCOUNT_FILTER : f.filter, combo: f.t === 'fk' && f.ref !== 'accounts' && (L[f.ref] || []).length > 14,
}));

const MASTER_PAGE = { units: 'units', material_categories: 'categories', materials: 'materials', warehouses: 'warehouses', clients: 'clients', projects: 'projects', project_items: 'project-items', stages: 'stages', sites: 'sites', suppliers: 'suppliers', treasuries: 'treasuries', custodians: 'custodians', expense_categories: 'expense-cats', employees: 'employees' };
/** شاشة تكويد عامة مبنية من مواصفات السيرفر */
export function masterPage(name, opts = {}) {
  return async (root) => {
    const M = META.masters[name]; const title = opts.title || M.title;
    const P = opts.perm || `settings.${MASTER_PAGE[name]}`; const canC = can(P + '.create'), canE = can(P + '.edit'), canD = can(P + '.delete');
    let showInactive = opts.showInactive ?? (name === 'stages'); let filterVal = {};   // المراحل: المعطّل يظهر بعلامة «معطّل» افتراضياً
    const tableHost = h('div');
    const colDefs = () => [
      { k: 'code', l: 'الكود', w: '110px', render: (r) => h('b', r.code) },
      ...M.cols.filter((c) => c !== 'code').map((c) => {
        const f = M.fields.find((x) => x.k === c) || { l: c, t: 'text' };
        if (f.t === 'fk') return { k: c, l: f.l, text: (r) => (f.ref === 'accounts' ? codeName(byId('accounts', r[c])) : nameOf(f.ref, r[c])) };
        if (f.t === 'multifk') return { k: c, l: f.l, text: (r) => ((r[c] || []).length ? r[c].map((i) => nameOf(f.ref, i)).join('، ') : 'كل الأصناف') };
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
      tableHost.replaceChildren(table({ cols: colDefs(), rows, onRow: canE ? (r) => edit(r) : null, name: title, empty: canC ? 'لا توجد بيانات — اضغط «جديد» لإضافة أول سجل' : 'لا توجد بيانات' }));
    };
    const edit = (rec) => {
      let lastAuto = null;   // آخر اسم اتعبّى تلقائياً من حقل مرتبط (علشان منكتبش فوق اسم كتبه المستخدم بإيده)
      const defs = fieldDefs(M).map((f) => (f.fills ? { ...f, onChange: (v) => {
        const src = byId(f.ref, v); if (!src || !fg) return;
        const cur = fg.values()[f.fills];
        if (!cur || cur === lastAuto) { fg.set(f.fills, src.name); lastAuto = src.name; }
      } } : f));
      // العاملين: يومية ← قفل المرتب الشهري، شهرية ← قفل أجر اليوم
      const lockWage = (type, reset) => {
        if (name !== 'employees' || !fg) return;
        for (const [k, locked] of [['daily_rate', type === 'monthly'], ['monthly_salary', type === 'daily']]) {
          const inp = fg.inputs[k]; if (!inp) continue;
          inp.disabled = locked; if (locked && reset) inp.set(0);
        }
      };
      const defs2 = name === 'employees' ? defs.map((f) => (f.k === 'emp_type' ? { ...f, onChange: (v) => lockWage(v, true) } : f)) : defs;
      const fg = formGrid([{ k: 'code', l: 'الكود', t: 'text', ph: rec ? '' : 'تلقائي — اتركه فارغاً' }, ...defs2], rec || (opts.defaults || {}), 2);
      if (name === 'employees') lockWage(fg.values().emp_type, false);
      const body = h('div', fg.el, rec ? h('label.fld', { style: { marginTop: '10px', flexDirection: 'row', alignItems: 'center', gap: '8px' } }, (() => { const c = fieldInput({ t: 'bool' }, rec.active); fg.active = c; return c; })(), h('span', 'نشط')) : null);
      modal({
        title: rec ? `تعديل — ${rec.name}` : `إضافة — ${title}`, body, buttons: [
          { label: 'حفظ', cls: 'primary', onClick: async () => { const v = fg.values(); if (rec) v.active = fg.active.get(); if (!rec && !v.code) delete v.code;
            if (rec) await PUT(`/m/${name}/${rec.id}`, v); else await POST(`/m/${name}`, v); toast('تم الحفظ'); await load(); } },
          rec && canD ? { label: 'حذف', cls: 'danger', close: false, onClick: async (close) => { if (!(await confirmBox(`حذف «${rec.name}»؟ لو الكود مستخدم في حركات هيتعطّل بدل الحذف.`, 'حذف', true))) return false;
            const r = await DEL(`/m/${name}/${rec.id}`); toast(r.message || 'تم الحذف'); close(); await load(); return false; } } : null].filter(Boolean),
      });
    };
    const fileIn = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' }, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await POST(`/m/${name}/import`, { file: btoa(bin) }); toast(r.message); await loadLookups(true); await load();
      } catch (err) { modal({ title: 'تعذّر رفع الملف', body: h('pre', { style: { whiteSpace: 'pre-wrap', direction: 'rtl' } }, err.message), buttons: [] }); }
    } });
    const downloadTemplate = async () => {
      const res = await fetch(`/api/m/${name}/template`); if (!res.ok) { toast('تعذّر تحميل النموذج'); return; }
      h('a', { href: URL.createObjectURL(await res.blob()), download: 'نموذج-بنود-المشروعات.xlsx' }).click();
    };
    const bar = h('div.filters', { style: { alignItems: 'center' } },
      opts.filterBy ? (() => { const sel = fieldInput({ t: 'fk', ref: opts.filterRef, combo: true, onChange: (v) => { filterVal[opts.filterBy] = v; load(); } }, null); sel.style.minWidth = '280px'; return h('label.fld', h('span', opts.filterLabel), sel); })() : null,
      h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { showInactive = e.target.checked; load(); } }), 'إظهار المعطّل'));
    root.replaceChildren(pageHead(title, name === 'project_items' && canC ? h('button.btn', { onclick: downloadTemplate }, '⬇ نموذج Excel') : null, name === 'project_items' && canC ? h('button.btn', { onclick: () => fileIn.click() }, '⬆ رفع من Excel') : null, canC ? h('button.btn.primary', { onclick: () => edit(null) }, '＋ جديد') : null), opts.note ? h('div.note', opts.note) : null, fileIn, bar, tableHost);
    await load();
  };
}

// ------------------------------------------------------------
/** لوجو المصنع: بيتصغّر في المتصفح (حد أقصى 400×200) ويتخزن كإعداد، وبيظهر في هيدر كل المطبوعات */
const shrink = (file) => new Promise((res, rej) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 400 / img.width, 200 / img.height); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
  img.onerror = () => rej(new Error('الملف مش صورة صالحة')); img.src = url;
});
function logoCard(canE) {
  const prev = h('div', { style: { minHeight: '70px', display: 'flex', alignItems: 'center' } });
  const show = () => { const v = META.settings?.company_logo; prev.replaceChildren(v ? h('img', { src: v, style: { maxHeight: '70px', maxWidth: '240px' } }) : h('span.hint', 'لا يوجد لوجو')); };
  const setLogo = guard(async (v) => { await PUT('/settings', { company_logo: v }); await loadMeta(); show(); toast(v ? 'تم حفظ اللوجو' : 'تم حذف اللوجو'); });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onchange: guard(async () => { const f = file.files[0]; file.value = ''; if (f) await setLogo(await shrink(f)); }) });
  show();
  return card('لوجو المصنع (بيظهر في هيدر المطبوعات)', prev, canE ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, file,
    h('button.btn', { onclick: () => file.click() }, 'رفع / تغيير اللوجو'), META.settings?.company_logo ? h('button.btn', { onclick: () => setLogo('') }, 'حذف') : null) : null);
}

export async function generalPage(root) {
  const S = META.settings; const canE = can('settings.general.edit');
  const g1 = formGrid([{ k: 'company_name', l: 'اسم الشركة', t: 'text', wide: true, readonly: !canE }, { k: 'currency', l: 'العملة', t: 'text', readonly: !canE }, { k: 'profit_pct', l: 'نسبة الربح على المنتج المسلّم %', t: 'number', readonly: !canE },
    { k: 'allow_negative_stock', l: 'السماح بالصرف على المكشوف (رصيد سالب)', t: 'select', options: [['0', 'لا — منع (موصى به)'], ['1', 'نعم']], readonly: !canE }], S, 2);
  const save = guard(async () => { await PUT('/settings', g1.values()); await loadMeta(); toast('تم حفظ الإعدادات'); });
  root.replaceChildren(pageHead('الإعدادات العامة', canE ? h('button.btn.primary', { onclick: save }, 'حفظ') : null),
    h('div.note', 'ربط الحسابات (للقيود التلقائية) اتنقل لموديول الحسابات ← ربط الحسابات.'),
    card('بيانات الشركة', g1.el), logoCard(canE));
}

export async function sequencesPage(root) {
  const rows = await GET('/sequences'); const tb = h('tbody');
  rows.forEach((r) => {
    const ro = !can('accounts.sequences.edit');
    const inp = { p: h('input', { type: 'text', value: r.prefix, disabled: ro, style: { width: '110px' } }), pad: h('input', { type: 'number', value: r.padding, disabled: ro, style: { width: '70px' } }), n: h('input', { type: 'number', value: r.next_no, disabled: ro, style: { width: '110px' } }) };
    tb.append(h('tr', h('td', r.label), h('td', inp.p), h('td', inp.pad), h('td', inp.n), h('td.num', `${inp.p.value}${String(inp.n.value).padStart(Number(inp.pad.value), '0')}`),
      h('td', ro ? null : h('button.btn.sm', { onclick: guard(async () => { await PUT(`/sequences/${r.key}`, { prefix: inp.p.value, padding: Number(inp.pad.value), next_no: Number(inp.n.value) }); toast('تم'); }) }, 'حفظ'))));
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
    const dis = data.locked || !can('settings.opening.edit');
    let content;
    if (tab === 'stock') {
      const rows = data.stock.filter((r) => (!q || `${r.code} ${r.name}`.toLowerCase().includes(q)) && (!onlyNonZero || r.qty > 0));
      const sum = () => data.stock.reduce((s, r) => s + (edits.stock[r.material_id]?.value ?? r.value), 0);
      const totalEl = h('b', fmt(sum()));
      content = h('div', h('div.tbl-bar', h('input.search', { type: 'search', placeholder: 'بحث بالاسم أو الكود…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: onlyNonZero, onchange: (e) => { onlyNonZero = e.target.checked; draw(); } }), 'الأصناف ذات الرصيد فقط'),
        h('span.grow'), h('span', 'إجمالي قيمة المخزون الافتتاحي: ', totalEl)),
        h('div.tbl-wrap', h('table.tbl.compact', h('thead', h('tr', ['الكود', 'الصنف', 'الوحدة', 'الكمية', 'القيمة', 'تكلفة الوحدة', 'مصدر القيمة', 'ملاحظة'].map((x) => h('th', x)))),
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
      data.locked ? (can('settings.opening.unlock') ? h('button.btn', { onclick: unlock }, 'فك القفل') : null) : [
        can('settings.opening.edit') ? h('button.btn', { onclick: guard(async () => { await saveOnly(); toast('تم الحفظ'); draw(); }) }, 'حفظ فقط') : null,
        can('settings.opening.edit') ? h('button.btn.primary', { onclick: apply }, 'حفظ وتطبيق') : null,
        can('settings.opening.lock') ? h('button.btn.warnb', { onclick: lock }, 'قفل نهائي') : null]));
  if (data.locked) dateInp.setAttribute('disabled', '');
  root.replaceChildren(pageHead('الأرصدة الافتتاحية'), head, host); top(); draw();
}

// ------------------------------------------------------------
/** محرر الصلاحيات: موديول ← صفحة ← إجراءات. تفعيل إجراء بيفعّل صفحته، وإلغاء الصفحة بيلغي إجراءاتها */
function permEditor(initial) {
  const sel = new Set(initial || []); const boxes = new Map();
  const box = (k) => { const c = h('input', { type: 'checkbox', checked: sel.has(k) }); boxes.set(k, c); return c; };
  const put = (k, on) => { on ? sel.add(k) : sel.delete(k); const c = boxes.get(k); if (c) c.checked = on; };
  const keysOf = (m) => m.pages.flatMap((p) => [`${m.id}.${p.id}`, ...p.actions.map(([a]) => `${m.id}.${p.id}.${a}`)]);
  const counts = new Map();
  const upd = () => counts.forEach((el, id) => { const m = META.catalog.find((x) => x.id === id); const ks = keysOf(m); el.textContent = `${ks.filter((k) => sel.has(k)).length} / ${ks.length}`; });
  const el = h('div.perm-editor', META.catalog.map((m) => {
    const cnt = h('small.muted'); counts.set(m.id, cnt);
    const mb = h('input', { type: 'checkbox', title: 'تحديد / إلغاء كل صلاحيات الموديول', onchange: () => { keysOf(m).forEach((k) => put(k, mb.checked)); upd(); } });
    return h('details.perm-mod', { open: m.pages.some((p) => sel.has(`${m.id}.${p.id}`)) }, h('summary', mb, h('b', ' ' + m.title), ' ', cnt),
      h('table.perm', h('tbody', m.pages.map((p) => {
        const pk = `${m.id}.${p.id}`; const pb = box(pk);
        pb.onchange = () => { put(pk, pb.checked); if (!pb.checked) p.actions.forEach(([a]) => put(`${pk}.${a}`, false)); upd(); };
        return h('tr', h('td.pg', h('label', pb, ' ' + p.title)), h('td', p.actions.map(([a, l]) => {
          const ak = `${pk}.${a}`; const ab = box(ak);
          ab.onchange = () => { put(ak, ab.checked); if (ab.checked) put(pk, true); upd(); };
          return h('label.act', ab, ' ' + l);
        })));
      }))));
  }));
  upd();
  const all = (on) => { META.catalog.forEach((m) => keysOf(m).forEach((k) => put(k, on))); upd(); };
  return { el, get: () => [...sel], all, bar: h('div.actions', h('button.btn.sm', { type: 'button', onclick: () => all(true) }, 'تحديد الكل'), h('button.btn.sm', { type: 'button', onclick: () => all(false) }, 'إلغاء الكل')) };
}

export async function usersPage(root) {
  const users = await GET('/users'); const modName = (id) => META.catalog.find((m) => m.id === id)?.title || id;
  const open = (u) => {
    const fg = formGrid([{ k: 'username', l: 'اسم المستخدم', t: 'text', readonly: !!u, req: 1 }, { k: 'name', l: 'الاسم', t: 'text', req: 1 }, { k: 'employee_id', l: 'الموظف (اسمه بيظهر في التوقيعات والطباعة)', t: 'fk', ref: 'employees', combo: true }, { k: 'password', l: u ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور', t: 'password' },
      { k: 'role', l: 'الدور', t: 'select', options: [['user', 'مستخدم (حسب الصلاحيات)'], ['admin', 'مدير (كل الصلاحيات)']], onChange: (v) => { pe.el.style.display = pe.bar.style.display = v === 'admin' ? 'none' : ''; } }], u || {}, 2);
    const pe = permEditor(u?.perms);
    modal({ title: u ? `تعديل ${u.name}` : 'مستخدم جديد', wide: true, body: h('div', fg.el, h('h4', { style: { margin: '14px 0 4px' } }, 'الصلاحيات (صفحة ← زرار)'),
      u?.legacy && u.role !== 'admin' ? h('div.note', 'المستخدم ده على النظام القديم (موديولات)، وصلاحياته الحالية اتحوّلت تلقائياً للقائمة دي. اضغط حفظ لتثبيتها وتعديلها.') : null,
      h('div.note', 'تفعيل الصفحة = يشوفها. كل زرار (إنشاء / تعديل / إلغاء / حذف …) له صلاحية منفصلة. المدير ليه كل الصلاحيات دايماً.'), pe.bar, pe.el), buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => {
      const v = fg.values(); v.perms = pe.get(); if (!v.password) delete v.password;
      if (u) await PUT(`/users/${u.id}`, v); else await POST('/users', v); await loadMeta(); toast('تم'); usersPage(root); } },
    u ? { label: u.active ? 'تعطيل' : 'تفعيل', close: true, onClick: async () => { await PUT(`/users/${u.id}`, { active: !u.active }); usersPage(root); } } : null].filter(Boolean) });
    if (u?.role === 'admin') pe.el.style.display = pe.bar.style.display = 'none';
  };
  root.replaceChildren(pageHead('المستخدمون والصلاحيات', h('button.btn.primary', { onclick: () => open(null) }, '＋ مستخدم')),
    table({ cols: [{ k: 'username', l: 'المستخدم' }, { k: 'name', l: 'الاسم' }, { k: 'employee_id', l: 'الموظف', text: (r) => nameOf('employees', r.employee_id) }, { k: 'jobs', l: 'الوظائف', text: (r) => (r.jobs || []).join(' — ') }, { k: 'role', l: 'الدور', text: (r) => (r.role === 'admin' ? 'مدير' : 'مستخدم') },
      { k: 'perms', l: 'الصلاحيات', text: (r) => (r.role === 'admin' ? 'الكل' : `${r.perms.length} صلاحية — ${[...new Set(r.perms.map((k) => k.split('.')[0]))].map(modName).join('، ') || 'بدون'}`) }, { k: 'active', l: 'الحالة', render: (r) => (r.active ? badge('نشط', 'ok') : badge('معطّل', 'bad')) }], rows: users, onRow: open }));
}

// ---------------- وظائف الموديولات (بتظهر في خانات التوقيع بالطباعة) ----------------
export async function jobsPage(root) {
  const [data, users] = await Promise.all([GET('/jobs'), GET('/users')]);
  const active = users.filter((u) => u.active);
  const names = (ids) => ids.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
  const open = (module, j) => {
    const sel = new Set(j?.user_ids || []);
    const fg = formGrid([{ k: 'name', l: 'اسم الوظيفة', t: 'text', req: 1, help: 'لازم يكون نفس عنوان خانة التوقيع في المستند المطبوع (مثلاً: أمين المخزن، المحاسب)' }], j || {}, 1);
    const boxes = active.map((u) => { const c = h('input', { type: 'checkbox', checked: sel.has(u.id), onchange: () => { c.checked ? sel.add(u.id) : sel.delete(u.id); } }); return h('label.chk', c, ' ' + u.name); });
    modal({ title: j ? `تعديل وظيفة ${j.name}` : `وظيفة جديدة — ${data.modules.find((m) => m.id === module)?.title}`, body: h('div', fg.el, h('h4', { style: { margin: '14px 0 4px' } }, 'المستخدمون اللي بيشغلوا الوظيفة دي في الموديول'), h('div.multi', boxes.length ? boxes : h('div.muted', 'لا يوجد مستخدمون نشطون'))),
      buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => {
        const v = fg.values(); const body = { name: v.name, user_ids: [...sel] };
        if (j) await PUT(`/jobs/${j.id}`, body); else await POST('/jobs', { ...body, module });
        await loadMeta(); toast('تم'); jobsPage(root); } },
      j ? { label: 'حذف الوظيفة', close: true, onClick: async () => { if (!(await confirmBox(`حذف وظيفة ${j.name} من الموديول؟`, 'حذف', true))) return; await DEL(`/jobs/${j.id}`); await loadMeta(); toast('تم الحذف'); jobsPage(root); } } : null].filter(Boolean) });
  };
  root.replaceChildren(pageHead('الوظائف'), h('div.note', 'كل موديول ليه وظائفه (أمين المخزن، المحاسب، مدير المشتريات…). اختار مين بيشغل كل وظيفة، وبعدها اسمه بيظهر فوق خانة التوقيع بنفس اسم الوظيفة في المستندات المطبوعة بتاعة الموديول ده. المستخدم الواحد ممكن يكون ليه وظيفة مختلفة في كل موديول.'),
    ...data.modules.map((m) => card(m.title, table({ cols: [{ k: 'name', l: 'الوظيفة', render: (r) => h('b', r.name) }, { k: 'user_ids', l: 'المستخدمون', text: (r) => names(r.user_ids).join('، ') || '—' }],
      rows: data.jobs.filter((j) => j.module === m.id), onRow: (r) => open(m.id, r), search: false, empty: 'لا توجد وظائف' }), h('div.actions', h('button.btn.sm', { onclick: () => open(m.id, null) }, '＋ وظيفة')))));
}

export async function auditPage(root) {
  const rows = await GET('/audit');
  root.replaceChildren(pageHead('سجل العمليات (آخر 500)'), table({ cols: [{ k: 'at', l: 'الوقت' }, { k: 'username', l: 'المستخدم' }, { k: 'action', l: 'العملية' }, { k: 'entity', l: 'الكيان' }, { k: 'entity_id', l: '#' }, { k: 'details', l: 'تفاصيل' }], rows, name: 'audit' }));
}
