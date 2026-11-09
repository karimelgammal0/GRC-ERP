// ============================================================
//  مكونات الواجهة المشتركة (بدون أي مكتبات خارجية)
// ============================================================
export const $ = (sel, el = document) => el.querySelector(sel);

/** h('div.cls#id', {onclick, style:{}}, ...children) */
// replaceChildren الأصلية بتحوّل null إلى نص "null" — نتجاهل القيم الفارغة
{ const orig = Element.prototype.replaceChildren; Element.prototype.replaceChildren = function (...a) { return orig.apply(this, a.flat().filter((x) => x !== null && x !== undefined && x !== false)); }; }
export function h(tag, props, ...kids) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) for (const p of m[2].match(/[.#][\w-]+/g)) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

// ---------- تنسيق ----------
export const fmt = (n, d = 2) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fq = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
// التاريخ المحلي لجهاز المستخدم (toISOString كان بيرجّع تاريخ UTC — يعني بعد منتصف الليل بتوقيت القاهرة يطلع تاريخ امبارح)
export const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const monthStart = () => today().slice(0, 8) + '01';
export const yearStart = () => today().slice(0, 4) + '-01-01';

// ---------- طلبات الشبكة ----------
export async function api(method, url, body) {
  const res = await fetch('/api' + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* */ }
  if (res.status === 401 && !url.startsWith('/login')) { window.dispatchEvent(new Event('need-login')); throw new Error('سجّل الدخول'); }
  if (!res.ok) throw new Error(data?.error || `خطأ ${res.status}`);
  return data;
}
export const GET = (u, q) => api('GET', u + (q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) : ''));
export const POST = (u, b) => api('POST', u, b || {});
export const PUT = (u, b) => api('PUT', u, b);
export const DEL = (u) => api('DELETE', u);

// ---------- رسائل ----------
export function toast(msg, kind = 'ok') {
  let box = $('#toasts'); if (!box) { box = h('div#toasts'); document.body.append(box); }
  const t = h('div.toast.' + kind, msg); box.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'err' ? 6000 : 2600); setTimeout(() => t.remove(), kind === 'err' ? 6400 : 3000);
}
export const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };

// ---------- نوافذ ----------
export function modal({ title, body, buttons = [], wide = false, onClose }) {
  const close = () => { back.remove(); onClose?.(); };
  const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } },
    h('div.modal' + (wide ? '.wide' : ''), h('div.modal-head', h('h3', title), h('button.x', { onclick: close, title: 'إغلاق' }, '×')),
      h('div.modal-body', body), buttons.length ? h('div.modal-foot', buttons.map((b) => h('button.btn' + (b.cls ? '.' + b.cls : ''), { onclick: async () => { try { const r = await b.onClick?.(close); if (r !== false && b.close !== false) close(); } catch (e) { toast(e.message, 'err'); } } }, b.label))) : null));
  document.body.append(back);
  const first = back.querySelector('input,select,textarea'); first?.focus();
  return { close, el: back };
}
export const confirmBox = (msg, okLabel = 'تأكيد', danger = false) => new Promise((resolve) => {
  const m = modal({ title: 'تأكيد', body: h('p', msg), onClose: () => resolve(false), buttons: [
    { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => { resolve(true); }, close: true }, { label: 'إلغاء', onClick: () => { resolve(false); } }] });
});

// ---------- القوائم المرجعية (lookups) ----------
export const L = {}; export const META = {};
export async function loadLookups() { Object.assign(L, await GET('/lookups')); }
export async function loadMeta() { Object.assign(META, await GET('/meta')); }
export const byId = (list, id) => (L[list] || []).find((x) => x.id === Number(id));
export const nameOf = (list, id) => { const x = byId(list, id); return x ? x.name : ''; };
export const codeName = (x) => (x ? `${x.code} — ${x.name}` : '');
export const labelOf = (opts, v) => (opts.find(([k]) => k === v) || [])[1] ?? v ?? '';
export const CLASS_OPTS = [['direct', 'مباشرة (مرحلة تصنيع)'], ['indirect', 'تكلفة غير مباشرة'], ['admin', 'مصروفات إدارية']];

// ---------- حقل بحث (Combo) للقوائم الطويلة ----------
export function combo({ list, value, onChange, filter, placeholder = 'ابحث بالاسم أو الكود…', allowEmpty = true, items }) {
  const getItems = () => (items ? items() : (L[list] || []).filter((x) => x.active !== 0 && (!filter || filter(x))));
  let cur = value ? Number(value) : null;
  const input = h('input.combo-in', { type: 'text', placeholder, autocomplete: 'off' });
  const box = h('div.combo-list'); box.style.display = 'none';
  const caret = h('span.combo-caret', { onmousedown: (e) => { e.preventDefault(); if (box.style.display === 'block') box.style.display = 'none'; else { typed = false; hi = 0; input.focus(); render(); } } }, '▾');
  const wrap = h('div.combo', input, caret, box);
  const show = (id) => { const x = getItems().find((i) => i.id === id) || (L[list] || []).find((i) => i.id === id); input.value = x ? codeName(x) : ''; };
  show(cur);
  let hi = 0, shown = [], typed = false;
  const render = () => {
    const q = typed ? input.value.trim().toLowerCase() : '';
    shown = getItems().filter((x) => !q || `${x.code} ${x.name}`.toLowerCase().includes(q)).slice(0, 60);
    box.replaceChildren(...(allowEmpty ? [h('div.opt.empty', { onmousedown: (e) => { e.preventDefault(); pick(null); } }, '— بدون —')] : []),
      ...shown.map((x, i) => h('div.opt' + (i === hi ? '.hi' : ''), { onmousedown: (e) => { e.preventDefault(); pick(x.id); } }, h('b', x.code), ' ', x.name, x.sub ? h('small', ' ' + x.sub) : null)),
      shown.length ? null : h('div.opt.none', 'لا نتائج'));
    box.style.display = 'block';
  };
  const pick = (id) => { cur = id; show(id); box.style.display = 'none'; onChange?.(id); };
  input.addEventListener('focus', () => { input.select(); typed = false; hi = 0; render(); });
  input.addEventListener('input', () => { typed = true; hi = 0; render(); });
  input.addEventListener('blur', () => { box.style.display = 'none'; show(cur); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (shown[hi]) { pick(shown[hi].id); e.preventDefault(); } }
    else if (e.key === 'Escape') { box.style.display = 'none'; }
  });
  wrap.get = () => cur; wrap.set = (v) => { cur = v ? Number(v) : null; show(cur); };
  return wrap;
}

// ---------- حقول النماذج ----------
/** يبني حقل إدخال ويرجع عنصر له get()/set() */
export function fieldInput(f, value) {
  let el;
  if (f.t === 'fk' || f.t === 'lookup') {
    const long = (L[f.ref] || []).length > 14 || f.combo;
    if (long) el = combo({ list: f.ref, value, filter: f.filter, allowEmpty: !f.req, onChange: (v) => f.onChange?.(v) });
    else {
      el = h('select', { onchange: () => f.onChange?.(el.get()) }, f.req ? null : h('option', { value: '' }, '—'),
        (L[f.ref] || []).filter((x) => x.active !== 0 && (!f.filter || f.filter(x))).map((x) => h('option', { value: x.id, selected: Number(value) === x.id }, codeName(x))));
      el.get = () => (el.value === '' ? null : Number(el.value)); el.set = (v) => { el.value = v ?? ''; };
    }
  } else if (f.t === 'select') {
    el = h('select', { onchange: () => f.onChange?.(el.value) }, (f.options || []).map(([k, l]) => h('option', { value: k, selected: String(value ?? f.def ?? '') === String(k) }, l)));
    el.get = () => el.value; el.set = (v) => { el.value = v ?? ''; };
  } else if (f.t === 'multifk') {
    const sel = new Set((Array.isArray(value) ? value : []).map(Number)); const boxes = [];
    el = h('div.multi', (L[f.ref] || []).filter((x) => x.active !== 0).map((x) => { const c = h('input', { type: 'checkbox', checked: sel.has(x.id), onchange: () => { c.checked ? sel.add(x.id) : sel.delete(x.id); f.onChange?.([...sel]); } }); boxes.push([x.id, c]); return h('label.chk', c, ' ' + codeName(x)); }));
    el.get = () => [...sel]; el.set = (v) => { sel.clear(); (v || []).forEach((i) => sel.add(Number(i))); boxes.forEach(([id, c]) => { c.checked = sel.has(id); }); };
  } else if (f.t === 'textarea') {
    el = h('textarea', { rows: 2 }, value ?? ''); el.get = () => el.value; el.set = (v) => { el.value = v ?? ''; };
  } else if (f.t === 'number') {
    el = h('input', { type: 'number', step: f.step || 'any', min: f.min, value: value ?? '', onchange: () => f.onChange?.(el.get()) });
    el.get = () => (el.value === '' ? null : Number(el.value)); el.set = (v) => { el.value = v ?? ''; };
  } else if (f.t === 'date') {
    el = h('input', { type: 'date', value: value || '', onchange: () => f.onChange?.(el.value) }); el.get = () => el.value || null; el.set = (v) => { el.value = v || ''; };
  } else if (f.t === 'month') {
    el = h('input', { type: 'month', value: value || '', onchange: () => f.onChange?.(el.value) }); el.get = () => el.value || null; el.set = (v) => { el.value = v || ''; };
  } else if (f.t === 'bool') {
    el = h('input', { type: 'checkbox', checked: !!value }); el.get = () => el.checked; el.set = (v) => { el.checked = !!v; };
  } else {
    el = h('input', { type: f.t === 'password' ? 'password' : 'text', value: value ?? '', placeholder: f.ph, onchange: () => f.onChange?.(el.value) }); el.get = () => el.value.trim(); el.set = (v) => { el.value = v ?? ''; };
  }
  if (f.readonly) { el.setAttribute('readonly', ''); el.setAttribute('disabled', ''); el.classList?.add('ro'); }
  return el;
}

/** نموذج من تعريفات الحقول — يرجع {el, values(), set(k,v), inputs} */
export function formGrid(fields, values = {}, cols = 2) {
  const inputs = {};
  const el = h('div.fgrid.c' + cols, fields.filter((f) => !f.hidden).map((f) => {
    const inp = fieldInput(f, values[f.k]); inputs[f.k] = inp;
    return h((f.t === 'multifk' ? 'div' : 'label') + '.fld' + (f.wide ? '.wide' : '') + (f.req ? '.req' : ''), h('span', f.l, f.action ? h('button.btn.sm.inline-act', { type: 'button', onclick: (e) => { e.preventDefault(); f.action.onClick(); } }, f.action.label) : null), inp, f.help ? h('small', f.help) : null);
  }));
  return { el, inputs, values: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.get()])), set: (k, v) => inputs[k]?.set(v) };
}

// ---------- الجداول ----------
export function table({ cols, rows, onRow, empty = 'لا توجد بيانات', foot, rowClass, search = true, name = 'export', compact = false, maxRows = 500 }) {
  const wrap = h('div.tbl-wrap');
  let q = '';
  const text = (r, c) => (c.text ? c.text(r) : c.fmt ? c.fmt(r[c.k], r) : r[c.k]);
  const draw = () => {
    const shown = rows.filter((r) => !q || cols.some((c) => String(text(r, c) ?? '').toLowerCase().includes(q)));
    const limited = shown.slice(0, maxRows);
    const tb = h('table.tbl' + (compact ? '.compact' : ''), h('thead', h('tr', cols.map((c) => h('th' + (c.num ? '.num' : ''), { style: c.w ? { width: c.w } : null }, c.l)))),
      h('tbody', limited.length ? limited.map((r) => h('tr' + (onRow ? '.click' : '') + (rowClass ? '.' + (rowClass(r) || '') : ''), { onclick: onRow ? () => onRow(r) : null },
        cols.map((c) => { const v = c.render ? c.render(r) : text(r, c); return h('td' + (c.num ? '.num' : '') + (c.cls ? '.' + c.cls : ''), v === null || v === undefined ? '' : v); })))
        : h('tr', h('td.empty', { colspan: cols.length }, empty))),
      foot && shown.length ? h('tfoot', h('tr', cols.map((c, i) => h('td' + (c.num ? '.num' : ''), foot(c, shown, i)))) ) : null);
    wrap.replaceChildren(tb, shown.length > maxRows ? h('div.hint', `يظهر أول ${maxRows} من ${shown.length} — استخدم البحث أو الفلاتر`) : null);
    if (counter) counter.textContent = `${shown.length} سجل`;
  };
  const counter = h('span.count');
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const shown = rows.filter((r) => !q || cols.some((c) => String(text(r, c) ?? '').toLowerCase().includes(q)));
    const csv = [cols.map((c) => esc(c.l)).join(','), ...shown.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : text(r, c))).join(','))].join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })), download: `${name}.csv` }); a.click();
  };
  const bar = h('div.tbl-bar', search ? h('input.search', { type: 'search', placeholder: 'بحث…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }) : null, counter,
    h('span.grow'), h('button.btn.sm', { onclick: exportCsv }, '⤓ Excel (CSV)'), h('button.btn.sm', { onclick: () => window.print() }, '🖨 طباعة'));
  draw();
  const root = h('div', bar, wrap); root.redraw = (newRows) => { if (newRows) rows = newRows; draw(); };
  return root;
}

export const badge = (txt, kind = '') => h('span.badge' + (kind ? '.' + kind : ''), txt);
export const statusBadge = (s) => ({ posted: badge('معتمد', 'ok'), void: badge('ملغي', 'bad'), open: badge('مفتوح', 'info'), partial: badge('جزئي', 'warn'), received: badge('تم الاستلام', 'ok'), closed: badge('مغلق', ''), ordered: badge('تم الأمر', 'ok') }[s] || badge(s));

// ---------- صفحات ----------
export function pageHead(title, ...actions) { return h('div.page-head', h('h2', title), h('span.grow'), actions); }
export function card(title, ...body) { return h('section.card', title ? h('h3', title) : null, body); }
export function kpi(label, value, sub, kind) { return h('div.kpi' + (kind ? '.' + kind : ''), h('small', label), h('b', value), sub ? h('em', sub) : null); }
export function filterBar(fields, onRun, init = {}) {
  let refresh = () => {};
  // أي استعلام فيه من/إلى تاريخ: الافتراضي من أول الشهر لحد النهارده (إلا لو الشاشة حددت غير كده)
  if (fields.some((x) => x.k === 'from') && fields.some((x) => x.k === 'to')) { init = { ...init }; if (init.from === undefined) init.from = monthStart(); if (init.to === undefined || init.to === '') init.to = today(); }
  const f = formGrid(fields.map((x) => ({ ...x, onChange: (v) => { x.onChange?.(v); refresh(); } })), init, fields.length > 4 ? 4 : fields.length);
  // حقول لها showIf(values) تظهر/تختفي حسب باقي الفلاتر
  refresh = () => { const vals = f.values(); for (const x of fields) if (x.showIf) { const lab = f.inputs[x.k]?.closest('label'); const on = x.showIf(vals); if (lab) lab.style.display = on ? '' : 'none'; if (!on) f.set(x.k, null); } };
  setTimeout(refresh, 0);
  const run = guard(async () => onRun(f.values()));
  const bar = h('div.filters', f.el, h('button.btn.primary', { onclick: run }, 'عرض'));
  bar.values = f.values; bar.run = run; bar.set = f.set;
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  return bar;
}
export const tag = (txt) => h('span.tag', txt);
