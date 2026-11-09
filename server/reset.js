// مسح البيانات: في Postgres بنمسح كل الجداول (DROP SCHEMA) — محلي: بنمسح مجلد data/pgdata
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODE, run, closeDb } from './db.js';
const here = path.dirname(fileURLToPath(import.meta.url));
if (MODE === 'postgres') {
  if (process.argv[2] !== '--yes') { console.log('ده هيمسح كل جداول قاعدة البيانات على Supabase! أعد الأمر بـ: npm run reset-db -- --yes'); await closeDb(); process.exit(1); }
  await run('DROP SCHEMA public CASCADE'); await run('CREATE SCHEMA public');
  console.log('تم مسح كل الجداول. شغّل npm start لإعادة التهيئة.');
} else {
  await closeDb(); fs.rmSync(path.join(here, '..', 'data', 'pgdata'), { recursive: true, force: true }); console.log('تم مسح قاعدة البيانات المحلية.');
}
await closeDb();
