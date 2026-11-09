import 'express-async-errors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, AppError, initSchema, MODE } from './db.js';
import { isEmpty, seedAll, ensureBaseData } from './lib/seed.js';
import { authRoutes, systemRouter } from './routes/system.js';
import { masterRouter } from './routes/masters.js';
import { docRouter, helperRouter, canUse } from './routes/docs.js';
import { reportRouter } from './routes/reports.js';
import { accountsRouter } from './routes/accounts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
await initSchema();
await ensureBaseData();
if (await isEmpty()) { await seedAll(); console.log('تمت تهيئة قاعدة البيانات بالبيانات الأساسية. المستخدم: admin / admin123'); }

export const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(here, '..', 'public')));

// تنفيذ طلبات التعديل واحد تلو الآخر (إعادة التقييم بالمتوسط المرجح لازم تكون متسلسلة)
// فحص الصحة: بيلمس قاعدة البيانات (بيستخدمه Railway للـ Healthcheck)
app.get('/api/health', async (req, res) => { await get('SELECT 1 AS ok'); res.json({ ok: true, t: new Date().toISOString() }); });
let chain = Promise.resolve();
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const prev = chain; let done; chain = new Promise((r) => { done = r; });
  prev.then(() => { res.on('close', done); next(); });
});

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const wrap = (router) => {  // الأخطاء المتزامنة بتتحول لرد JSON
  return router;
};
app.use('/api', await authRoutes());
app.use('/api', async (req, res, next) => {
  const token = cookies(req).sid;
  const u = token && await get(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1`, token);
  if (!u) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  req.user = u; req.token = token; next();
});
const need = (mod) => (req, res, next) => (canUse(req.user, mod) ? next() : res.status(403).json({ error: 'ليس لديك صلاحية على هذا الموديول' }));
app.use('/api', await systemRouter());
app.use('/api/m', await masterRouter());           // قراءة التكويد متاحة للكل؛ التعديل لصاحب الإعدادات
app.use('/api/doc', await docRouter());
app.use('/api/helpers', helperRouter());
app.use('/api/reports', need('reports'), reportRouter());
app.use('/api/acc', await accountsRouter());

app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));
app.use((err, req, res, next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  const m = String(err.message || err);
  if (err.code === '23505' || /UNIQUE constraint/.test(m)) return res.status(400).json({ error: 'القيمة مستخدمة من قبل (كود/رقم مكرر)' });
  if (err.code === '23503' || /FOREIGN KEY/.test(m)) return res.status(400).json({ error: 'السجل مرتبط ببيانات أخرى' });
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي: ' + m });
});

const PORT = process.env.PORT || 3000;
if (process.env.NO_LISTEN !== '1') app.listen(PORT, () => console.log(`نظام المصنع يعمل على http://localhost:${PORT} — قاعدة البيانات: ${MODE === 'postgres' ? 'Postgres (Supabase)' : 'Postgres محلي مضمّن'}`));

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
