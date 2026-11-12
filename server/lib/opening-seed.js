import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx, r2 } from '../db.js';
import { getSetting, setSetting } from './core.js';
import { openingLocked } from './opening.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'opening-stock.json');

/**
 * تحميل كميات وقيم الأصناف الافتتاحية من seed/opening-stock.json إلى جدول opening_stock (مرة واحدة لكل version).
 * - مبيلمسش الأرصدة المقفولة، ومبيطبّقش القيود (التطبيق من شاشة الأرصدة الافتتاحية).
 * - الصفوف اللي اتعدّلت يدوياً من الشاشة بتتسيب زي ما هي.
 */
export async function loadOpeningStockSeed() {
  if (!fs.existsSync(file)) return;
  const { version, items } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!version || await getSetting('opening_seed_version') === version) return;
  if (await openingLocked()) { console.log(`أرصدة الأصناف الافتتاحية (${version}) لم تُحمّل: الأرصدة مقفلة`); return; }
  let done = 0, kept = 0, missing = 0;
  await tx(async () => {
    for (const it of items) {
      const m = await get('SELECT id FROM materials WHERE code=?', it.code);
      if (!m) { missing++; continue; }
      const cur = await get('SELECT source FROM opening_stock WHERE material_id=?', m.id);
      if (cur?.source === 'معدّل يدوياً') { kept++; continue; }
      await run(`INSERT INTO opening_stock(material_id,qty,value,source,note) VALUES(?,?,?,?,?)
        ON CONFLICT(material_id) DO UPDATE SET qty=excluded.qty, value=excluded.value, source=excluded.source, note=excluded.note`,
        m.id, it.qty, r2(it.value), it.source, it.note || null);
      done++;
    }
    await setSetting('opening_seed_version', version);
  });
  console.log(`أرصدة الأصناف الافتتاحية (${version}): اتحدّث ${done} صنف، اتسابت ${kept} معدّل يدوياً، ${missing} كود مش موجود`);
}
