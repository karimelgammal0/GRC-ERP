import { h, GET, POST, L, META, fmt, fq, today, monthStart, yearStart, table, filterBar, pageHead, card, kpi, badge, nameOf, byId, codeName, labelOf, statusBadge, toast, guard, fieldInput } from '../core.js';
import { docScreen, dateF, notesF, total } from '../docs-ui.js';

const ACC_F = (x) => x.postable === 1 && x.active !== 0;
const srcFields = (ctx, need = true) => [
  { k: 'treasury_id', l: 'الدفع من خزينة/بنك', t: 'fk', ref: 'treasuries', help: 'خزينة أو عهدة — واحد فقط', onChange: (v, c) => { if (v) c.setHeader('custodian_id', null); } },
  { k: 'custodian_id', l: 'أو الدفع من عهدة', t: 'fk', ref: 'custodians', onChange: (v, c) => { if (v) c.setHeader('treasury_id', null); } }];

function voucherScreen({ title, noun, kinds, newLabel, note }) {
  const multi = kinds.length > 1; const kindOpts = () => kinds.map((k) => [k, META.voucher_kinds[k]]);
  const amountCol = { k: 'amount', l: 'المبلغ', num: true, fmt: (v) => fmt(v) };
  return docScreen({
    type: 'voucher', title, noun, newLabel, note, fixed: multi ? {} : { kind: kinds[0] },
    get filters() { return [...(multi ? [{ k: 'kind', l: 'النوع', t: 'select', options: [['', 'الكل'], ...kindOpts()] }] : []), { k: 'treasury_id', l: 'الخزينة', t: 'fk', ref: 'treasuries' }]; },
    listCols: [{ k: 'no', l: 'الرقم', render: (r) => h('b', r.no) }, { k: 'date', l: 'التاريخ' }, ...(multi ? [{ k: 'kind', l: 'النوع', text: (r) => META.voucher_kinds[r.kind] }] : []),
      { k: 'party', l: 'الطرف / البيان', text: (r) => [r.supplier_name, r.category_name, r.custodian_name, r.account_name, r.to_treasury_name && `← ${r.to_treasury_name}`, r.description].filter(Boolean).join(' — ') },
      { k: 'src', l: 'من/إلى', text: (r) => [r.treasury_name, r.custodian_name && `عهدة ${r.custodian_name}`].filter(Boolean).join(' / ') }, amountCol, { k: 'status', l: 'الحالة', render: (r) => statusBadge(r.status) }],
    listFoot: (c, rows) => (c.k === 'amount' ? fmt(total(rows.filter((r) => r.status !== 'void'), (r) => r.amount)) : c.k === 'no' ? 'الإجمالي' : ''),
    editor: {
      cols: 3, rebuildOn: ['kind'], defaults: () => ({ kind: kinds[0], amount: null, treasury_id: (L.treasuries[0] || {}).id }),
      header: (ctx) => {
        const k = ctx.header.kind; const f = [dateF];
        if (multi) f.push({ k: 'kind', l: 'نوع السند', t: 'select', options: kindOpts(), lockOnEdit: true, req: 1 });
        if (k === 'supplier_payment') f.push({ k: 'supplier_id', l: 'المورد', t: 'fk', ref: 'suppliers', combo: true, req: 1, lockOnEdit: true, onChange: () => loadInvoices(ctx) }, ...srcFields(ctx));
        if (k === 'expense') f.push({ k: 'category_id', l: 'فئة المصروف', t: 'fk', ref: 'expense_categories', req: 1 }, ...srcFields(ctx),
          { k: 'project_id', l: 'المشروع (إجباري للمصروف المباشر)', t: 'fk', ref: 'projects', combo: true, onChange: (v, c) => { const it = byId('project_items', c.header.item_id); if (it && it.project_id !== v) c.setHeader('item_id', null); } },
          { k: 'item_id', l: 'البند', t: 'fk', ref: 'project_items', combo: true, filter: (x) => !ctx.header.project_id || x.project_id === ctx.header.project_id }, { k: 'stage_id', l: 'المرحلة', t: 'fk', ref: 'stages' });
        if (k === 'wage_payment') f.push(...srcFields(ctx));
        if (k === 'custody_issue' || k === 'custody_return') f.push({ k: 'custodian_id', l: 'صاحب العهدة', t: 'fk', ref: 'custodians', req: 1 }, { k: 'treasury_id', l: k === 'custody_issue' ? 'تُصرف من' : 'تُردّ إلى', t: 'fk', ref: 'treasuries', req: 1 });
        if (k === 'transfer') f.push({ k: 'treasury_id', l: 'من خزينة', t: 'fk', ref: 'treasuries', req: 1 }, { k: 'to_treasury_id', l: 'إلى خزينة', t: 'fk', ref: 'treasuries', req: 1 });
        if (k === 'receipt') f.push({ k: 'treasury_id', l: 'تُودع في', t: 'fk', ref: 'treasuries', req: 1 }, { k: 'account_id', l: 'الحساب الدائن (مصدر القبض)', t: 'fk', ref: 'accounts', filter: ACC_F, combo: true, req: 1 }, { k: 'project_id', l: 'المشروع (اختياري)', t: 'fk', ref: 'projects', combo: true });
        if (k === 'payment_other') f.push({ k: 'account_id', l: 'الحساب المدين (بند الصرف)', t: 'fk', ref: 'accounts', filter: ACC_F, combo: true, req: 1 }, ...srcFields(ctx), { k: 'project_id', l: 'المشروع (اختياري)', t: 'fk', ref: 'projects', combo: true });
        f.push({ k: 'amount', l: 'المبلغ', t: 'number', req: 1 }, { k: 'ref_no', l: 'رقم مرجعي', t: 'text' }, { k: 'description', l: 'البيان', t: 'text', wide: true });
        return f;
      },
      extraTitle: null,
      extra: (ctx) => extraPanel(ctx),
      totals: (ctx) => [['المبلغ', fmt(ctx.header.amount || 0)], ...(ctx.header.kind === 'supplier_payment' ? [['موزّع على فواتير', fmt(total(Object.values(ctx.alloc || {}), (x) => x))], ['دفعة مقدمة / غير موزعة', fmt((ctx.header.amount || 0) - total(Object.values(ctx.alloc || {}), (x) => x))]] : []),
        ...(ctx.header.kind === 'wage_payment' ? [['موزّع على كشوف', fmt(total(Object.values(ctx.wl || {}), (x) => x))]] : [])],
      onOpen: async (ctx) => {
        ctx.alloc = {}; ctx.wl = {};
        if (ctx.doc) { for (const a of ctx.doc.allocations || []) ctx.alloc[a.invoice_id] = a.amount; for (const w of ctx.doc.wage_links || []) ctx.wl[w.sheet_id ? 's' + w.sheet_id : 'r' + w.run_id] = w.amount; }
        await loadInvoices(ctx); await loadWages(ctx);
      },
      prepare: (p, ctx) => {
        p.allocations = Object.entries(ctx.alloc || {}).filter(([, a]) => a > 0).map(([invoice_id, amount]) => ({ invoice_id: Number(invoice_id), amount }));
        p.wage_links = Object.entries(ctx.wl || {}).filter(([, a]) => a > 0).map(([k, amount]) => (k[0] === 's' ? { sheet_id: Number(k.slice(1)), amount } : { run_id: Number(k.slice(1)), amount }));
      },
    },
  });
}
async function loadInvoices(ctx) {
  const s = ctx.header.supplier_id; if (ctx.header.kind !== 'supplier_payment') return;
  let rows = s ? await GET('/helpers/open-invoices', { supplier_id: s }) : [];
  rows = rows.map((r) => ({ ...r, open: r.open + (ctx.doc && ctx.doc.supplier_id === s ? (ctx.doc.allocations.find((a) => a.invoice_id === r.id)?.amount || 0) : 0) }));
  if (ctx.doc && ctx.doc.supplier_id === s) for (const a of ctx.doc.allocations) if (!rows.find((r) => r.id === a.invoice_id)) { const d = await GET(`/doc/purchase_invoice/${a.invoice_id}`); rows.push({ id: d.id, no: d.no, date: d.date, due_date: d.due_date, total: d.total, open: a.amount }); }
  ctx.invoices = rows; ctx.redrawExtra();
}
async function loadWages(ctx) {
  if (ctx.header.kind !== 'wage_payment') return;
  const r = await GET('/helpers/unpaid-wages');
  const own = ctx.doc?.wage_links || [];
  const bump = (list, key, idk) => list.map((x) => ({ ...x, remaining: x.remaining + (own.find((w) => w[idk] === x.id)?.amount || 0) }));
  ctx.wages = { sheets: bump(r.sheets, 's', 'sheet_id'), runs: bump(r.runs, 'r', 'run_id') }; ctx.redrawExtra();
}
function extraPanel(ctx) {
  const k = ctx.header.kind; const rec = () => ctx.refresh();
  const mkTable = (rows, store, cols) => {
    const body = rows.length ? rows.map((r) => h('tr', ...cols.map((c) => h('td', c[1](r))),
      h('td', fieldInput({ t: 'number', onChange: (v) => { store[r.__k] = Number(v) || 0; rec(); } }, store[r.__k] ?? '')))) : [h('tr', h('td.empty', { colspan: cols.length + 1 }, 'لا توجد مستحقات'))];
    return h('div', h('div.tbl-wrap', h('table.tbl.compact', h('thead', h('tr', [...cols.map((c) => h('th', c[0])), h('th', 'المبلغ المسدد')])), h('tbody', body))),
      h('div.actions', h('button.btn.sm', { onclick: () => { let left = Number(ctx.header.amount) || 0; for (const r of rows) { const a = Math.min(left, r.open ?? r.remaining); store[r.__k] = a > 0 ? Math.round(a * 100) / 100 : 0; left -= a; } ctx.redrawExtra(); rec(); } }, 'توزيع تلقائي (الأقدم أولاً)'),
        h('button.btn.sm', { onclick: () => { for (const key of Object.keys(store)) delete store[key]; ctx.redrawExtra(); rec(); } }, 'مسح التوزيع')));
  };
  if (k === 'supplier_payment') {
    const rows = (ctx.invoices || []).map((r) => ({ ...r, __k: r.id }));
    return h('div', h('h4', { style: { margin: '0 0 8px' } }, 'توزيع الدفعة على فواتير المورد (اختياري — الباقي يُسجّل دفعة مقدمة)'), mkTable(rows, ctx.alloc, [['الفاتورة', (r) => r.no], ['التاريخ', (r) => r.date], ['الاستحقاق', (r) => r.due_date], ['الإجمالي', (r) => fmt(r.total)], ['المتبقي', (r) => fmt(r.open)]]));
  }
  if (k === 'wage_payment') {
    const rows = [...(ctx.wages?.sheets || []).map((x) => ({ ...x, __k: 's' + x.id, label: `يومية ${x.no}`, when: x.date, tot: x.total })), ...(ctx.wages?.runs || []).map((x) => ({ ...x, __k: 'r' + x.id, label: `مرتبات ${x.no}`, when: x.month, tot: x.total }))];
    return h('div', h('h4', { style: { margin: '0 0 8px' } }, 'الكشوف المستحقة الصرف'), mkTable(rows.map((r) => ({ ...r, open: r.remaining })), ctx.wl, [['الكشف', (r) => r.label], ['التاريخ/الشهر', (r) => r.when], ['الإجمالي', (r) => fmt(r.tot)], ['المتبقي', (r) => fmt(r.remaining)]]));
  }
  return null;
}

export const supplierPaymentsPage = voucherScreen({ title: 'سداد الموردين', noun: 'سند سداد', kinds: ['supplier_payment'], newLabel: 'سداد مورد', note: 'اختر المورد ووزّع المبلغ على فواتيره المفتوحة؛ الفواتير بتتقفل تلقائياً عند السداد الكامل.' });
export const expensesVoucherPage = voucherScreen({ title: 'سندات المصروفات', noun: 'سند مصروف', kinds: ['expense'], newLabel: 'مصروف جديد', note: 'المصروف المباشر (مرتبط بمرحلة تصنيع) بيدخل تكلفة المشروع/المرحلة، والغير مباشر والإداري بيروح لحساب فئته. ممكن يتدفع من خزينة أو من عهدة.' });
export const wagePaymentsPage = voucherScreen({ title: 'صرف الأجور والمرتبات', noun: 'سند صرف أجور', kinds: ['wage_payment'], newLabel: 'صرف أجور', note: 'اصرف مستحقات كشوف اليوميات والمرتبات الشهرية من خزينة أو عهدة.' });
export const custodyVouchersPage = voucherScreen({ title: 'العهد', noun: 'سند عهدة', kinds: ['custody_issue', 'custody_return'], newLabel: 'سند عهدة', note: 'صرف عهدة لموظف، أو رد باقي العهدة للخزينة. مصروفات العهدة بتتسجل من «سندات المصروفات» أو فواتير الشراء النقدية بالدفع من العهدة.' });
export const transfersPage = voucherScreen({ title: 'تحويلات بين الخزن', noun: 'سند تحويل', kinds: ['transfer'], newLabel: 'تحويل جديد' });
export const otherVouchersPage = voucherScreen({ title: 'سندات قبض وصرف أخرى', noun: 'سند', kinds: ['receipt', 'payment_other'], newLabel: 'سند جديد', note: 'للإيرادات والمصروفات اللي ليها حساب محدد من دليل الحسابات.' });

// ---------------- أرصدة الخزن والعهد + كشوف الحساب ----------------
export async function treasuriesPage(root) {
  const [tr, cu] = await Promise.all([GET('/reports/treasury-balances'), GET('/reports/custody-balances')]);
  root.replaceChildren(pageHead('الخزن والبنوك والعهد'),
    h('div.kpis', kpi('إجمالي النقدية والبنوك', fmt(tr.reduce((s, x) => s + x.balance, 0)), `${tr.length} خزينة/حساب`), kpi('إجمالي العهد بذمة أصحابها', fmt(cu.reduce((s, x) => s + x.balance, 0)), `${cu.length} عهدة`, 'warn')),
    h('div.grid2', card('الخزن والبنوك', table({ search: false, name: 'الخزن', rows: tr, onRow: (r) => { location.hash = `#/finance/treasury-statement?treasury_id=${r.id}`; }, cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'الخزينة', render: (r) => h('b', r.name) }, { k: 'type', l: 'النوع', text: (r) => (r.type === 'bank' ? 'بنك' : 'نقدية') }, { k: 'balance', l: 'الرصيد', num: true, fmt: (v) => fmt(v) }] })),
      card('العهد', table({ search: false, name: 'العهد', rows: cu, onRow: (r) => { location.hash = `#/finance/custody-statement?custodian_id=${r.id}`; }, cols: [{ k: 'code', l: 'الكود' }, { k: 'name', l: 'صاحب العهدة', render: (r) => h('b', r.name) }, { k: 'balance', l: 'الرصيد بذمته', num: true, fmt: (v) => fmt(v) }] }))));
}
function statementPage(title, dimKey, dimRef, endpoint, backHref) {
  return async (root, params) => {
    const host = h('div');
    const run = async (v) => {
      if (!v[dimKey]) { host.replaceChildren(h('div.empty-state', 'اختر من القائمة')); return; }
      const r = await GET(endpoint, v);
      host.replaceChildren(h('div.kpis', kpi('رصيد أول المدة', fmt(r.opening)), kpi('الرصيد الحالي', fmt(r.closing), '', r.closing < 0 ? 'bad' : '')),
        table({ name: title, compact: true, rows: [{ date: v.from || '', description: 'رصيد أول المدة', balance: r.opening, _o: 1 }, ...r.rows], rowClass: (x) => (x._o ? 'low' : ''),
          cols: [{ k: 'date', l: 'التاريخ' }, { k: 'no', l: 'القيد' }, { k: 'description', l: 'البيان' }, { k: 'debit', l: 'وارد / مدين', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'credit', l: 'منصرف / دائن', num: true, fmt: (n) => (n ? fmt(n) : '') }, { k: 'balance', l: 'الرصيد', num: true, fmt: (n) => fmt(n) }] }));
    };
    const fb = filterBar([{ k: dimKey, l: dimRef.label, t: 'fk', ref: dimRef.ref, req: 1 }, { k: 'from', l: 'من تاريخ', t: 'date' }, { k: 'to', l: 'إلى تاريخ', t: 'date' }], run, { [dimKey]: params[dimKey] ? Number(params[dimKey]) : null, from: monthStart() });
    root.replaceChildren(pageHead(title, h('a.btn', { href: backHref }, 'الأرصدة')), fb, host); fb.run();
  };
}
export const treasuryStatementPage = statementPage('كشف حساب خزينة', 'treasury_id', { ref: 'treasuries', label: 'الخزينة/البنك' }, '/reports/treasury-statement', '#/finance/treasuries');
export const custodyStatementPage = statementPage('كشف حساب عهدة', 'custodian_id', { ref: 'custodians', label: 'صاحب العهدة' }, '/reports/custody-statement', '#/finance/treasuries');
