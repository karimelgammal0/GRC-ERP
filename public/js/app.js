import { h, GET, POST, META, can, loadLookups, loadMeta, toast, modal, formGrid } from './core.js';
import { masterPage, generalPage, sequencesPage, openingPage, usersPage, auditPage } from './pages/settings.js';
import * as inv from './pages/inventory.js';
import * as pur from './pages/purchases.js';
import * as hr from './pages/hr.js';
import * as fin from './pages/finance.js';
import * as acc from './pages/accounts.js';
import * as rep from './pages/reports.js';
import { dashboardPage } from './pages/dashboard.js';

const root = document.getElementById('root');
const M = (n, o) => masterPage(n, o);
const NAV = [
  { id: 'dashboard', ico: '▦', title: 'لوحة التحكم', direct: true, items: [['home', 'نظرة عامة', dashboardPage]] },
  { id: 'inventory', ico: '▣', title: 'مخازن المواد الخام', items: [
    ['issues', 'صرف للإنتاج والتشغيل', inv.issuesPage], ['site-transfers', 'التحويل للمواقع', inv.siteTransfersPage], ['returns', 'مرتجع للمخزن', inv.returnsPage], ['adjustments', 'جرد وتسويات', inv.adjustmentsPage],
    ['balances', 'أرصدة المخزون', inv.balancesPage], ['stock-card', 'كارت الصنف', inv.stockCardPage], ['moves', 'حركة المخزون', inv.movesPage], ['fg', 'مخازن المنتجات التامة — قريباً', null]] },
  { id: 'purchases', ico: '⛟', title: 'المشتريات', items: [
    ['requests', 'طلبات الشراء', pur.requestsPage], ['orders', 'أوامر الشراء', pur.ordersPage], ['receipts', 'إذونات الاستلام', pur.receiptsPage], ['invoices', 'فواتير الشراء', pur.invoicesPage],
    ['returns', 'مرتجعات الشراء', pur.preturnsPage], ['supplier-statement', 'كشف حساب مورد', pur.supplierStatementPage], ['supplier-balances', 'أرصدة الموردين', pur.supplierBalancesPage]] },
  { id: 'hr', ico: '☺', title: 'الموارد البشرية', items: [['labor', 'يوميات العمالة', hr.laborSheetsPage], ['labor-advances', 'سلف عمال يومية', hr.laborAdvancesPage], ['payroll', 'الرواتب الشهرية', hr.payrollPage]] },
  { id: 'finance', ico: '$', title: 'الإدارة المالية', items: [
    ['treasuries', 'الخزن والعهد (الأرصدة)', fin.treasuriesPage], ['supplier-payments', 'سداد الموردين', fin.supplierPaymentsPage], ['expenses', 'سندات المصروفات', fin.expensesVoucherPage], ['wages', 'صرف الأجور', fin.wagePaymentsPage],
    ['custody', 'سندات العهد', fin.custodyVouchersPage], ['transfers', 'تحويلات بين الخزن', fin.transfersPage], ['other', 'سندات قبض/صرف أخرى', fin.otherVouchersPage],
    ['treasury-statement', 'كشف خزينة', fin.treasuryStatementPage], ['custody-statement', 'كشف عهدة', fin.custodyStatementPage]] },
  { id: 'accounts', ico: '≡', title: 'الحسابات', items: [['chart', 'دليل الحسابات', acc.chartPage], ['periods', 'الفترات المالية', acc.periodsPage], ['journals', 'قيود اليومية', acc.journalsPage], ['templates', 'نماذج القيود', acc.templatesPage], ['account-links', 'ربط الحسابات', acc.accountLinksPage], ['sequences', 'ترقيم المستندات', sequencesPage]] },
  { id: 'reports', ico: '◔', title: 'التقارير', items: [
    ['hub', 'كل التقارير', rep.hub], ['project-stage', 'تكلفة المشاريع × المراحل', rep.projectStagePage], ['stage-project', 'تكلفة المراحل × المشاريع', rep.stageProjectPage], ['project-analysis', 'تحليل مشروع (بنود)', rep.projectAnalysisPage],
    ['material-usage', 'استهلاك الخامات', rep.materialUsagePage], ['cost-detail', 'تفاصيل التكاليف', rep.costDetailPage], ['expenses', 'المصروفات', rep.expensesReport], ['labor', 'العمالة', rep.laborReport],
    ['trial-balance', 'ميزان المراجعة', rep.trialBalancePage], ['ledger', 'أستاذ الحساب', rep.ledgerPage], ['income', 'قائمة الدخل', rep.incomePage]] },
  { id: 'settings', ico: '⚙', title: 'الإعدادات', items: [
    ['general', 'عام (بيانات الشركة)', generalPage], ['opening', 'الأرصدة الافتتاحية', openingPage],
    ['materials', 'الخامات', M('materials')], ['categories', 'فئات الخامات', M('material_categories')], ['units', 'وحدات القياس', M('units')], ['warehouses', 'المخازن', M('warehouses')],
    ['clients', 'العملاء', M('clients')], ['projects', 'المشروعات', M('projects')], ['project-items', 'بنود المشروعات', M('project_items')], ['stages', 'مراحل التصنيع', M('stages')], ['sites', 'المواقع', M('sites')],
    ['suppliers', 'الموردين', M('suppliers')], ['treasuries', 'الخزن والبنوك', M('treasuries')], ['custodians', 'العهد', M('custodians')],
    ['expense-cats', 'المصروفات', M('expense_categories')], ['employees', 'العاملين', M('employees')]] },
  { id: 'permissions', ico: '⚿', title: 'الصلاحيات', admin: true, items: [['users', 'المستخدمون والصلاحيات', usersPage], ['audit', 'سجل العمليات', auditPage]] }
];
// صلاحية الصفحة: الموديول 'dashboard' للكل، 'permissions' للمدير بس، والباقي بمفتاح module.page
const pageOk = (g, k) => g.id === 'dashboard' || (g.admin ? META.me.role === 'admin' : can(`${g.id}.${k}`));
const groupOk = (g) => g.items.some(([k, , fn]) => fn && pageOk(g, k)) || (g.id === 'dashboard');
const open = new Set(['dashboard']);

function loginView(msg) {
  const u = h('input', { placeholder: 'اسم المستخدم', autofocus: true }), p = h('input', { type: 'password', placeholder: 'كلمة المرور' }), err = h('div', { style: { color: 'var(--bad)', minHeight: '20px', marginBottom: '8px' } }, msg || '');
  const go = async () => { try { await POST('/login', { username: u.value, password: p.value }); await boot(); } catch (e) { err.textContent = e.message; } };
  p.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  root.replaceChildren(h('div.login', h('div.box', h('h1', 'نظام تكاليف مصنع GRC'), h('p', 'سجّل الدخول للمتابعة'), h('div.fld', u), h('div.fld', p), err, h('button.btn.primary', { onclick: go }, 'دخول'))));
}
function changePassword(force) {
  const f = formGrid([{ k: 'old_password', l: 'كلمة المرور الحالية', t: 'text' }, { k: 'new_password', l: 'كلمة المرور الجديدة (6 أحرف+)', t: 'text' }], {}, 1);
  f.el.querySelectorAll('input').forEach((i) => (i.type = 'password'));
  modal({ title: force ? 'لازم تغيّر كلمة المرور أول مرة' : 'تغيير كلمة المرور', body: f.el, noClose: force, buttons: [{ label: 'حفظ', cls: 'primary', onClick: async () => { await POST('/change-password', f.values()); META.me.must_change = 0; toast('تم تغيير كلمة المرور'); } }] });
}
function shell() {
  const nav = h('nav');
  const view = h('main.main');
  const draw = () => {
    const cur = parse(); // الصفحة الحالية بتتحسب عند كل رسم عشان التظليل يتبع الصفحة المفتوحة
    nav.replaceChildren(...NAV.filter(groupOk).map((g) => h('div.nav-group' + (open.has(g.id) ? '.open' : ''),
      h('div.nav-title', { onclick: () => { if (g.direct) { location.hash = `#/${g.id}/${g.items[0][0]}`; return; } open.has(g.id) ? open.delete(g.id) : open.add(g.id); draw(); } }, h('span.ico', g.ico), g.title, g.direct ? null : h('span.chev', '◀')),
      g.direct ? null : h('div.nav-items', g.items.filter(([k]) => pageOk(g, k)).map(([k, t, fn]) => h('a' + (fn ? '' : '.soon') + (cur.mod === g.id && cur.page === k ? '.active' : ''), { href: fn ? `#/${g.id}/${k}` : '#' }, t))))));
  };
  root.replaceChildren(h('div#app', h('aside.side', h('div', { style: { padding: '18px 16px 8px', fontWeight: 800, fontSize: '17px', color: '#fff' } }, 'مصنع GRC'), nav,
    h('div.side-foot', h('div', META.me.name || META.me.username), h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px' } }, h('button', { onclick: () => changePassword(false) }, 'كلمة المرور'), h('button', { onclick: async () => { await POST('/logout'); location.hash = ''; loginView(); } }, 'خروج')))), view));
  const mbar = h('header.mbar'), tabbar = h('nav.tabbar');
  root.prepend(mbar); root.append(tabbar);
  const TABS = [['dashboard', '▦', 'الرئيسية', '#/dashboard/home'], ['inventory', '▣', 'المخازن', '#/menu/inventory'], ['purchases', '⛟', 'المشتريات', '#/menu/purchases'], ['finance', '$', 'المالية', '#/menu/finance'], ['more', '☰', 'المزيد', '#/menu/more']];
  const drawMobile = () => {
    const cur = parse(); const g = NAV.find((x) => x.id === (cur.mod === 'menu' ? cur.page : cur.mod));
    const tabId = TABS.some((t) => t[0] === g?.id) ? g.id : 'more';
    const onMenuRoot = cur.mod === 'dashboard' || (cur.mod === 'menu' && TABS.some((t) => t[0] === cur.page));
    const pageTitle = cur.mod === 'menu' ? (cur.page === 'more' ? 'المزيد' : g?.title) : (g?.items.find((i) => i[0] === cur.page)?.[1] || g?.title);
    mbar.replaceChildren(
      onMenuRoot ? h('span.mb-logo', 'GRC') : h('button.mb-back', { onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/menu/' + (g?.id || 'more'))) }, '›'),
      h('div.mb-title', pageTitle || 'مصنع GRC'));
    tabbar.replaceChildren(...TABS.filter(([id]) => id === 'more' || id === 'dashboard' || NAV.some((x) => x.id === id && groupOk(x))).map(([id, ico, t, href]) => h('a' + (id === tabId ? '.on' : ''), { href }, h('span.t-ico', ico), t)));
  };
  const origDraw = draw;
  const drawAll = () => { origDraw(); drawMobile(); };
  drawAll();
  return { view, draw: drawAll };
}
function menuScreen(view, id) {
  const btn = (href, ico, label, cls = '') => h('a.mbtn' + cls, { href }, h('span.mbtn-ico', ico), h('span', label));
  if (id === 'more') {
    const more = NAV.filter((g) => !['dashboard', 'inventory', 'purchases', 'finance'].includes(g.id) && groupOk(g));
    view.replaceChildren(h('div.menu-user', META.me.name || META.me.username), h('div.mgrid', more.map((g) => btn(`#/menu/${g.id}`, g.ico, g.title))),
      h('div.mgrid.small', h('button.mbtn', { onclick: () => changePassword(false) }, h('span.mbtn-ico', '⚿'), h('span', 'كلمة المرور')), h('button.mbtn.danger', { onclick: async () => { await POST('/logout'); location.hash = ''; loginView(); } }, h('span.mbtn-ico', '⏻'), h('span', 'خروج'))));
    return;
  }
  const g = NAV.find((x) => x.id === id);
  if (!g) { view.replaceChildren(h('div.empty-state', 'القسم غير متاح')); return; }
  view.replaceChildren(h('div.mgrid', g.items.filter(([k]) => pageOk(g, k)).map(([k, t, fn]) => fn ? btn(`#/${g.id}/${k}`, g.ico, t) : h('div.mbtn.soon', h('span.mbtn-ico', g.ico), h('span', t)))));
}
function parse() {
  const [path, qs] = (location.hash.slice(1) || '/dashboard/home').split('?'); const [, mod, page] = path.split('/');
  return { mod: mod || 'dashboard', page: page || NAV.find((g) => g.id === (mod || 'dashboard'))?.items[0][0], params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
let S = null;
async function route() {
  if (!S) return; const { mod, page, params } = parse();
  if (mod === 'menu') { S.draw(); menuScreen(S.view, page); window.scrollTo(0, 0); return; }
  const g = NAV.find((x) => x.id === mod); const it = g?.items.find((i) => i[0] === page);
  open.add(mod); S.draw();
  if (!g || !it?.[2] || !pageOk(g, page)) { S.view.replaceChildren(h('div.empty-state', 'الصفحة غير متاحة')); return; }
  S.view.replaceChildren(h('div.empty-state', 'جاري التحميل…'));
  try { await loadLookups(); } catch { /* نكمل بالقوائم الحالية */ } // تحديث أسماء المشروعات والبنود وغيرها عند كل فتح شاشة
  try { await it[2](S.view, params); } catch (e) { S.view.replaceChildren(h('div.note.bad', 'خطأ: ' + e.message)); }
  window.scrollTo(0, 0);
}
async function boot() {
  try { META.me = await GET('/me'); } catch { return loginView(); }
  await loadMeta(); META.me = await GET('/me'); await loadLookups();
  S = shell(); route();
  if (META.me.must_change) changePassword(true);
}
window.addEventListener('hashchange', route);
window.addEventListener('need-login', () => { S = null; loginView('انتهت الجلسة، سجّل الدخول من جديد'); });
boot();
