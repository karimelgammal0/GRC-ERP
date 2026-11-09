// ============================================================
//  تحويل الوحدات: 1 وحدة رئيسية = sub_factor وحدة فرعية (شيكارة = 50 كجم)
//  دوال صافية (من غير DOM) علشان تتختبر.
// ============================================================

/** كل وحدات الإدخال المسموحة لخامة وحدتها الأساسية baseId، ومعها معامل التحويل لوحدة الخامة */
export function entryUnits(units, baseId) {
  const base = units.find((u) => u.id === Number(baseId));
  if (!base) return [];
  const out = [{ id: base.id, name: base.name, toBase: 1 }];
  const f = Number(base.sub_factor);
  if (base.sub_unit_id && f > 0) {            // الخامة بالشيكارة → أدخل بالكيلو: كمية الشيكارة = كجم ÷ 50
    const s = units.find((u) => u.id === base.sub_unit_id);
    if (s && s.active !== 0) out.push({ id: s.id, name: s.name, toBase: 1 / f });
  }
  for (const u of units) {                     // الخامة بالكيلو → أدخل بالشيكارة: كجم = شيكارة × 50
    const uf = Number(u.sub_factor);
    if (u.id !== base.id && u.sub_unit_id === base.id && uf > 0 && u.active !== 0 && !out.some((x) => x.id === u.id)) out.push({ id: u.id, name: u.name, toBase: uf });
  }
  return out;
}

/** تحويل كمية مدخلة لوحدة الخامة (مع تقريب علشان نتفادى 0.30000000000000004) */
export const toBaseQty = (value, toBase) => {
  const v = Number(value);
  return Number.isFinite(v) ? Math.round(v * toBase * 1e6) / 1e6 : null;
};
