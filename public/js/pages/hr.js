import { h, GET, POST, L, META, fmt, fq, today, monthStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, labelOf, statusBadge, toast, guard, modal, fieldInput, CLASS_OPTS } from '../core.js';
import { docScreen, dateF, notesF, total } from '../docs-ui.js';

const empCol = { k: 'employee_id', l: 'العامل', t: 'fk', ref: 'employees', req: 1, combo: true, w: '24%' };
const classOf = (id) => byId('employees', id)?.cost_class;

// ---------------- كشف يومية العمالة ----------------
// يومية العمالة: قيمة الأساسي = أيام الأساسي × اليومية، قيمة السهرات = أيام السهرات × اليومية
const lbBasic = (l) => Math.round(((Number(l.days) || 0) * (Number(l.rate) || 0)) * 100) / 100;
const lbOt = (l) => Math.round(((Number(l.ot_days) || 0) * (Number(l.rate) || 0)) * 100) / 100;
const lbNet = (l) => Math.round((lbBasic(l) + lbOt(l) + (Number(l.other_additions) || 0) - (Number(l.other_deductions) || 0) - (Number(l.advance) || 0)) * 100) / 100;

// سلف عمال يومية → عمود «سلفة المدة»: مجموع سلف العامل المصروفة داخل مدة الكشف
async function pullAdvances(ctx, overwrite = true) {
  const { period_from: f, period_to: t } = ctx.header; if (!f || !t || f > t) return;
  let r; try { r = await GET(`/helpers/labor-advances?from=${f}&to=${t}`); } catch { return; }
  ctx.advMap = Object.fromEntries(r.rows.map((x) => [x.employee_id, x.amount]));
  if (overwrite) { ctx.lines.forEach((l) => { if (l.employee_id) l.advance = ctx.advMap[l.employee_id] || 0; }); ctx.setLines(ctx.lines); }
}
export const laborSheetsPage = docScreen({ perm: 'hr.labor',
  type: 'labor_sheet', title: 'يوميات العمالة', noun: 'كشف يومية', newLabel: 'كشف يومية جديد',
  note: 'سجّل العمالة اليومية: كل عامل بعدد أيامه وأجره، ومحمّل على مشروع/بند/مرحلة. العمالة المباشرة بتتحمّل على مرحلة التصنيع، وغير المباشرة والإدارية على حساباتها بدون مشروع.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'period_name', l: 'المدة' }, { k: 'period_from', l: 'من' }, { k: 'period_to', l: 'إلى' }, { k: 'date', l: 'التاريخ' }, { k: 'n_lines', l: 'عدد العاملين', num: true }, { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) },
    { k: 'paid_amount', l: 'المصروف', num: true, fmt: (v) => fmt(v) }, { k: 'rem', l: 'المتبقي', num: true, text: (r) => (r.status === 'void' ? '' : fmt(r.total - r.paid_amount)) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    onOpen: async (ctx) => {
      if (ctx.doc) return;
      try { const r = await GET('/helpers/labor-advances'); if (r.next_from) ctx.setHeader('period_from', r.next_from); } catch {}
    },
    onHeader: (k, v, ctx) => { if (k === 'period_from' || k === 'period_to') pullAdvances(ctx); },
    cols: 3, header: [dateF, { k: 'period_from', l: 'مدة الأجور: من تاريخ', t: 'date', req: 1 }, { k: 'period_to', l: 'إلى تاريخ', t: 'date', req: 1 }, { k: 'period_name', l: 'اسم المدة', t: 'text', readonly: true, ph: 'يتولّد تلقائياً عند الحفظ (YYYY/01)' }, { ...notesF, wide: false }],
    lines: { addLabel: '＋ جديد', blank: () => ({ days: 1 }), cols: [
      { ...empCol, filter: (x) => x.emp_type === 'daily', onChange: (v, l, ctx) => { const e = byId('employees', v); if (!e) return; l.rate = e.daily_rate; l.stage_id = e.cost_class === 'direct' ? e.default_stage_id : null; if (ctx.advMap) l.advance = ctx.advMap[v] || 0; else pullAdvances(ctx); ctx.setLines(ctx.lines); } },
      { k: 'days', l: 'أيام أساسي', t: 'number', w: '75px', step: '0.25', blankZero: true }, { k: 'ot_days', l: 'أيام سهرات', t: 'number', w: '75px', step: '0.25', blankZero: true }, { k: 'rate', l: 'أجر اليوم', t: 'number', w: '90px' },
      { l: 'قيمة الأساسي', calc: (l) => lbBasic(l), fmt: (v) => fmt(v), w: '90px' }, { l: 'قيمة السهرات', calc: (l) => lbOt(l), fmt: (v) => fmt(v), w: '90px' },
      { k: 'other_additions', l: 'إضافات أخرى', t: 'number', w: '90px', blankZero: true }, { k: 'other_deductions', l: 'خصومات أخرى', t: 'number', w: '90px', blankZero: true }, { k: 'advance', l: 'سلفة المدة', t: 'number', w: '90px', blankZero: true },
      { l: 'صافي المنصرف', calc: (l) => lbNet(l), fmt: (v) => fmt(v), w: '100px' },
      { k: 'project_id', l: 'المشروع', t: 'fk', ref: 'projects', combo: true, w: '15%', onChange: (v, l, ctx) => { const it = byId('project_items', l.item_id); if (it && it.project_id !== v) { l.item_id = null; ctx.setLines(ctx.lines); } } },
      { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', combo: true, w: '15%', filter: (x, l) => !l.project_id || x.project_id === l.project_id },
      { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages', w: '110px' },
      { l: 'التصنيف', calc: (l) => labelOf(CLASS_OPTS, classOf(l.employee_id)).split(' (')[0] }] },
    totals: (ctx) => [['إجمالي أيام الأساسي', fq(total(ctx.lines, (l) => l.days))], ['إجمالي أيام السهرات', fq(total(ctx.lines, (l) => l.ot_days))], ['صافي المنصرف', fmt(total(ctx.lines, (l) => lbNet(l))), 'ok']],
  },
});

// ---------------- سلف عمال يومية ----------------
export const laborAdvancesPage = docScreen({ perm: 'hr.labor-advances',
  type: 'labor_advance', title: 'سلف عمال يومية', noun: 'كشف سلف', newLabel: 'كشف سلف جديد',
  note: 'صرف مبلغ لكل عامل يومية في نصف المدة. المبالغ دي بتترحّل تلقائياً لعمود «سلفة المدة» في كشف اليومية اللي مدته بتشمل تاريخ الصرف.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, { k: 'n_lines', l: 'عدد العاملين', num: true },
    { k: 'total', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }, { k: 'src', l: 'من', text: (r) => r.treasury_name || r.custodian_name || '' }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  listFoot: (c, rows) => (c.k === 'total' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.total)) : c.k === 'no' ? 'الإجمالي' : ''),
  editor: {
    cols: 3, header: [dateF,
      { k: 'treasury_id', l: 'الدفع من خزينة/بنك', t: 'fk', ref: 'treasuries', help: 'خزينة أو عهدة — واحد فقط', onChange: (v, c) => { if (v) c.setHeader('custodian_id', null); } },
      { k: 'custodian_id', l: 'أو الدفع من عهدة', t: 'fk', ref: 'custodians', onChange: (v, c) => { if (v) c.setHeader('treasury_id', null); } }, { ...notesF, wide: true }],
    lines: { addLabel: '＋ جديد', blank: () => ({}), cols: [
      { ...empCol, w: '45%', filter: (x) => x.emp_type === 'daily' },
      { k: 'amount', l: 'مبلغ السلفة', t: 'number', w: '140px', req: 1 }, { k: 'notes', l: 'ملاحظات', t: 'text' }] },
    totals: (ctx) => [['عدد العاملين', fq(ctx.lines.filter((l) => l.employee_id).length)], ['إجمالي السلف', fmt(total(ctx.lines, (l) => Number(l.amount) || 0)), 'ok']],
  },
});

// ---------------- كشف الرواتب الشهرية ----------------
function allocLabel(l) {
  if (classOf(l.employee_id) !== 'direct') return h('span.tag', 'لا يحتاج');
  const a = l.allocations;
  if (!a?.length) return h('span', { style: { color: 'var(--ink2)' } }, `100% — ${nameOf('stages', byId('employees', l.employee_id)?.default_stage_id)}`);
  return h('span', a.map((x) => `${x.percent}% ${nameOf('stages', x.stage_id)}${x.project_id ? ' / ' + nameOf('projects', x.project_id) : ''}`).join('، '));
}
// حساب الكشف: أجر اليوم = المرتب ÷ 30، وقيمة الإضافات/الاستقطاعات = أجر اليوم × الأيام
const rd2 = (x) => Math.round(x * 100) / 100;
const pAdd = (l) => rd2(((Number(l.base) || 0) / 30) * (Number(l.additions_days) || 0));
const pDed = (l) => rd2(((Number(l.base) || 0) / 30) * (Number(l.deductions_days) || 0));
const pNet = (l) => rd2((Number(l.base) || 0) + pAdd(l) - pDed(l) + (Number(l.other_additions) || 0) - (Number(l.other_deductions) || 0));
export const payrollPage = docScreen({ perm: 'hr.payroll',
  type: 'payroll', title: 'الرواتب الشهرية', noun: 'كشف رواتب', newLabel: 'كشف شهري جديد',
  note: 'المرتب الشهري للعامل المباشر بيتوزّع على المشروعات والمراحل بنسب (زر «توزيع») — والغير مباشر والإداري بيروحوا لحساباتهم.',
  listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'month', l: 'الشهر' }, { k: 'date', l: 'التاريخ' }, { k: 'n_lines', l: 'العاملين', num: true }, { k: 'gross', l: 'الإجمالي', num: true, fmt: (v) => fmt(v) }, { k: 'deductions', l: 'الاستقطاعات', num: true, fmt: (v) => fmt(v) }, { k: 'net', l: 'الصافي', num: true, fmt: (v) => fmt(v) }, { k: 'paid_amount', l: 'المصروف', num: true, fmt: (v) => fmt(v) }, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
  editor: {
    cols: 3, defaults: () => ({ month: today().slice(0, 7), date: today() }), header: [{ k: 'month', l: 'الشهر', t: 'month', req: 1 }, dateF, { ...notesF, wide: false }],
    lines: { addLabel: '＋ جديد', blank: () => ({ additions_days: 0, deductions_days: 0, other_additions: 0, other_deductions: 0 }), cols: [
      { ...empCol, filter: (x) => x.emp_type === 'monthly', onChange: (v, l, ctx) => { const e = byId('employees', v); if (e) { l.base = e.monthly_salary; l.allocations = []; ctx.setLines(ctx.lines); } } },
      { k: 'base', l: 'المرتب الأساسي', t: 'number', w: '120px', readonly: true },
      { k: 'additions_days', blankZero: true, l: 'أيام الإضافات', t: 'number', w: '90px' }, { l: 'قيمة الإضافات', calc: (l) => pAdd(l), fmt: (v) => fmt(v), w: '100px' },
      { k: 'deductions_days', blankZero: true, l: 'أيام الاستقطاعات', t: 'number', w: '90px' }, { l: 'قيمة الاستقطاعات', calc: (l) => pDed(l), fmt: (v) => fmt(v), w: '100px' },
      { k: 'other_additions', blankZero: true, l: 'إضافات أخرى', t: 'number', w: '100px' }, { k: 'other_deductions', blankZero: true, l: 'خصومات أخرى', t: 'number', w: '100px' },
      { l: 'الصافي', calc: (l) => pNet(l), fmt: (v) => fmt(v), w: '110px' },
      { l: 'توزيع التكلفة', render: (l, ctx, ro) => {
        const box = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }); const lab = h('span', allocLabel(l)); box.append(lab);
        if (!ro && classOf(l.employee_id) === 'direct') box.append(h('button.btn.sm', { onclick: () => allocModal(l, () => { lab.replaceChildren(allocLabel(l)); }) }, 'توزيع'));
        return box; } }] },
    tools: [{ label: 'تحميل كل الشهريين', run: (ctx) => {
      const rows = L.employees.filter((e) => e.active && e.emp_type === 'monthly'); if (!rows.length) throw new Error('لا يوجد عاملين شهريين — أضفهم من الإعدادات ← العاملين');
      ctx.setLines(rows.map((e) => ({ employee_id: e.id, base: e.monthly_salary, additions_days: 0, deductions_days: 0, other_additions: 0, other_deductions: 0, allocations: [] })));
    } }],
    totals: (ctx) => [['الإجمالي', fmt(total(ctx.lines, (l) => (Number(l.base) || 0) + pAdd(l) + (Number(l.other_additions) || 0)))], ['الاستقطاعات', fmt(total(ctx.lines, (l) => pDed(l) + (Number(l.other_deductions) || 0)))], ['صافي المستحق', fmt(total(ctx.lines, (l) => pNet(l))), 'ok']],
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
