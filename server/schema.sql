-- ============================================================
--  مخطط قاعدة البيانات — نظام ERP مصنع GRC (النسخة المبسطة)
--  PostgreSQL (Supabase).
--  التواريخ: نص YYYY-MM-DD   |   المبالغ: NUMERIC (بتتقرّب في الكود)
-- ============================================================

-- ---------- الإعدادات العامة ----------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sequences (           -- الترقيم التلقائي للمستندات والأكواد
  key TEXT PRIMARY KEY,                          -- مثال: invoice, material
  label TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  next_no INTEGER NOT NULL DEFAULT 1,
  padding INTEGER NOT NULL DEFAULT 4,
  with_year INTEGER NOT NULL DEFAULT 0
);

-- ---------- المستخدمون ----------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',             -- admin | user
  modules TEXT NOT NULL DEFAULT '[]',            -- JSON: الموديولات المسموحة
  must_change INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS')),
  user_id INTEGER, username TEXT,
  action TEXT, entity TEXT, entity_id INTEGER, details TEXT
);

-- ---------- التكويد (موديول الإعدادات) ----------
CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS material_categories (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS materials (           -- أصناف الخامات
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  category_id INTEGER REFERENCES material_categories(id),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  min_qty NUMERIC NOT NULL DEFAULT 0,               -- حد الطلب
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'raw',              -- raw | finished (لاحقاً)
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  phone TEXT, address TEXT, tax_no TEXT, credit_days INTEGER NOT NULL DEFAULT 0,
  opening_balance NUMERIC NOT NULL DEFAULT 0,       -- مستحق للمورد أول المدة
  notes TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  client TEXT, start_date TEXT, end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',         -- active | done | hold
  notes TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS project_items (       -- بنود المشروع
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  qty NUMERIC, unit_id INTEGER REFERENCES units(id),
  notes TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stages (              -- مراحل التصنيع
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER,                            -- حساب إنتاج تحت التشغيل للمرحلة
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sites (               -- المواقع (تحويلات الخامات)
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  address TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS treasuries (          -- الخزن والبنوك
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash',             -- cash | bank
  account_id INTEGER NOT NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS custodians (          -- أصحاب العهد
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  phone TEXT, opening_balance NUMERIC NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  cost_class TEXT NOT NULL DEFAULT 'indirect',   -- direct | indirect | admin
  account_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS employees (           -- العاملين (يومية / شهرية)
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  emp_type TEXT NOT NULL DEFAULT 'daily',        -- daily | monthly
  daily_rate NUMERIC NOT NULL DEFAULT 0,
  monthly_salary NUMERIC NOT NULL DEFAULT 0,
  cost_class TEXT NOT NULL DEFAULT 'direct',     -- direct (مرحلة) | indirect | admin
  default_stage_id INTEGER REFERENCES stages(id),
  job_title TEXT, phone TEXT, hire_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- ---------- الحسابات ----------
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  parent_id INTEGER REFERENCES accounts(id),
  type TEXT NOT NULL,                            -- asset | liability | equity | revenue | expense
  postable INTEGER NOT NULL DEFAULT 1,           -- 1 = حساب فرعي يقبل قيود
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'            -- open | closed
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL, date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'auto',             -- auto | manual | opening
  source_type TEXT, source_id INTEGER,
  description TEXT,
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_je_src ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_je_date ON journal_entries(date);
CREATE TABLE IF NOT EXISTS journal_lines (       -- كل سطر بيشيل أبعاد التحليل
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit NUMERIC NOT NULL DEFAULT 0, credit NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  supplier_id INTEGER, treasury_id INTEGER, custodian_id INTEGER,
  employee_id INTEGER, project_id INTEGER, item_id INTEGER, stage_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS ix_jl_acc ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS ix_jl_sup ON journal_lines(supplier_id);
CREATE INDEX IF NOT EXISTS ix_jl_tre ON journal_lines(treasury_id);
CREATE INDEX IF NOT EXISTS ix_jl_cus ON journal_lines(custodian_id);

-- ---------- المخزون ----------
CREATE TABLE IF NOT EXISTS opening_stock (       -- الأرصدة الافتتاحية القابلة للتعديل قبل القفل
  material_id INTEGER PRIMARY KEY REFERENCES materials(id),
  qty NUMERIC NOT NULL DEFAULT 0, value NUMERIC NOT NULL DEFAULT 0,
  source TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS stock_moves (         -- دفتر حركة المخزون (مصدر الحقيقة للتقييم)
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 1,                -- 0 افتتاحي | 1 وارد | 2 صادر (ترتيب نفس اليوم)
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  direction TEXT NOT NULL,                       -- in | out
  qty NUMERIC NOT NULL DEFAULT 0,
  cost_mode TEXT NOT NULL DEFAULT 'fixed',       -- fixed (القيمة معروفة) | avg (بالمتوسط المرجح)
  value NUMERIC NOT NULL DEFAULT 0,                 -- قيمة الحركة (موجبة دائماً)
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  bal_qty NUMERIC NOT NULL DEFAULT 0, bal_value NUMERIC NOT NULL DEFAULT 0, avg_cost NUMERIC NOT NULL DEFAULT 0,
  doc_type TEXT NOT NULL, doc_id INTEGER NOT NULL, line_id INTEGER,
  party TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_sm_mat ON stock_moves(warehouse_id, material_id, date, ord, id);
CREATE INDEX IF NOT EXISTS ix_sm_doc ON stock_moves(doc_type, doc_id);
CREATE TABLE IF NOT EXISTS material_stock (      -- الرصيد الحالي (مخزّن للسرعة)
  warehouse_id INTEGER NOT NULL, material_id INTEGER NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0, value NUMERIC NOT NULL DEFAULT 0, avg_cost NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id, material_id)
);

-- إذن صرف / مرتجع صرف
CREATE TABLE IF NOT EXISTS stock_issues (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'production',       -- production | site | overhead | return
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  project_id INTEGER, item_id INTEGER, stage_id INTEGER, site_id INTEGER,
  ref_issue_id INTEGER,                          -- للمرتجع: إذن الصرف الأصلي
  received_by TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted',         -- posted | void
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS stock_issue_lines (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES stock_issues(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, unit_cost NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  ref_line_id INTEGER, notes TEXT
);
-- جرد وتسوية
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  notes TEXT, status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
  id SERIAL PRIMARY KEY,
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  system_qty NUMERIC NOT NULL DEFAULT 0, counted_qty NUMERIC NOT NULL DEFAULT 0,
  diff_qty NUMERIC NOT NULL DEFAULT 0, unit_cost NUMERIC NOT NULL DEFAULT 0, value NUMERIC NOT NULL DEFAULT 0,
  notes TEXT
);

-- ---------- المشتريات ----------
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  requested_by TEXT, project_id INTEGER, needed_date TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',           -- open | ordered | closed | void
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS purchase_request_lines (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, ordered_qty NUMERIC NOT NULL DEFAULT 0, notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  request_id INTEGER, expected_date TEXT,
  payment_type TEXT NOT NULL DEFAULT 'credit',   -- credit | cash
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',           -- open | partial | received | closed | void
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, unit_price NUMERIC NOT NULL DEFAULT 0,
  received_qty NUMERIC NOT NULL DEFAULT 0, request_line_id INTEGER, notes TEXT
);
CREATE TABLE IF NOT EXISTS goods_receipts (      -- إذن استلام
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  order_id INTEGER, supplier_ref TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, unit_price NUMERIC NOT NULL DEFAULT 0,
  order_line_id INTEGER, invoiced_qty NUMERIC NOT NULL DEFAULT 0, notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  supplier_inv_no TEXT, due_date TEXT,
  payment_type TEXT NOT NULL DEFAULT 'credit',   -- credit (آجل) | cash (نقدي)
  treasury_id INTEGER, custodian_id INTEGER,     -- مصدر السداد في النقدي
  discount NUMERIC NOT NULL DEFAULT 0, freight NUMERIC NOT NULL DEFAULT 0,
  vat_percent NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0, vat_amount NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  notes TEXT, status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, unit_price NUMERIC NOT NULL DEFAULT 0,
  grn_line_id INTEGER,                           -- مطابقة مع استلام سابق
  net_cost NUMERIC NOT NULL DEFAULT 0,              -- التكلفة بعد توزيع الخصم والنقل
  notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_returns (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  invoice_id INTEGER, notes TEXT, total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty NUMERIC NOT NULL, unit_price NUMERIC NOT NULL DEFAULT 0, notes TEXT
);

-- ---------- الإدارة المالية ----------
CREATE TABLE IF NOT EXISTS vouchers (            -- سندات الخزينة والعهد
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- supplier_payment | expense | wage_payment | custody_issue | custody_return
  -- | transfer | receipt | payment_other
  treasury_id INTEGER,                           -- مصدر/وجهة النقدية
  custodian_id INTEGER,                          -- مصدر الدفع من العهدة، أو صاحب العهدة
  to_treasury_id INTEGER,                        -- للتحويل بين الخزن
  supplier_id INTEGER, category_id INTEGER, account_id INTEGER,
  project_id INTEGER, item_id INTEGER, stage_id INTEGER,
  amount NUMERIC NOT NULL, description TEXT, ref_no TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS voucher_allocations ( -- توزيع دفعة المورد على فواتيره
  id SERIAL PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id),
  amount NUMERIC NOT NULL
);
CREATE TABLE IF NOT EXISTS voucher_wage_links (  -- ربط سند الأجور بكشوف اليوميات / الرواتب
  id SERIAL PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  sheet_id INTEGER, run_id INTEGER,
  amount NUMERIC NOT NULL
);

-- ---------- الموارد البشرية ----------
CREATE TABLE IF NOT EXISTS labor_sheets (        -- كشف يومية العمالة
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, date TEXT NOT NULL, notes TEXT,
  total NUMERIC NOT NULL DEFAULT 0, paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS labor_sheet_lines (
  id SERIAL PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES labor_sheets(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  days NUMERIC NOT NULL DEFAULT 1, rate NUMERIC NOT NULL DEFAULT 0, amount NUMERIC NOT NULL DEFAULT 0,
  cost_class TEXT NOT NULL DEFAULT 'direct',
  project_id INTEGER, item_id INTEGER, stage_id INTEGER, notes TEXT
);
CREATE TABLE IF NOT EXISTS payroll_runs (        -- رواتب شهرية
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE, month TEXT NOT NULL,  -- YYYY-MM
  date TEXT NOT NULL, notes TEXT,
  gross NUMERIC NOT NULL DEFAULT 0, deductions NUMERIC NOT NULL DEFAULT 0, net NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS payroll_lines (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  base NUMERIC NOT NULL DEFAULT 0, additions NUMERIC NOT NULL DEFAULT 0, deductions NUMERIC NOT NULL DEFAULT 0,
  net NUMERIC NOT NULL DEFAULT 0, cost_class TEXT NOT NULL DEFAULT 'direct', notes TEXT
);
CREATE TABLE IF NOT EXISTS payroll_allocations ( -- توزيع تكلفة الراتب على المشروعات
  id SERIAL PRIMARY KEY,
  line_id INTEGER NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
  project_id INTEGER, item_id INTEGER, stage_id INTEGER,
  percent NUMERIC NOT NULL DEFAULT 100
);

-- ---------- التكلفة (جدول التحليل الموحّد) ----------
CREATE TABLE IF NOT EXISTS cost_lines (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  source_type TEXT NOT NULL, source_id INTEGER NOT NULL, source_line_id INTEGER,
  cost_type TEXT NOT NULL,                       -- material | labor | expense
  cost_class TEXT NOT NULL DEFAULT 'direct',     -- direct | indirect | admin
  project_id INTEGER, item_id INTEGER, stage_id INTEGER, site_id INTEGER,
  material_id INTEGER, employee_id INTEGER, category_id INTEGER,
  qty NUMERIC NOT NULL DEFAULT 0, amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT
);
CREATE INDEX IF NOT EXISTS ix_cl_src ON cost_lines(source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_cl_dim ON cost_lines(project_id, stage_id, item_id);
CREATE INDEX IF NOT EXISTS ix_cl_date ON cost_lines(date);

-- ربط حقل «مقدم الطلب» و«المستلم» بجدول العاملين (بدل النص الحر) — آمن للتكرار على قاعدة موجودة
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS requested_by_id INTEGER REFERENCES employees(id);
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS received_by_id INTEGER REFERENCES employees(id);

-- العملاء + ربط المشروع بالعميل + ربط صاحب العهدة بالموظف
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  phone TEXT, address TEXT, tax_no TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
ALTER TABLE custodians ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id);

-- نماذج القيود (قيود النظام الجاهزة + نماذج يضيفها المستخدم مربوطة بالدليل والموديول)
CREATE TABLE IF NOT EXISTS journal_templates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT,
  system INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS journal_template_lines (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES journal_templates(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  side TEXT NOT NULL,                 -- debit | credit
  role_key TEXT,                      -- حساب يحدده البرنامج (إعدادات الربط أو حسب المستند)
  account_id INTEGER REFERENCES accounts(id),
  label TEXT
);
CREATE INDEX IF NOT EXISTS ix_jtl_t ON journal_template_lines(template_id);
-- وحدة فرعية + معدل تحويل (1 رئيسية = sub_factor فرعية): شيكارة = 50 كجم
ALTER TABLE units ADD COLUMN IF NOT EXISTS sub_unit_id INTEGER REFERENCES units(id);
ALTER TABLE units ADD COLUMN IF NOT EXISTS sub_factor NUMERIC;

-- ربط فئات الخامات بالمخازن (المخزن بدون فئات مربوطة = كل الخامات)
CREATE TABLE IF NOT EXISTS warehouse_categories (
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES material_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (warehouse_id, category_id)
);

-- المورد في طلب الشراء (اختياري)
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);
