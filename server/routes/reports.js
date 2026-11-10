import { Router } from 'express';
import { can } from '../lib/perms.js';
import { all, get, val, AppError, r2 } from '../db.js';
import { acc, getSetting } from '../lib/core.js';

const CLASS_LBL = { direct: 'مباشرة', indirect: 'غير مباشرة', admin: 'إدارية' };
const TYPE_LBL = { material: 'خامات', labor: 'عمالة', expense: 'مصروفات' };

// ---------- فلاتر التكلفة المشتركة ----------
function costWhere(q) {
  const w = ['1=1']; const p = [];
  if (q.from) { w.push('c.date>=?'); p.push(q.from); }
  if (q.to) { w.push('c.date<=?'); p.push(q.to); }
  for (const k of ['project_id', 'stage_id', 'item_id', 'site_id', 'material_id', 'employee_id', 'category_id']) if (q[k]) { w.push(`c.${k}=?`); p.push(q[k]); }
  if (q.cost_type) { w.push('c.cost_type=?'); p.push(q.cost_type); }
  if (q.cost_class) { w.push('c.cost_class=?'); p.push(q.cost_class); }
  return { sql: w.join(' AND '), p };
}
const DIM = {
  project: { expr: 'COALESCE(c.project_id,0)', names: async () => await dict('projects') },
  stage: { expr: 'COALESCE(c.stage_id,0)', names: async () => await dict('stages') },
  item: { expr: 'COALESCE(c.item_id,0)', names: async () => Object.fromEntries((await all(`SELECT i.id, i.name || ' — ' || p.name n FROM project_items i JOIN projects p ON p.id=i.project_id`)).map((r) => [r.id, r.n])) },
  site: { expr: 'COALESCE(c.site_id,0)', names: async () => await dict('sites') },
  material: { expr: 'COALESCE(c.material_id,0)', names: async () => await dict('materials') },
  employee: { expr: 'COALESCE(c.employee_id,0)', names: async () => await dict('employees') },
  category: { expr: 'COALESCE(c.category_id,0)', names: async () => await dict('expense_categories') },
  type: { expr: 'c.cost_type', names: () => TYPE_LBL },
  class: { expr: 'c.cost_class', names: () => CLASS_LBL },
  month: { expr: 'substr(c.date,1,7)', names: () => ({}) },
  none: { expr: `'all'`, names: () => ({ all: 'الإجمالي' }) },
};
const dict = async (t) => Object.fromEntries((await all(`SELECT id,name FROM ${t}`)).map((r) => [r.id, r.name]));
const nameOf = (names, k) => (k === 0 || k === '0' ? 'غير محدد' : names[k] ?? String(k));

// كل تقرير ليه صفحة (أو أكتر) بتستخدمه — المستخدم لازم يكون له صلاحية على واحدة منهم
const REPORT_PAGES = {
  'cost-pivot': ['reports.project-stage', 'reports.stage-project', 'reports.project-analysis'], 'cost-lines': ['reports.cost-detail', 'reports.material-usage', 'reports.project-stage', 'reports.stage-project', 'reports.project-analysis'],
  'stock-card': ['inventory.stock-card'], 'stock-balances': ['inventory.balances'], 'stock-moves': ['inventory.moves'],
  'supplier-statement': ['purchases.supplier-statement'], 'supplier-balances': ['purchases.supplier-balances'],
  'treasury-statement': ['finance.treasury-statement'], 'treasury-balances': ['finance.treasuries'], 'custody-statement': ['finance.custody-statement'], 'custody-balances': ['finance.treasuries'],
  expenses: ['reports.expenses'], labor: ['reports.labor'], 'trial-balance': ['reports.trial-balance'], ledger: ['reports.ledger'], 'income-summary': ['reports.income'],
};
export function reportRouter() {
  const r = Router();
  r.use((req, res, next) => {
    const name = req.path.split('/')[1]; if (name === 'dashboard') return next();
    const keys = REPORT_PAGES[name]; if (keys && can(req.user, keys)) return next();
    res.status(403).json({ error: 'ليس لديك صلاحية على هذا التقرير' });
  });

  // مصفوفة التكلفة: صف × عمود (مثلاً مشروع × مرحلة، أو مرحلة × مشروع)
  r.get('/cost-pivot', async (req, res) => {
    const rowD = DIM[req.query.row || 'project'], colD = DIM[req.query.col || 'stage'];
    if (!rowD || !colD) throw new AppError('أبعاد غير صحيحة');
    const { sql, p } = costWhere(req.query);
    const cells = await all(`SELECT ${rowD.expr} rk, ${colD.expr} ck, ROUND(SUM(c.amount),2) amt,
        ROUND(SUM(CASE WHEN c.cost_type='material' THEN c.amount ELSE 0 END),2) mat,
        ROUND(SUM(CASE WHEN c.cost_type='labor' THEN c.amount ELSE 0 END),2) lab,
        ROUND(SUM(CASE WHEN c.cost_type='expense' THEN c.amount ELSE 0 END),2) exp
      FROM cost_lines c WHERE ${sql} GROUP BY rk, ck`, ...p);
    const rn = await rowD.names(), cn = await colD.names();
    const rows = new Map(), cols = new Map();
    for (const c of cells) {
      if (!rows.has(c.rk)) rows.set(c.rk, { key: c.rk, name: nameOf(rn, c.rk), values: {}, total: 0, material: 0, labor: 0, expense: 0 });
      const row = rows.get(c.rk); row.values[c.ck] = c.amt; row.total = r2(row.total + c.amt);
      row.material = r2(row.material + c.mat); row.labor = r2(row.labor + c.lab); row.expense = r2(row.expense + c.exp);
      cols.set(c.ck, nameOf(cn, c.ck));
    }
    let colList = [...cols].map(([key, name]) => ({ key, name }));
    if (req.query.col === 'stage') { const ord = Object.fromEntries((await all('SELECT id, seq FROM stages')).map((s) => [s.id, s.seq])); colList.sort((a, b) => (ord[a.key] ?? 99) - (ord[b.key] ?? 99)); }
    else colList.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    const rowList = [...rows.values()].sort((a, b) => b.total - a.total);
    const totals = { values: {}, total: 0, material: 0, labor: 0, expense: 0 };
    for (const row of rowList) {
      for (const [k, v] of Object.entries(row.values)) totals.values[k] = r2((totals.values[k] || 0) + v);
      for (const f of ['total', 'material', 'labor', 'expense']) totals[f] = r2(totals[f] + row[f]);
    }
    res.json({ rows: rowList, cols: colList, totals });
  });

  r.get('/cost-lines', async (req, res) => {
    const { sql, p } = costWhere(req.query);
    res.json(await all(`SELECT c.*, pr.name project_name, it.name item_name, st.name stage_name, si.name site_name, m.name material_name, e.name employee_name, ec.name category_name
      FROM cost_lines c LEFT JOIN projects pr ON pr.id=c.project_id LEFT JOIN project_items it ON it.id=c.item_id LEFT JOIN stages st ON st.id=c.stage_id
      LEFT JOIN sites si ON si.id=c.site_id LEFT JOIN materials m ON m.id=c.material_id LEFT JOIN employees e ON e.id=c.employee_id LEFT JOIN expense_categories ec ON ec.id=c.category_id
      WHERE ${sql} ORDER BY c.date DESC, c.id DESC LIMIT 3000`, ...p));
  });

  // ---------- المخزون ----------
  r.get('/stock-card', async (req, res) => {
    const { material_id, warehouse_id, from, to } = req.query;
    if (!material_id) throw new AppError('اختر الخامة');
    const wh = warehouse_id || await val(`SELECT id FROM warehouses WHERE type='raw' ORDER BY id LIMIT 1`);
    const mat = await get('SELECT m.*, u.name unit_name FROM materials m JOIN units u ON u.id=m.unit_id WHERE m.id=?', material_id);
    let opening = { qty: 0, value: 0, avg: 0 };
    if (from) {
      const o = await get(`SELECT bal_qty, bal_value, avg_cost FROM stock_moves WHERE warehouse_id=? AND material_id=? AND date<? ORDER BY date DESC, ord DESC, id DESC LIMIT 1`, wh, material_id, from);
      if (o) opening = { qty: o.bal_qty, value: o.bal_value, avg: o.avg_cost };
    }
    const w = ['warehouse_id=?', 'material_id=?']; const p = [wh, material_id];
    if (from) { w.push('date>=?'); p.push(from); } if (to) { w.push('date<=?'); p.push(to); }
    const moves = await all(`SELECT * FROM stock_moves WHERE ${w.join(' AND ')} ORDER BY date, ord, id`, ...p);
    res.json({ material: mat, opening, moves, closing: moves.length ? { qty: moves.at(-1).bal_qty, value: moves.at(-1).bal_value, avg: moves.at(-1).avg_cost } : opening });
  });

  r.get('/stock-balances', async (req, res) => {
    const wh = req.query.warehouse_id || await val(`SELECT id FROM warehouses WHERE type='raw' ORDER BY id LIMIT 1`);
    const asOf = req.query.as_of;
    const cat = req.query.category_id ? ' AND m.category_id=' + Number(req.query.category_id) : '';
    const rows = asOf
      ? await all(`SELECT m.id, m.code, m.name, m.min_qty, u.name unit, c.name category, COALESCE(x.bal_qty,0) qty, COALESCE(x.bal_value,0) value, COALESCE(x.avg_cost,0) avg_cost
          FROM materials m JOIN units u ON u.id=m.unit_id LEFT JOIN material_categories c ON c.id=m.category_id
          LEFT JOIN (SELECT material_id, bal_qty, bal_value, avg_cost, ROW_NUMBER() OVER (PARTITION BY material_id ORDER BY date DESC, ord DESC, id DESC) rn
                     FROM stock_moves WHERE warehouse_id=? AND date<=?) x ON x.material_id=m.id AND x.rn=1
          WHERE 1=1 ${cat} ORDER BY m.code`, wh, asOf)
      : await all(`SELECT m.id, m.code, m.name, m.min_qty, u.name unit, c.name category, COALESCE(s.qty,0) qty, COALESCE(s.value,0) value, COALESCE(s.avg_cost,0) avg_cost
          FROM materials m JOIN units u ON u.id=m.unit_id LEFT JOIN material_categories c ON c.id=m.category_id
          LEFT JOIN material_stock s ON s.material_id=m.id AND s.warehouse_id=? WHERE 1=1 ${cat} ORDER BY m.code`, wh);
    const list = req.query.hide_zero === '1' ? rows.filter((x) => Math.abs(x.qty) > 1e-9 || Math.abs(x.value) > 0.004) : rows;
    res.json({ rows: list.map((x) => ({ ...x, low: x.min_qty > 0 && x.qty <= x.min_qty })), total_value: r2(list.reduce((s, x) => s + x.value, 0)) });
  });

  r.get('/stock-moves', async (req, res) => {
    const w = ['1=1']; const p = [];
    if (req.query.material_id) { w.push('sm.material_id=?'); p.push(req.query.material_id); }
    if (req.query.warehouse_id) { w.push('sm.warehouse_id=?'); p.push(req.query.warehouse_id); }
    if (req.query.from) { w.push('sm.date>=?'); p.push(req.query.from); } if (req.query.to) { w.push('sm.date<=?'); p.push(req.query.to); }
    if (req.query.direction) { w.push('sm.direction=?'); p.push(req.query.direction); }
    res.json(await all(`SELECT sm.*, m.name material_name, m.code material_code, wh.name warehouse_name FROM stock_moves sm JOIN materials m ON m.id=sm.material_id JOIN warehouses wh ON wh.id=sm.warehouse_id
      WHERE ${w.join(' AND ')} ORDER BY sm.date DESC, sm.ord DESC, sm.id DESC LIMIT 3000`, ...p));
  });

  // ---------- الموردين ----------
  const apAcc = async () => await acc('acc_ap');
  r.get('/supplier-statement', async (req, res) => {
    const { supplier_id, from, to } = req.query; if (!supplier_id) throw new AppError('اختر المورد');
    const base = `FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=? AND jl.supplier_id=?`;
    const op = from ? (await get(`SELECT COALESCE(SUM(jl.credit-jl.debit),0) b ${base} AND je.date<?`, await apAcc(), supplier_id, from)).b : 0;
    const w = []; const p = [await apAcc(), supplier_id]; if (from) { w.push('je.date>=?'); p.push(from); } if (to) { w.push('je.date<=?'); p.push(to); }
    const rows = await all(`SELECT je.date, je.no, je.description, jl.debit, jl.credit, je.source_type, je.source_id ${base} ${w.length ? 'AND ' + w.join(' AND ') : ''} ORDER BY je.date, je.id, jl.id`, ...p);
    let bal = r2(op); for (const x of rows) { bal = r2(bal + x.credit - x.debit); x.balance = bal; }
    res.json({ opening: r2(op), rows, closing: bal });
  });
  r.get('/supplier-balances', async (req, res) => {
    const asOf = req.query.as_of || '9999-12-31';
    const rows = await all(`SELECT s.id, s.code, s.name, s.phone, COALESCE(SUM(jl.credit-jl.debit),0) balance
      FROM suppliers s LEFT JOIN journal_lines jl ON jl.supplier_id=s.id AND jl.account_id=? LEFT JOIN journal_entries je ON je.id=jl.entry_id AND je.date<=?
      GROUP BY s.id ORDER BY balance DESC`, await apAcc(), asOf);
    const inv = await all(`SELECT i.supplier_id, i.total - COALESCE((SELECT SUM(amount) FROM voucher_allocations WHERE invoice_id=i.id),0) open, i.due_date
      FROM purchase_invoices i WHERE i.payment_type='credit' AND i.status='posted'`);
    const today = new Date().toISOString().slice(0, 10);
    const ag = {};
    for (const i of inv) {
      if (i.open < 0.005) continue;
      const days = Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86400000);
      const b = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'd90';
      ag[i.supplier_id] ||= { current: 0, d30: 0, d60: 0, d90: 0 }; ag[i.supplier_id][b] = r2(ag[i.supplier_id][b] + i.open);
    }
    const out = rows.map((x) => ({ ...x, balance: r2(x.balance), aging: ag[x.id] || { current: 0, d30: 0, d60: 0, d90: 0 } })).filter((x) => Math.abs(x.balance) > 0.004 || req.query.all === '1');
    res.json({ rows: out, total: r2(out.reduce((s, x) => s + x.balance, 0)) });
  });

  // ---------- الخزن والعهد ----------
  async function subStatement(dimCol, dimId, accountId, from, to, sign) {
    const base = `FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.${dimCol}=? AND jl.account_id=?`;
    const op = from ? (await get(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) b ${base} AND je.date<?`, dimId, accountId, from)).b : 0;
    const w = []; const p = [dimId, accountId]; if (from) { w.push('je.date>=?'); p.push(from); } if (to) { w.push('je.date<=?'); p.push(to); }
    const rows = await all(`SELECT je.date, je.no, je.description, jl.debit, jl.credit, je.source_type, je.source_id ${base} ${w.length ? 'AND ' + w.join(' AND ') : ''} ORDER BY je.date, je.id, jl.id`, ...p);
    let bal = r2(op); for (const x of rows) { bal = r2(bal + x.debit - x.credit); x.balance = bal; }
    return { opening: r2(op), rows, closing: bal };
  }
  r.get('/treasury-statement', async (req, res) => {
    const t = await get('SELECT * FROM treasuries WHERE id=?', req.query.treasury_id); if (!t) throw new AppError('اختر الخزينة');
    res.json(await subStatement('treasury_id', t.id, t.account_id, req.query.from, req.query.to));
  });
  r.get('/treasury-balances', async (req, res) => res.json(await all(`SELECT t.id, t.code, t.name, t.type,
      COALESCE((SELECT SUM(jl.debit-jl.credit) FROM journal_lines jl WHERE jl.treasury_id=t.id AND jl.account_id=t.account_id),0) balance FROM treasuries t WHERE t.active=1 ORDER BY t.code`)));
  r.get('/custody-statement', async (req, res) => {
    const c = await get('SELECT * FROM custodians WHERE id=?', req.query.custodian_id); if (!c) throw new AppError('اختر صاحب العهدة');
    res.json(await subStatement('custodian_id', c.id, await acc('acc_custody'), req.query.from, req.query.to));
  });
  r.get('/custody-balances', async (req, res) => res.json(await all(`SELECT c.id, c.code, c.name,
      COALESCE((SELECT SUM(jl.debit-jl.credit) FROM journal_lines jl WHERE jl.custodian_id=c.id AND jl.account_id=?),0) balance FROM custodians c WHERE c.active=1 ORDER BY c.code`, await acc('acc_custody'))));

  // ---------- المصروفات والعمالة ----------
  r.get('/expenses', async (req, res) => {
    const g = { category: 'ec.name', class: 'c.cost_class', project: 'pr.name', month: `substr(c.date,1,7)` }[req.query.group || 'category'];
    const { sql, p } = costWhere({ ...req.query, cost_type: 'expense' });
    res.json(await all(`SELECT COALESCE(${g}, 'غير محدد') name, c.cost_class, ROUND(SUM(c.amount),2) amount, COUNT(*) n
      FROM cost_lines c LEFT JOIN expense_categories ec ON ec.id=c.category_id LEFT JOIN projects pr ON pr.id=c.project_id
      WHERE ${sql} GROUP BY 1, c.cost_class ORDER BY amount DESC`, ...p));
  });
  r.get('/labor', async (req, res) => {
    const g = { employee: 'e.name', stage: 'st.name', project: 'pr.name', class: 'c.cost_class', month: `substr(c.date,1,7)` }[req.query.group || 'employee'];
    const { sql, p } = costWhere({ ...req.query, cost_type: 'labor' });
    res.json(await all(`SELECT COALESCE(${g},'غير محدد') name, ROUND(SUM(c.qty),2) units, ROUND(SUM(c.amount),2) amount
      FROM cost_lines c LEFT JOIN employees e ON e.id=c.employee_id LEFT JOIN stages st ON st.id=c.stage_id LEFT JOIN projects pr ON pr.id=c.project_id
      WHERE ${sql} GROUP BY 1 ORDER BY amount DESC`, ...p));
  });

  // ---------- الحسابات ----------
  r.get('/trial-balance', async (req, res) => {
    const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31';
    const rows = await all(`SELECT a.id, a.code, a.name, a.type, a.parent_id, a.postable,
        COALESCE(SUM(CASE WHEN je.date<? THEN jl.debit-jl.credit END),0) opening,
        COALESCE(SUM(CASE WHEN je.date>=? AND je.date<=? THEN jl.debit END),0) debit,
        COALESCE(SUM(CASE WHEN je.date>=? AND je.date<=? THEN jl.credit END),0) credit
      FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id LEFT JOIN journal_entries je ON je.id=jl.entry_id
      GROUP BY a.id ORDER BY a.code`, from, from, to, from, to);
    const byId = new Map(rows.map((x) => [x.id, { ...x, opening: r2(x.opening), debit: r2(x.debit), credit: r2(x.credit) }]));
    for (const x of [...byId.values()].filter((y) => y.postable)) { // تجميع للأب
      let pid = x.parent_id;
      while (pid) { const pr = byId.get(pid); pr.opening = r2(pr.opening + x.opening); pr.debit = r2(pr.debit + x.debit); pr.credit = r2(pr.credit + x.credit); pid = pr.parent_id; }
    }
    const out = [...byId.values()].map((x) => ({ ...x, closing: r2(x.opening + x.debit - x.credit) }))
      .filter((x) => Math.abs(x.opening) > 0.004 || x.debit || x.credit);
    const leaf = out.filter((x) => x.postable);
    res.json({ rows: out, totals: { opening: r2(leaf.reduce((s, x) => s + x.opening, 0)), debit: r2(leaf.reduce((s, x) => s + x.debit, 0)), credit: r2(leaf.reduce((s, x) => s + x.credit, 0)), closing: r2(leaf.reduce((s, x) => s + x.closing, 0)) } });
  });
  r.get('/ledger', async (req, res) => {
    const a = await get('SELECT * FROM accounts WHERE id=?', req.query.account_id); if (!a) throw new AppError('اختر الحساب');
    const ids = [a.id]; // الحساب الرئيسي يشمل فروعه
    const walk = async (pid) => { for (const c of await all('SELECT id FROM accounts WHERE parent_id=?', pid)) { ids.push(c.id); await walk(c.id); } }; await walk(a.id);
    const ph = ids.map(() => '?').join(',');
    const dimW = ['project_id', 'stage_id', 'supplier_id', 'treasury_id', 'custodian_id'].filter((k) => req.query[k]).map((k) => `jl.${k}=${Number(req.query[k])}`);
    const extra = dimW.length ? ' AND ' + dimW.join(' AND ') : '';
    const op = req.query.from ? (await get(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) b FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id IN (${ph}) AND je.date<?${extra}`, ...ids, req.query.from)).b : 0;
    const w = []; const p = [...ids]; if (req.query.from) { w.push('je.date>=?'); p.push(req.query.from); } if (req.query.to) { w.push('je.date<=?'); p.push(req.query.to); }
    const rows = await all(`SELECT je.id entry_id, je.date, je.no, je.description, jl.description line_desc, jl.debit, jl.credit, a2.name account_name, je.source_type, je.source_id
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a2 ON a2.id=jl.account_id
      WHERE jl.account_id IN (${ph})${extra} ${w.length ? 'AND ' + w.join(' AND ') : ''} ORDER BY je.date, je.id, jl.id`, ...p);
    let bal = r2(op); for (const x of rows) { bal = r2(bal + x.debit - x.credit); x.balance = bal; }
    res.json({ account: a, opening: r2(op), rows, closing: bal });
  });
  r.get('/income-summary', async (req, res) => {
    const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31';
    const rows = await all(`SELECT a.id, a.code, a.name, a.type, ROUND(SUM(jl.debit-jl.credit),2) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE a.type IN ('revenue','expense') AND je.date BETWEEN ? AND ? GROUP BY a.id ORDER BY a.code`, from, to);
    const rev = rows.filter((x) => x.type === 'revenue').map((x) => ({ ...x, amount: -x.net }));
    const exp = rows.filter((x) => x.type === 'expense').map((x) => ({ ...x, amount: x.net }));
    const tr = r2(rev.reduce((s, x) => s + x.amount, 0)), te = r2(exp.reduce((s, x) => s + x.amount, 0));
    res.json({ revenue: rev, expenses: exp, total_revenue: tr, total_expenses: te, net: r2(tr - te) });
  });

  // ---------- لوحة التحكم ----------
  r.get('/dashboard', async (req, res) => {
    const month = new Date().toISOString().slice(0, 7);
    const stock = (await get('SELECT COALESCE(SUM(value),0) v, COUNT(CASE WHEN qty>0 THEN 1 END) n FROM material_stock')).v;
    const lowN = await val(`SELECT COUNT(*) FROM materials m LEFT JOIN material_stock s ON s.material_id=m.id WHERE m.active=1 AND m.min_qty>0 AND COALESCE(s.qty,0)<=m.min_qty`);
    const apTotal = await val(`SELECT COALESCE(SUM(credit-debit),0) FROM journal_lines WHERE account_id=? AND supplier_id IS NOT NULL`, await acc('acc_ap'));
    const treas = await all(`SELECT t.name, COALESCE((SELECT SUM(jl.debit-jl.credit) FROM journal_lines jl WHERE jl.treasury_id=t.id AND jl.account_id=t.account_id),0) balance FROM treasuries t WHERE t.active=1`);
    const custody = await val(`SELECT COALESCE(SUM(debit-credit),0) FROM journal_lines WHERE account_id=?`, await acc('acc_custody'));
    const monthCost = await all(`SELECT cost_type, ROUND(SUM(amount),2) amt FROM cost_lines WHERE substr(date,1,7)=? GROUP BY cost_type`, month);
    const byStage = await all(`SELECT COALESCE(st.name,'غير محدد') name, ROUND(SUM(c.amount),2) amt FROM cost_lines c LEFT JOIN stages st ON st.id=c.stage_id GROUP BY 1 ORDER BY amt DESC`);
    const topProjects = await all(`SELECT COALESCE(p.name,'غير محدد') name, ROUND(SUM(c.amount),2) amt FROM cost_lines c LEFT JOIN projects p ON p.id=c.project_id WHERE c.project_id IS NOT NULL GROUP BY 1 ORDER BY amt DESC LIMIT 6`);
    const unpaid = await val(`SELECT COALESCE(SUM(total-COALESCE((SELECT SUM(amount) FROM voucher_allocations WHERE invoice_id=i.id),0)),0) FROM purchase_invoices i WHERE payment_type='credit' AND status='posted' AND due_date<?`, new Date().toISOString().slice(0, 10));
    res.json({ stock_value: r2(stock), low_stock: lowN, ap_total: r2(apTotal), overdue_ap: r2(unpaid), treasuries: treas.map((t) => ({ ...t, balance: r2(t.balance) })), custody: r2(custody), month, month_cost: monthCost, by_stage: byStage, top_projects: topProjects });
  });
  return r;
}
