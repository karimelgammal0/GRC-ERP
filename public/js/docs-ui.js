// ============================================================
//  شاشة مستندات عامة: قائمة + فلاتر + محرر (رأس + بنود + إجماليات)
// ============================================================
import { entryUnits, toBaseQty } from './units.js';
import { h, GET, POST, PUT, L, fmt, fq, today, monthStart, yearStart, table, filterBar, formGrid, fieldInput, pageHead, card, toast, guard, confirmBox, statusBadge, byId, nameOf } from './core.js';

export function docScreen(cfg) {
  return function render(root, params = {}) {
    const host = h('div'); root.replaceChildren(host);
    const showList = () => {
      const tableHost = h('div');
      const fields = [{ k: 'from', l: 'من تاريخ', t: 'date' }, { k: 'to', l: 'إلى تاريخ', t: 'date' }, ...(cfg.filters || []),
        { k: 'status', l: 'الحالة', t: 'select', options: [['', 'الكل'], ['posted', 'معتمد'], ['void', 'ملغي'], ...(cfg.statuses || [])] }];
      const load = async (v) => {
        const rows = await GET(`/doc/${cfg.type}`, { ...cfg.fixed, ...v });
        const t = table({ cols: cfg.listCols, rows, onRow: (r) => showEditor(r.id), rowClass: (r) => (r.status === 'void' ? 'void' : ''), name: cfg.title, foot: cfg.listFoot, empty: `لا توجد ${cfg.title}` });
        tableHost.replaceChildren(t);
      };
      const dv = (v) => (typeof v === 'function' ? v() : v);
      const fb = filterBar(fields, load, { from: dv(cfg.defaultFrom) ?? yearStart(), ...(cfg.defaultTo ? { to: dv(cfg.defaultTo) } : {}) });
      host.replaceChildren(pageHead(cfg.title, cfg.canCreate === false ? null : h('button.btn.primary', { onclick: () => showEditor(null) }, `＋ ${cfg.newLabel || 'جديد'}`)), cfg.note ? h('div.note', cfg.note) : null, fb, tableHost);
      fb.run();
    };

    const showEditor = guard(async (id, init) => {
      const E = cfg.editor;
      const doc = id ? await GET(`/doc/${cfg.type}/${id}`) : null;
      const st = { header: { date: today(), ...(E.defaults?.() || {}), ...(init || {}), ...(doc || {}) }, lines: doc?.lines ? doc.lines.map((l) => ({ ...l })) : (init?.lines ? init.lines : []), doc, ctx: null };
      if (!doc && E.lines && !st.lines.length) st.lines = [E.lines.blank?.() || {}];
      const readonly = doc?.status === 'void';
      const ctx = {
        st, get header() { return st.header; }, get lines() { return st.lines; }, doc,
        setHeader(k, v) { st.header[k] = v; hf?.set(k, v); },
        setLines(arr) { st.lines = arr; drawLines(); updateTotals(); },
        rebuildHeader() { drawHeader(); }, refresh() { refreshComputed(); updateTotals(); }, redrawExtra() { drawExtra(); }, toast,
      };
      st.ctx = ctx;
      const headerHost = h('div'); const linesHost = h('div'); const totalsHost = h('div.totals'); const extraHost = h('div');
      let hf = null; let calcCells = [];

      const drawHeader = () => {
        const defs = (typeof E.header === 'function' ? E.header(ctx) : E.header).map((f) => ({
          ...f, readonly: f.readonly || readonly || (doc && f.lockOnEdit),
          onChange: (v) => { st.header[f.k] = v; f.onChange?.(v, ctx); E.onHeader?.(f.k, v, ctx); if (E.rebuildOn?.includes(f.k)) { drawHeader(); } updateTotals(); },
        }));
        hf = formGrid(defs, st.header, E.cols || 3);
        headerHost.replaceChildren(hf.el);
      };

      const refreshComputed = () => calcCells.forEach(({ td, c, l }) => { const v = c.calc(l, ctx); td.textContent = c.fmt ? c.fmt(v) : (v ?? ''); td.className = 'ro' + (v < 0 ? ' neg' : ''); });
      const drawLines = () => {
        if (!E.lines) { linesHost.replaceChildren(); return; }
        calcCells = []; const cols = typeof E.lines.cols === 'function' ? E.lines.cols(ctx) : E.lines.cols;
        const tb = h('tbody');
        st.lines.forEach((l, i) => {
          const tr = h('tr', cols.map((c) => {
            const td = h('td', { style: c.w ? { width: c.w } : null });
            if (c.calc) { td.className = 'ro'; calcCells.push({ td, c, l }); td.textContent = c.fmt ? c.fmt(c.calc(l, ctx)) : (c.calc(l, ctx) ?? ''); return td; }
            if (c.render) { td.append(c.render(l, ctx, readonly)); return td; }
            const inp = fieldInput({ ...c, filter: c.filter ? (x) => c.filter(x, l, ctx) : undefined, readonly: c.readonly || readonly, combo: c.combo ?? (c.t === 'fk' && c.ref === 'materials'), onChange: (v) => { l[c.k] = v; c.onChange?.(v, l, ctx); E.onLine?.(i, c.k, v, ctx); refreshComputed(); updateTotals(); } }, l[c.k]);
            td.append(inp); return td;
          }), readonly || E.lines.fixed ? null : h('td', h('button.del', { title: 'حذف البند', onclick: () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push(E.lines.blank?.() || {}); drawLines(); updateTotals(); } }, '×')));
          tb.append(tr);
        });
        linesHost.replaceChildren(h('table.lines', h('thead', h('tr', cols.map((c) => h('th', c.l)), readonly || E.lines.fixed ? null : h('th'))), tb),
          readonly || E.lines.fixed ? null : h('div.actions', h('button.btn.sm', { onclick: () => { st.lines.push(E.lines.blank?.() || {}); drawLines(); } }, '＋ بند'),
            ...(E.tools || []).map((t) => h('button.btn.sm', { onclick: guard(async () => { await t.run(ctx); }) }, t.label))));
      };
      const updateTotals = () => {
        totalsHost.replaceChildren(...(E.totals?.(ctx) || []).map(([l, v, cls]) => h('div' + (cls ? '.' + cls : ''), h('small', l), h('b', v))));
      };
      const drawExtra = () => { if (E.extra) extraHost.replaceChildren(E.extra(ctx) || ''); };

      const save = guard(async () => {
        const v = hf.values(); const payload = { ...st.header, ...v, lines: st.lines.map(({ ...l }) => l) };
        E.prepare?.(payload, ctx);
        const saved = id ? await PUT(`/doc/${cfg.type}/${id}`, payload) : await POST(`/doc/${cfg.type}`, payload);
        toast(`تم الحفظ — ${saved.no}`); E.afterSave?.(saved); showList();
      });
      const voidIt = guard(async () => {
        if (!(await confirmBox(`إلغاء ${cfg.noun} ${doc.no}؟ سيتم عكس أثره على المخزون والحسابات.`, 'إلغاء المستند', true))) return;
        await POST(`/doc/${cfg.type}/${id}/void`); toast('تم الإلغاء'); showList();
      });

      drawHeader(); drawLines(); updateTotals(); drawExtra();
      host.replaceChildren(
        h('div.crumb', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showList(); } }, '← ' + cfg.title)),
        h('div.doc-head', h('span.doc-no', doc ? doc.no : `${cfg.noun} جديد`), doc ? statusBadge(doc.status) : null, h('span.grow'),
          doc ? h('button.btn.sm', { onclick: () => window.print() }, '🖨 طباعة') : null,
          doc && !readonly && cfg.canVoid !== false ? h('button.btn.sm.danger', { onclick: voidIt }, 'إلغاء المستند') : null),
        readonly ? h('div.note.bad', 'هذا المستند ملغي — للعرض فقط.') : null,
        doc && !readonly ? h('div.note', 'تعديل المستند يعكس أثره القديم ويرحّل الجديد تلقائياً (المخزون والتكلفة والقيود).') : null,
        E.intro ? h('div.note', E.intro) : null,
        card(null, headerHost), E.lines ? card(E.lines.title || 'البنود', linesHost) : null, E.extra ? card(E.extraTitle || null, extraHost) : null,
        h('div.card', totalsHost),
        readonly ? (E.buttons ? h('div.actions', E.buttons(ctx)) : null) : h('div.actions', h('button.btn.primary', { onclick: save }, doc ? 'حفظ التعديل' : 'حفظ واعتماد'), h('button.btn', { onclick: showList }, 'رجوع'), ...(E.buttons?.(ctx) || [])));
      if (E.onOpen) await E.onOpen(ctx);
    });

    if (params.new) showEditor(null, params.init); else if (params.id) showEditor(Number(params.id)); else showList();
  };
}

// حقول جاهزة مشتركة
export const dateF = { k: 'date', l: 'التاريخ', t: 'date', req: 1 };
export const notesF = { k: 'notes', l: 'ملاحظات', t: 'text', wide: true };
/** عمود الكمية في أسطر المستندات: لو الخامة ليها وحدات فرعية/رئيسية مرتبطة، بتقدر تدخل الكمية بأي وحدة منهم
 *  والقيمة المحفوظة (qty) دايماً بوحدة الخامة الأساسية. (_eu/_ev حالة واجهة فقط ومبتتحفظش) */
export const qtyCol = ({ l = 'الكمية', w = '130px' } = {}) => ({
  k: 'qty', l, w,
  render(line, ctx, readonly) {
    const baseId = byId('materials', line.material_id)?.unit_id;
    const opts = entryUnits(L.units || [], baseId);
    const baseName = opts[0]?.name || '';
    const cur = opts.find((o) => o.id === line._eu) || opts[0];
    const shown = cur && cur.toBase !== 1 && line._ev !== undefined ? line._ev : line.qty;
    const inp = h('input', { type: 'number', step: 'any', min: 0, value: shown ?? '' });
    const hint = h('small.muted');
    const sel = opts.length > 1 ? h('select', { style: { minWidth: '70px' } }, opts.map((o) => h('option', { value: o.id, selected: o.id === cur.id }, o.name))) : null;
    const curOpt = () => (sel ? opts.find((o) => o.id === Number(sel.value)) : opts[0]) || { toBase: 1 };
    const sync = () => {
      const o = curOpt(); const v = inp.value === '' ? null : Number(inp.value);
      line._eu = o.id; line._ev = v; line.qty = v === null ? null : (o.toBase === 1 ? v : toBaseQty(v, o.toBase));
      hint.textContent = o.toBase !== 1 && line.qty !== null ? `= ${fq(line.qty)} ${baseName}` : '';
      ctx.refresh();
    };
    inp.onchange = sync; if (sel) sel.onchange = sync;
    if (readonly) { inp.setAttribute('readonly', ''); inp.setAttribute('disabled', ''); sel?.setAttribute('disabled', ''); }
    if (cur && cur.toBase !== 1 && line.qty !== null && line.qty !== undefined) hint.textContent = `= ${fq(line.qty)} ${baseName}`;
    return h('div.qty-entry', inp, sel, hint);
  },
});
/** لما الخامة تتغير: ارجع لوحدة الخامة وأعد رسم الأسطر (قائمة الوحدات بتتغير) */
export const matChange = (v, l, ctx) => { l._eu = null; l._ev = undefined; ctx.setLines(ctx.lines); };
export const total = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export { fmt, fq, nameOf, byId };
