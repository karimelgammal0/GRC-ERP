// ============================================================
//  مكونات الواجهة المشتركة (بدون أي مكتبات خارجية)
// ============================================================
export const $ = (sel, el = document) => el.querySelector(sel);

/** h('div.cls#id', {onclick, style:{}}, ...children) */
// replaceChildren الأصلية بتحوّل null إلى نص "null" — نتجاهل القيم الفارغة
{ const orig = Element.prototype.replaceChildren; Element.prototype.replaceChildren = function (...a) { return orig.apply(this, a.flat().filter((x) => x !== null && x !== undefined && x !== false)); }; }
export function h(tag, props, ...kids) {
  if (typeof tag === 'string') tag = tag.replace(/[.#]+(?=[.#]|$)/g, ''); // يتجاهل نقطة فاضية في آخر الاسم (كلاس فاضي)
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
export const fq = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
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
export const L = {}; export const META = {}; export const APP = {}; // APP: دوال بتسجلها الواجهة (مش بتتكتب فوقها من السيرفر)
export async function loadLookups() { Object.assign(L, await GET('/lookups')); L.materials_all = [...(L.materials || []), ...(L.fg_materials || [])]; }
export async function loadMeta() { Object.assign(META, await GET('/meta')); }
/** صلاحية المستخدم الحالي: can('inventory.issues') = يشوف الصفحة، can('inventory.issues.create') = زرار الإنشاء. المدير يقدر على كل شيء */
export const can = (key) => { const m = META.me; if (!m) return false; if (m.role === 'admin') return true; return (m._set ||= new Set(m.perms || [])).has(key); };
export const canAny = (keys) => keys.some(can);
export const byId = (list, id) => (L[list] || []).find((x) => x.id === Number(id));
// مراحل الإدخال: المرحلة الفرعية لو للرئيسية فروع، والرئيسية نفسها لو معندهاش فروع
export const leafStage = (x) => !(L.stages || []).some((c) => c.parent_id === x.id && c.active !== 0);
export const nameOf = (list, id) => { const x = byId(list, id); return x ? (x.full_name || x.name) : ''; };   // full_name: «الصب › المرحلة الفرعية»
export const codeName = (x) => (x ? `${x.code} — ${x.full_name || x.name}` : '');
export const labelOf = (opts, v) => (opts.find(([k]) => k === v) || [])[1] ?? v ?? '';
export const CLASS_OPTS = [['direct', 'مباشرة (مرحلة تصنيع)'], ['indirect', 'تكلفة غير مباشرة'], ['admin', 'مصروفات إدارية']];

// ---------- حقل بحث (Combo) للقوائم الطويلة ----------
export function combo({ list, value, onChange, filter, placeholder = 'ابحث بالاسم أو الكود…', allowEmpty = true, items, readonly = false }) {
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
    // جوه جدول بيتحرك بالعرض (lines-scroll) القايمة بتتثبّت بالإحداثيات عشان متتقصش
    if (input.closest('.lines-scroll')) {
      const r = input.getBoundingClientRect(); const w = Math.max(r.width, 300);
      Object.assign(box.style, { position: 'fixed', top: `${r.bottom + 2}px`, width: `${w}px`, insetInline: 'auto', left: `${Math.max(4, Math.min(r.right - w, window.innerWidth - w - 4))}px` });
    }
  };
  const pick = (id) => { cur = id; show(id); box.style.display = 'none'; onChange?.(id); };
  input.addEventListener('focus', () => { input.select(); typed = false; hi = 0; render(); });
  input.addEventListener('input', () => { typed = true; hi = 0; render(); });
  input.addEventListener('blur', () => { box.style.display = 'none'; show(cur); });
  window.addEventListener('scroll', () => { if (box.style.position === 'fixed') box.style.display = 'none'; }, true);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (shown[hi]) { pick(shown[hi].id); e.preventDefault(); } }
    else if (e.key === 'Escape') { box.style.display = 'none'; }
  });
  wrap.get = () => cur; wrap.set = (v) => { cur = v ? Number(v) : null; show(cur); };
  // مقفول (مستند معتمد/عرض فقط): مفيش فتح للقايمة ولا تعديل
  if (readonly) { input.readOnly = true; input.disabled = true; input.placeholder = ''; caret.style.display = 'none'; wrap.classList.add('ro'); }
  return wrap;
}

// ---------- حقول النماذج ----------
/** يبني حقل إدخال ويرجع عنصر له get()/set() */
export function fieldInput(f, value) {
  let el;
  if (f.t === 'fk' || f.t === 'lookup') {
    const long = (L[f.ref] || []).length > 14 || f.combo;
    if (long) el = combo({ list: f.ref, value, filter: f.filter, allowEmpty: !f.req, readonly: !!f.readonly, onChange: (v) => f.onChange?.(v) });
    else {
      el = h('select', { onchange: () => f.onChange?.(el.get()) }, f.req ? (f.blankIfEmpty && (value === null || value === undefined || value === '') ? h('option', { value: '', selected: true }, '— اختر —') : null) : h('option', { value: '' }, '—'),
        (() => {
          // لو القيمة المحفوظة مش ضمن الخيارات المفلترة (مرحلة رئيسية قديمة بقى ليها فرعية مثلاً) بنضيفها عشان تظهر صح بدل ما تظهر أول خيار
          const opts = (L[f.ref] || []).filter((x) => x.active !== 0 && (!f.filter || f.filter(x)));
          const cur = value === null || value === undefined || value === '' ? null : (L[f.ref] || []).find((x) => x.id === Number(value));
          if (cur && !opts.some((x) => x.id === cur.id)) opts.unshift(cur);
          return opts.map((x) => h('option', { value: x.id, selected: Number(value) === x.id }, codeName(x)));
        })());
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
    el = h('input', { type: 'number', step: f.step || 'any', min: f.min, value: (f.blankZero && Number(value) === 0) ? '' : (value ?? ''), onchange: () => f.onChange?.(el.get()) });
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
export function table({ cols, rows, onRow, empty = 'لا توجد بيانات', foot, rowClass, search = true, name = 'export', compact = false, maxRows = 500, center = false }) {
  const wrap = h('div.tbl-wrap');
  let q = '';
  const text = (r, c) => (c.text ? c.text(r) : c.fmt ? c.fmt(r[c.k], r) : r[c.k]);
  // ترتيب بالضغط على عنوان العمود (تصاعدي ← تنازلي ← الترتيب الأصلي)
  let sort = null;
  const sortable = (c) => c.l && !String(c.k || '').startsWith('_') && c.sortable !== false;
  const sval = (r, c) => { let v = c.sortVal ? c.sortVal(r) : (c.k && r[c.k] !== undefined && r[c.k] !== null ? r[c.k] : text(r, c)); if (c.num && typeof v !== 'number') { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); v = Number.isNaN(n) ? 0 : n; } return v ?? ''; };
  const clickSort = (i) => { sort = !sort || sort.i !== i ? { i, dir: 1 } : sort.dir === 1 ? { i, dir: -1 } : null; draw(); };
  const draw = () => {
    let shown = rows.filter((r) => !q || cols.some((c) => String(text(r, c) ?? '').toLowerCase().includes(q)));
    if (sort) { const c = cols[sort.i]; shown = [...shown].sort((a, b) => { const x = sval(a, c), y = sval(b, c); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar', { numeric: true })) * sort.dir; }); }
    const limited = shown.slice(0, maxRows);
    const tb = h('table.tbl' + (compact ? '.compact' : '') + (center ? '.ctr' : ''), h('thead', h('tr', cols.map((c, i) => (sortable(c)
      ? h('th.sortable' + (c.num ? '.num' : ''), { style: c.w ? { width: c.w } : null, title: 'اضغط للترتيب', onclick: () => clickSort(i) }, c.l, sort?.i === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')
      : h('th' + (c.num ? '.num' : ''), { style: c.w ? { width: c.w } : null }, c.l))))),
      h('tbody', limited.length ? limited.map((r) => h('tr' + (onRow ? '.click' : '') + (rowClass && rowClass(r) ? '.' + rowClass(r) : ''), { onclick: onRow ? () => onRow(r) : null },
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

/** طباعة مستند بشكل رسمي (رأس الشركة + بيانات + جدول بنود + إمضاءات) عبر iframe مخفي */
export function printSheet({ title, no, date, meta = [], cols = [], rows = [], totals = [], notes = '', sign = [], actual = null, by = '', module = '', landscape = false, foot = null, sections = [] }) {
  const e = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${e(title)} ${e(no)}</title><style>
    body{font-family:Tahoma,Arial,sans-serif;font-size:13px;color:#111;margin:24px}
    .top{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
    .co{font-size:17px;font-weight:700;display:inline-flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.co img{max-height:64px;max-width:180px;object-fit:contain}.dn{display:flex;flex-direction:column;align-items:flex-end;gap:2px;margin:-2px 0 10px}.ttl{font-size:20px;font-weight:700;text-align:center;margin:6px 0 12px}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 16px;margin-bottom:12px}.meta b{color:#555;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #444;padding:5px 7px;text-align:right}th{background:#eee}
    td.n{text-align:center}.tot{display:flex;justify-content:flex-end;gap:24px;font-weight:700;margin-bottom:10px}
    .sig{display:flex;justify-content:space-around;margin-top:48px}.sig>div{text-align:center;min-width:140px}.sig .jb{font-weight:700;border-bottom:1px solid #111;padding-bottom:6px}.sig .nm{font-size:14px;min-height:22px;margin-top:34px}
    ${landscape ? '@page{size:A4 landscape;margin:8mm}body{margin:0;font-size:10px}table{table-layout:auto;font-size:9.5px}th,td{padding:2px 4px}.ttl{font-size:16px;margin:2px 0 6px}.sig{margin-top:22px}.sig .nm{margin-top:18px}.top{padding-bottom:4px;margin-bottom:4px}.co img{max-height:40px}tr{page-break-inside:avoid}' : ''}
    tfoot td{font-weight:700;background:#f3f3f3}.sec{margin:8px 0 3px;font-weight:700}.tot{flex-wrap:wrap;gap:6px 18px}.sumt{width:auto;min-width:50%}
    .pby{margin-top:28px;font-size:11px;color:#555;text-align:left;direction:rtl}
  </style></head><body>
    <div class="top"><div class="co">${META.settings?.company_logo ? `<img src="${e(META.settings.company_logo)}" alt="">` : ''}<span>${e(META.settings?.company_name || '')}</span></div></div>
    <div class="dn"><span>رقم: <b>${e(no)}</b></span><span>التاريخ: <b>${e(date)}</b></span></div>
    <div class="ttl">${e(title)}</div>
    <div class="meta">${meta.filter((m) => m[1]).map(([k, v]) => `<div><b>${e(k)}:</b> ${e(v)}</div>`).join('')}</div>
    <table><thead><tr><th>#</th>${cols.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody>${foot ? `<tfoot><tr><td></td>${foot.map((c) => `<td class="n">${e(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>
    ${totals.length ? `<div class="tot">${totals.map(([k, v]) => `<span>${e(k)}: ${e(v)}</span>`).join('')}</div>` : ''}
    ${sections.map((x) => `<div class="sec">${e(x.title)}</div><table class="sumt"><thead><tr>${x.cols.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${x.rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody>${x.foot ? `<tfoot><tr>${x.foot.map((c, i) => `<td${i ? ' class="n"' : ''}>${e(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`).join('')}
    ${notes ? `<div><b>ملاحظات:</b> ${e(notes)}</div>` : ''}
    <div class="sig">${((module && META.jobs_order && Object.prototype.hasOwnProperty.call(META.jobs_order, module)) ? META.jobs_order[module] : sign).map((s) => { const names = actual ? [] : (META.signers?.[module]?.[s] || []); const nm = actual ? (actual[s] || '') : (by && names.includes(by) ? by : names.join(' / ')); return `<div><div class="jb">${e(s)}</div><div class="nm">${e(nm)}</div></div>`; }).join('')}</div>
    <div class="pby">طُبع بواسطة: ${e(META.me?.employee_name || META.me?.name || META.me?.username || '')} — ${e(new Date().toLocaleString('en-GB'))}</div></body></html>`;
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f); const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 250);
}
