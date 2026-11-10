import { h, GET, POST, L, META, fmt, fq, today, monthStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, labelOf, statusBadge, toast, guard, modal, fieldInput, CLASS_OPTS } from '../core.js';
import { docScreen, dateF, notesF, total } from '../docs-ui.js';

const empCol = { k: 'employee_id', l: 'العامل', t: 'fk', ref: 'employees', req: 1, combo: true, w: '24%' };
const classOf = (id) => byId('employees', id)?.cost_class;

// ---------------- كشف يومية العمالة ----------------
export const laborSheetsPage = docScreen({ perm: 'hr.labor',
  type: 'labor_sheet', title: 'يوميات العمالة', noun: 'كشف يومية', newLabel: 'كشف يومية جديد',
  note: 'سجّل العمالة اليومية: كل عامل بعدد أيامه وأجره، ومحمّل على مشروع/بند/مرحلة. العمالة المباشرة بتتحمّل على مرحلة التصنيع، وغير المباشرة والإدارية على حساباتها بدون مشروع.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'n_lines', l: 'عدد العاملين', num: true }, { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) },
    { k: 'paid_amount', l: 'المصروف', num: true, fmt: (v) => fmt(v) }, { k: 'rem', l: 'المتبقي', num: true, text: (r) => (r.status === 'void' ? '' : fmt(r.total - r.paid_amount)) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    cols: 3, header: [dateF, { ...notesF, wide: false }],
    lines: { blank: () => ({ days: 1 }), cols: [
      { ...empCol, onChange: (v, l, ctx) => { const e = byId('employees', v); if (!e) return; l.rate = e.daily_rate; l.stage_id = e.cost_class === 'direct' ? e.default_stage_id : null; ctx.setLines(ctx.lines); } },
      { k: 'days', l: 'الأيام', t: 'number', w: '80px', step: '0.25' }, { k: 'rate', l: 'أجر اليوم', t: 'number', w: '100px' },
      { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true, w: '17%', onChange: (v, l, ctx) => { const it = byId('project_items', l.item_id); if (it && it.project_id !== v) { l.item_id = null; ctx.setLines(ctx.lines); } } },
      { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', combo: true, w: '17%', filter: (x, l) => !l.project_id || x.project_id === l.project_id },
      { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages', w: '110px' },
      { l: 'التصنيف', calc: (l) => labelOf(CLASS_OPTS, classOf(l.employee_id)).split(' (')[0] }, { l: 'المبلغ', calc: (l) => (Number(l.days) || 0) * (Number(l.rate) || 0), fmt: (v) => fmt(v), w: '100px' }] },
    totals: (ctx) => [['إجمالي الأيام', fq(total(ctx.lines, (l) => l.days))], ['إجمالي الأجور', fmt(total(ctx.lines, (l) => (Number(l.days) || 0) * (Number(l.rate) || 0)))]],
  },
});

// ---------------- مسير الرواتب الشهرية ----------------
function allocLabel(l) {
  if (classOf(l.employee_id) !== 'direct') return h('span.tag', 'لا يحتاج');
  const a = l.allocations;
  if (!a?.length) return h('span', { style: { color: 'var(--ink2)' } }, `100% — ${nameOf('stages', byId('employees', l.employee_id)?.default_stage_id)}`);
  return h('span', a.map((x) => `${x.percent}% ${nameOf('stages', x.stage_id)}${x.project_id ? ' / ' + nameOf('projects', x.project_id) : ''}`).join('، '));
}
export const payrollPage = docScreen({ perm: 'hr.payroll',
  type: 'payroll', title: 'الرواتب الشهرية', noun: 'مسير رواتب', newLabel: 'مسير شهري جديد',
  note: 'المرتب الشهري للعامل المباشر بيتوزّع على المشروعات والمراحل بنسب (زر «توزيع») — والغير مباشر والإداري بيروحوا لحساباتهم.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'month', l: 'الشهر' }, { k: 'date', l: 'التاريخ' }, { k: 'n_lines', l: 'العاملين', num: true }, { k: 'gross', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }, { k: 'deductions', l: 'الاستقطاعات', num: true, fmt: (v) => fmt(v) }, { k: 'net', l: 'الصافي', num: true, fmt: (v) => fmt(v) }, { k: 'paid_amount', l: 'المصروف', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ month: today().slice(0, 7), date: today() }), header: [{ k: 'month', l: 'الشهر', t: 'month', req: 1 }, dateF, { ...notesF, wide: false }],
    lines: { blank: () => ({ additions: 0, deductions: 0 }), cols: [
      { ...empCol, filter: (x) => x.emp_type === 'monthly', onChange: (v, l, ctx) => { const e = byId('employees', v); if (e) { l.base = e.monthly_salary; l.allocations = []; ctx.setLines(ctx.lines); } } },
      { k: 'base', l: 'المرتب الأساسي', t: 'number', w: '120px' }, { k: 'additions', l: 'إضافات', t: 'number', w: '100px' }, { k: 'deductions', l: 'استقطاعات', t: 'number', w: '100px' },
      { l: 'الصافي', calc: (l) => (Number(l.base) || 0) + (Number(l.additions) || 0) - (Number(l.deductions) || 0), fmt: (v) => fmt(v), w: '110px' },
      { l: 'توزيع التكلفة', render: (l, ctx, ro) => {
        const box = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }); const lab = h('span', allocLabel(l)); box.append(lab);
        if (!ro && classOf(l.employee_id) === 'direct') box.append(h('button.btn.sm', { onclick: () => allocModal(l, () => { lab.replaceChildren(allocLabel(l)); }) }, 'توزيع'));
        return box; } }] },
    tools: [{ label: 'تحميل كل الشهريين', run: (ctx) => {
      const rows = L.employees.filter((e) => e.active && e.emp_type === 'monthly'); if (!rows.length) throw new Error('لا يوجد عاملين شهريين — أضفهم من الإعدادات ← العاملين');
      ctx.setLines(rows.map((e) => ({ employee_id: e.id, base: e.monthly_salary, additions: 0, deductions: 0, allocations: [] })));
    } }],
    totals: (ctx) => [['الإجمالي', fmt(total(ctx.lines, (l) => (Number(l.base) || 0) + (Number(l.additions) || 0)))], ['الاستقطاعات', fmt(total(ctx.lines, (l) => l.deductions))], ['صافي المستحق', fmt(total(ctx.lines, (l) => (Number(l.base) || 0) + (Number(l.additions) || 0) - (Number(l.deductions) || 0))), 'ok']],
  },
});
function allocModal(l, done) {
  let rows = (l.allocations?.length ? l.allocations : [{ stage_id: byId('employees', l.employee_id)?.default_stage_id, percent: 100 }]).map((x) => ({ ...x }));
  const body = h('div'); const sumEl = h('b');
  const draw = () => {
    body.replaceChildren(h('table.lines', h('thead', h('tr', ['المشروع', 'البند', 'المرحلة', 'النسبة %', ''].map((x) => h('th', x)))),
      h('tbody', rows.map((r, i) => h('tr',
        h('td', fieldInput({ t: 'fk', ref: 'projects', combo: true, onChange: (v) => { r.project_id = v; r.item_id = null; draw(); } }, r.project_id)),
        h('td', fieldInput({ t: 'fk', ref: 'project_items', combo: true, filter: (x) => !r.project_id || x.project_id === r.project_id, onChange: (v) => { r.item_id = v; } }, r.item_id)),
        h('td', fieldInput({ t: 'fk', ref: 'stages', req: 1, onChange: (v) => { r.stage_id = v; } }, r.stage_id)),
        h('td', fieldInput({ t: 'number', onChange: (v) => { r.percent = v; upd(); } }, r.percent)),
        h('td', h('button.del', { onclick: () => { rows.splice(i, 1); draw(); } }, '×')))))),
      h('div.actions', h('button.btn.sm', { onclick: () => { rows.push({ percent: 0 }); draw(); } }, '＋ سطر'), h('span.grow'), h('span', 'المجموع: ', sumEl, '%'))); upd();
  };
  const upd = () => { const s = rows.reduce((a, r) => a + (Number(r.percent) || 0), 0); sumEl.textContent = fq(s); sumEl.style.color = Math.abs(s - 100) < 0.01 ? 'var(--ok)' : 'var(--bad)'; };
  draw();
  modal({ title: 'توزيع تكلفة المرتب على المشروعات والمراحل', wide: true, body, buttons: [{ label: 'تطبيق', cls: 'primary', onClick: () => {
    if (Math.abs(rows.reduce((a, r) => a + (Number(r.percent) || 0), 0) - 100) > 0.01) throw new Error('مجموع النسب لازم يساوي 100%');
    if (rows.some((r) => !r.stage_id)) throw new Error('حدد المرحلة في كل سطر');
    l.allocations = rows.map((r) => ({ project_id: r.project_id || null, item_id: r.item_id || null, stage_id: r.stage_id, percent: Number(r.percent) })); done(); } }] });
}
