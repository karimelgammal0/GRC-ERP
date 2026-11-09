// ============================================================
//  طبقة قاعدة البيانات — PostgreSQL
//   • DATABASE_URL موجود  → Supabase / أي Postgres (عن طريق pg)
//   • غير موجود           → Postgres مضمّن محلياً (PGlite) في data/pgdata
//   • PGLITE_MEMORY=1     → في الذاكرة (للاختبارات)
//  كل الدوال async. tx() بتستخدم AsyncLocalStorage فأي استعلام جواها بيتنفّذ في نفس الـ transaction.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// قراءة .env (DATABASE_URL) لو موجود — من غير مكتبات
try {
  if (process.env.PGLITE_MEMORY) throw 0; // الاختبارات ما تقراش .env أبداً
  for (const line of fs.readFileSync(path.join(here, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
pg.types.setTypeParser(20, (v) => Number(v));      // bigint (COUNT/SUM)
pg.types.setTypeParser(1700, (v) => Number(v));    // numeric

const URL = process.env.DATABASE_URL;
export const MODE = URL ? 'postgres' : 'pglite';
let pool = null, lite = null;
if (URL) {
  pool = new pg.Pool({ connectionString: URL, max: 5, ssl: /localhost|127\.0\.0\.1/.test(URL) ? false : { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error('pg pool error', e.message));
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_MEMORY ? undefined : (process.env.PGLITE_DIR || path.join(here, '..', 'data', 'pgdata'));
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  lite = new PGlite(dir);
  await lite.waitReady;
  for (const t of [20, 1700]) { /* PGlite بيرجع numeric كنص أحياناً — نحوّل في normalize */ }
}

const als = new AsyncLocalStorage();

// ؟ → $n  + تحويلات بسيطة من SQLite
function conv(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`).replace(/\bMAX\(0,/g, 'GREATEST(0,').replace(/ LIKE /g, ' ILIKE ');
}
const fixRow = (r) => { if (lite) for (const k in r) if (typeof r[k] === 'bigint') r[k] = Number(r[k]); return r; };

async function exec(sql, params = []) {
  const text = conv(sql); const p = params.map((x) => (x === undefined ? null : x));
  const st = als.getStore();
  if (st?.client) { const r = await st.client.query(text, p); return { rows: r.rows, rowCount: r.rowCount }; }
  if (lite) { const r = await lite.query(text, p, { parsers: { 1700: (v) => Number(v), 20: (v) => Number(v) } }); return { rows: r.rows.map(fixRow), rowCount: r.affectedRows ?? r.rows.length }; }
  const r = await pool.query(text, p); return { rows: r.rows, rowCount: r.rowCount };
}

export const all = async (sql, ...p) => (await exec(sql, p)).rows;
export const get = async (sql, ...p) => (await exec(sql, p)).rows[0];
export const run = async (sql, ...p) => { const r = await exec(sql, p); return { changes: r.rowCount }; };
export const val = async (sql, ...p) => { const r = (await exec(sql, p)).rows[0]; return r ? Object.values(r)[0] : undefined; };

let spN = 0;
/** كل عملية جوه transaction واحدة؛ لو حصل خطأ كله بيرجع. بتدعم التداخل (savepoint). */
export async function tx(fn) {
  const st = als.getStore();
  if (st) {
    const sp = `sp_${++spN}`;
    await st.client.query(`SAVEPOINT ${sp}`);
    try { const r = await fn(); await st.client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e) { await st.client.query(`ROLLBACK TO SAVEPOINT ${sp}`); throw e; }
  }
  if (lite) {
    const client = { query: (t, p) => lite.query(t, p, { parsers: { 1700: (v) => Number(v), 20: (v) => Number(v) } }).then((r) => ({ rows: r.rows.map(fixRow), rowCount: r.affectedRows ?? r.rows.length })) };
    await client.query('BEGIN');
    try { const r = await als.run({ client }, fn); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await als.run({ client }, fn);
    await client.query('COMMIT'); return r;
  } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; }
  finally { client.release(); }
}

/** إنشاء الجداول (آمن للتكرار) */
export async function initSchema() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  if (lite) await lite.exec(sql); else await pool.query(sql);
}
export async function closeDb() { if (pool) await pool.end(); if (lite) await lite.close(); }

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const r2 = (n) => { const x = Number(n); return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0; };
export const r4 = (n) => { const x = Number(n); return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 10000) / 10000 : 0; };
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const NO_ID = new Set(['settings', 'sequences', 'sessions', 'material_stock', 'opening_stock']);
/** insert من object مع whitelist للأعمدة — بترجع id */
export async function insertRow(table, obj, cols) {
  const keys = cols.filter((c) => obj[c] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})${NO_ID.has(table) ? '' : ' RETURNING id'}`;
  const r = await exec(sql, keys.map((k) => (obj[k] === '' ? null : obj[k])));
  return r.rows[0]?.id !== undefined ? Number(r.rows[0].id) : undefined;
}
export async function updateRow(table, id, obj, cols) {
  const keys = cols.filter((c) => obj[c] !== undefined);
  if (!keys.length) return;
  await run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`,
    ...keys.map((k) => (obj[k] === '' ? null : obj[k])), id);
}
