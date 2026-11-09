import { h, GET, POST, PUT, DEL, L, fmt, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, toast, guard, modal, confirmBox, formGrid, fieldInput, loadLookups } from '../core.js';

const TYPES = [['asset', 'أصول'], ['liability', 'خصوم'], ['equity', 'حقوق ملكية'], ['revenue', 'إيرادات'], ['expense', 'مصروفات']];
const tl = (t) => (TYPES.find(([k]) => k === t) || [])[1] || t;

export async function chartPage(root) {
  const draw = async () => {
    const rows = await GET('/acc/accounts'); const kids = {}; rows.forEach((a) => (kids[a.parent_id || 0] ||= []).push(a));
    const out = [];
    const walk = (pid, d) => (kids[pid] || []).forEach((a) => { out.push({ ...a, depth: d }); walk(a.id, d + 1); }); walk(0, 0);
    const t = table({ name: 'دليل الحسابات', rows: out, compact: true, onRow: (r) => edit(r),
      cols: [{ k: 'code', l: 'الكود', render: (r) => h('span', { style: { paddingRight: r.depth * 18 + 'px', fontWeight: r.postable ? 400 : 700 } }, r.code) },
        { k: 'name', l: 'اسم الحساب', render: (r) => h('span', { style: { fontWeight: r.postable ? 400 : 700 } }, r.name) }, { k: 'type', l: 'النوع', text: (r) => tl(r.type) }, { k: 'postable', l: 'يقبل حركة', text: (r) => (r.postable ? 'نعم' : 'رئيسي') }, { k: 'active', l: 'الحالة', text: (r) => (r.active ? '' : 'موقوف') }] });
    host.replaceChildren(t);
  };
  const edit = async (a) => {
    const all = await GET('/acc/accounts'); const isNew = !a?.id;
    const v = a || { type: 'asset', postable: 1 };
    const f = formGrid([{ k: 'code', l: 'الكود', t: 'text', req: 1 }, { k: 'name', l: 'اسم الحساب', t: 'text', req: 1 },
      { k: 'parent_id', l: 'الحساب الرئيسي', t: 'select', options: [['', '— بدون —'], ...all.filter((x) => !x.postable || isNew).map((x) => [x.id, `${x.code} ${x.name}`])] },
      { k: 'type', l: 'النوع', t: 'select', options: TYPES }, { k: 'postable', l: 'يقبل حركات (حساب فرعي)', t: 'bool' }, ...(isNew ? [] : [{ k: 'active', l: 'نشط', t: 'bool' }])], { ...v, active: v.active ?? 1 }, 2);
    modal({ title: isNew ? 'حساب جديد' : `تعديل ${v.name}`, body: f.el, buttons: [
      { label: 'حفظ', cls: 'primary', onClick: async () => { const x = f.values(); x.parent_id = x.parent_id ? Number(x.parent_id) : null; isNew ? await POST('/acc/accounts', x) : await PUT('/acc/accounts/' + v.id, x); await loadLookups(); toast('تم الحفظ'); draw(); } },
      ...(isNew ? [] : [{ label: 'حذف', cls: 'danger', onClick: async () => { if (!(await confirmBox('حذف الحساب؟', 'حذف', true))) throw new Error('تم الإلغاء'); await DEL('/acc/accounts/' + v.id); await loadLookups(); toast('تم الحذف'); draw(); } }])] });
  };
  const host = h('div');
  const file = h('input', { type: 'file', accept: '.csv', style: { display: 'none' }, onchange: guard(async () => {
    const f = file.files[0]; if (!f) return; const csv = await f.text(); file.value = '';
    if (!(await confirmBox('هيتحدّث الدليل بالكود: الأكواد الموجودة تتعدل (الاسم/النوع/التبعية) والجديدة تتضاف، ومفيش حساب بيتحذف. نكمل؟', 'استيراد', false))) return;
    const r = await POST('/acc/accounts/import', { csv }); await loadLookups(); toast(`تم الاستيراد: أُضيف ${r.added} — تحدّث ${r.updated}`); draw();
  }) });
  root.replaceChildren(pageHead('دليل الحسابات', file, h('button.btn', { onclick: () => file.click() }, '⤒ استيراد CSV'), h('button.btn.primary', { onclick: () => edit(null) }, '＋ حساب جديد')), h('div.note', 'اضغط على أي حساب لتعديله. الحسابات الرئيسية للتجميع فقط، والحركات تتسجل على الفرعية.'), host);
  await draw();
}

export async function periodsPage(root) {
  const host = h('div'); const yr = h('input', { type: 'number', value: new Date().getFullYear() + 1, style: { width: '90px' } });
  const draw = async () => {
    const rows = await GET('/acc/periods');
    host.replaceChildren(table({ name: 'الفترات', search: false, rows, cols: [{ k: 'name', l: 'الفترة', render: (r) => h('b', r.name) }, { k: 'start_date', l: 'من' }, { k: 'end_date', l: 'إلى' }, { k: 'status', l: 'الحالة', render: (r) => badge(r.status === 'open' ? 'مفتوحة' : 'مقفولة', r.status === 'open' ? 'ok' : 'bad') },
      { k: 'x', l: '', render: (r) => h('button.btn.sm', { onclick: guard(async () => { await POST(`/acc/periods/${r.id}/status`, { status: r.status === 'open' ? 'closed' : 'open' }); draw(); }) }, r.status === 'open' ? 'قفل' : 'فتح') }] }));
  };
  root.replaceChildren(pageHead('الفترات المالية', h('span', 'سنة: '), yr, h('button.btn', { onclick: guard(async () => { const r = await POST('/acc/periods/generate', { year: Number(yr.value) }); toast(`تم إنشاء ${r.created} فترة`); draw(); }) }, 'إنشاء فترات السنة')),
    h('div.note', 'الفترة المقفولة ما بيتسجلش فيها أي مستند أو قيد (ولا يتعدل أو يتلغي مستند تاريخه فيها).'), host);
  await draw();
}

export async function journalsPage(root) {
  const host = h('div');
  const run = async (v) => { const rows = await GET('/acc/journals', v); host.replaceChildren(table({ name: 'القيود', compact: true, rows, onRow: (r) => view(r.id),
    cols: [{ k: 'no', l: 'رقم القيد', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'type', l: 'النوع', text: (r) => (r.type === 'manual' ? 'يدوي' : 'تلقائي') }, { k: 'description', l: 'البيان' }, { k: 'total', l: 'القيمة', num: true, fmt: (n) => fmt(n) }] })); };
  const fb = filterBar([{ k: 'from', l: 'من', t: 'date' }, { k: 'to', l: 'إلى', t: 'date' }, { k: 'type', l: 'النوع', t: 'select', options: [['', 'الكل'], ['manual', 'يدوي'], ['auto', 'تلقائي']] }, { k: 'q', l: 'بحث', t: 'text' }], run, { from: monthStart() });
  const view = guard(async (id) => {
    const e = await GET('/acc/journals/' + id);
    const body = h('div', h('p', `${e.date} — ${e.description || ''}`), table({ search: false, compact: true, name: e.no, rows: e.lines, cols: [{ k: 'account_code', l: 'الحساب', text: (r) => `${r.account_code} ${r.account_name}` }, { k: 'description', l: 'بيان' }, { k: 'debit', l: 'مدين', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'credit', l: 'دائن', num: true, fmt: (n) => (n ? fmt(n) : '') }] }));
    modal({ title: `قيد ${e.no} ${e.type === 'manual' ? '(يدوي)' : '(تلقائي)'}`, wide: true, body, buttons: e.type === 'manual' ? [{ label: 'تعديل', onClick: () => { setTimeout(() => entry(e), 50); } }, { label: 'حذف', cls: 'danger', onClick: async () => { await DEL('/acc/journals/' + e.id); toast('تم الحذف'); fb.run(); } }] : [] });
  });
  const entry = (e) => {
    const st = { date: e?.date || today(), description: e?.description || '', lines: e?.lines?.map((l) => ({ account_id: l.account_id, debit: l.debit || '', credit: l.credit || '', description: l.description })) || [{}, {}] };
    const box = h('div'); const tot = h('div.totals');
    const draw = () => {
      const d = st.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), c = st.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      tot.replaceChildren(h('div', h('small', 'مدين'), h('b', fmt(d))), h('div', h('small', 'دائن'), h('b', fmt(c))), h('div' + (Math.abs(d - c) < 0.005 ? '.ok' : '.bad'), h('small', 'الفرق'), h('b', fmt(d - c))));
    };
    const rows = () => box.replaceChildren(h('table.lines', h('thead', h('tr', ['الحساب', 'مدين', 'دائن', 'بيان', ''].map((x) => h('th', x)))), h('tbody', st.lines.map((l, i) => h('tr',
      h('td', fieldInput({ t: 'fk', ref: 'accounts', combo: true, filter: (x) => x.postable === 1 && x.active !== 0, onChange: (v) => { l.account_id = v; } }, l.account_id)),
      h('td', fieldInput({ t: 'number', onChange: (v) => { l.debit = v; if (v) l.credit = ''; draw(); } }, l.debit)), h('td', fieldInput({ t: 'number', onChange: (v) => { l.credit = v; if (v) l.debit = ''; draw(); } }, l.credit)),
      h('td', fieldInput({ t: 'text', onChange: (v) => { l.description = v; } }, l.description)), h('td', h('button.del', { onclick: () => { st.lines.splice(i, 1); rows(); draw(); } }, '×'))))),
    ), h('div.actions', h('button.btn.sm', { onclick: () => { st.lines.push({}); rows(); } }, '＋ سطر')));
    const hf = formGrid([{ k: 'date', l: 'التاريخ', t: 'date', req: 1 }, { k: 'description', l: 'البيان', t: 'text' }], st, 2);
    const tplBar = h('div.note', 'تحميل من نموذج: ');
    if (!e) GET('/acc/templates').then((tp) => {
      const usable = tp.items.filter((t) => t.active !== 0);
      const sel = h('select', { onchange: () => {
        const t = usable.find((x) => String(x.id) === sel.value); if (!t) return;
        st.lines = t.lines.map((l) => ({ account_id: l.resolved_account_id || '', [l.side]: '', description: l.label || '' }));
        hf.el.querySelector('input[type=text]') && !hf.values().description && (hf.el.querySelector('input[type=text]').value = t.name);
        rows(); draw();
      } }, h('option', { value: '' }, '— اختر نموذج —'), usable.map((t) => h('option', { value: t.id }, `${t.module_name} · ${t.name}`)));
      tplBar.append(sel, h('small', '  (الأسطر بدون حساب = حساب بيحدده المستند، اختاره بنفسك)'));
    });
    rows(); draw();
    modal({ title: e ? `تعديل قيد ${e.no}` : 'قيد يومية يدوي', wide: true, body: h('div', e ? null : tplBar, hf.el, box, tot), buttons: [{ label: 'حفظ القيد', cls: 'primary', onClick: async () => { const v = hf.values(); const p = { ...v, lines: st.lines.map((l) => ({ ...l, account_id: l.account_id ? Number(l.account_id) : null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) }; e ? await PUT('/acc/journals/' + e.id, p) : await POST('/acc/journals', p); toast('تم الحفظ'); fb.run(); } }] });
  };
  root.replaceChildren(pageHead('قيود اليومية', h('button.btn.primary', { onclick: () => entry(null) }, '＋ قيد يدوي')), fb, host); fb.run();
}


// ===== نماذج القيود =====
export async function templatesPage(root) {
  const host = h('div'); const mod = h('select'); const sideLbl = { debit: 'مدين', credit: 'دائن' };
  const draw = async () => {
    const data = await GET('/acc/templates');
    mod.replaceChildren(h('option', { value: '' }, 'كل الموديولات'), Object.entries(data.modules).map(([k, v]) => h('option', { value: k }, v)));
    const paint = () => {
      const items = data.items.filter((t) => !mod.value || t.module === mod.value);
      host.replaceChildren(table({ name: 'نماذج القيود', rows: items, onRow: (t) => show(t, data),
        cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'النموذج', render: (t) => h('b', t.name) }, { k: 'module_name', l: 'الموديول' },
          { k: 'lines', l: 'القيد', render: (t) => h('div', t.lines.map((l) => h('div', h('small', sideLbl[l.side] + ': '), l.account_code ? `${l.account_code} ${l.account_name}` : (l.role_name || '—')))) },
          { k: 'system', l: 'النوع', render: (t) => badge(t.system ? 'نظام' : 'مضاف', t.system ? '' : 'ok') }] }));
    };
    mod.onchange = paint; paint();
  };
  const show = (t, data) => {
    const body = h('div', t.description ? h('div.note', t.description) : null, h('table.lines', h('thead', h('tr', ['الجانب', 'الحساب', 'ملاحظة'].map((x) => h('th', x)))),
      h('tbody', t.lines.map((l) => h('tr', h('td', sideLbl[l.side]), h('td', l.account_code ? `${l.account_code} — ${l.account_name}` : h('i', l.role_name || '—')), h('td', l.dynamic ? 'يتحدد من المستند' : (l.role_key && !l.account_id ? 'من إعدادات ربط الحسابات' : (l.label || ''))))))));
    modal({ title: `${t.name} (${t.module_name})`, wide: true, body, buttons: t.system ? [] : [{ label: 'تعديل', onClick: () => setTimeout(() => edit(t, data), 50) },
      { label: 'حذف', cls: 'danger', onClick: async () => { await DEL('/acc/templates/' + t.id); toast('تم الحذف'); draw(); } }] });
  };
  const edit = (t, data) => {
    const st = { name: t?.name || '', module: t?.module || '', description: t?.description || '', lines: t ? t.lines.map((l) => ({ side: l.side, account_id: l.account_id, label: l.label })) : [{ side: 'debit' }, { side: 'credit' }] };
    const box = h('div');
    const rows = () => box.replaceChildren(h('table.lines', h('thead', h('tr', ['الجانب', 'الحساب (من الدليل)', 'ملاحظة', ''].map((x) => h('th', x)))), h('tbody', st.lines.map((l, i) => h('tr',
      h('td', fieldInput({ t: 'select', req: 1, options: [['debit', 'مدين'], ['credit', 'دائن']], onChange: (v) => { l.side = v; } }, l.side)),
      h('td', fieldInput({ t: 'fk', ref: 'accounts', combo: true, filter: (x) => x.postable === 1 && x.active !== 0, onChange: (v) => { l.account_id = v; } }, l.account_id)),
      h('td', fieldInput({ t: 'text', onChange: (v) => { l.label = v; } }, l.label)), h('td', h('button.del', { onclick: () => { st.lines.splice(i, 1); rows(); } }, '×'))))),
    ), h('div.actions', h('button.btn.sm', { onclick: () => { st.lines.push({ side: 'debit' }); rows(); } }, '＋ سطر')));
    const hf = formGrid([{ k: 'name', l: 'اسم النموذج', t: 'text', req: 1 }, { k: 'module', l: 'الموديول', t: 'select', req: 1, options: [['', '— اختر —'], ...Object.entries(data.modules)] }, { k: 'description', l: 'وصف', t: 'text' }], st, 2);
    rows();
    modal({ title: t ? `تعديل ${t.name}` : 'نموذج قيد جديد', wide: true, body: h('div', hf.el, box), buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => {
      const v = hf.values(); const p = { ...v, lines: st.lines.map((l) => ({ ...l, account_id: l.account_id ? Number(l.account_id) : null })) };
      if (t) await PUT('/acc/templates/' + t.id, p); else await POST('/acc/templates', p); toast('تم الحفظ'); draw(); } }] });
  };
  root.replaceChildren(pageHead('نماذج القيود', mod, h('button.btn.primary', { onclick: guard(async () => edit(null, await GET('/acc/templates'))) }, '＋ نموذج جديد')),
    h('div.note', 'القيود اللي البرنامج بيولّدها (نظام) + نماذج بتضيفها بنفسك، مربوطة بموديول وبحسابات دليل الحسابات. تقدر تستخدم أي نموذج من «قيد يدوي ← تحميل من نموذج».'), host);
  await draw();
}
