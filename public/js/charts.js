// رسوم بيانية خفيفة (HTML/SVG بدون مكتبات) — بتظهر في الشاشة وبتتطبع مع التقرير
import { h, fmt, card } from './core.js';

export const PALETTE = ['#0f766e', '#d97706', '#2563eb', '#9333ea', '#dc2626', '#16a34a', '#0891b2', '#be185d', '#65a30d', '#475569'];
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); kids.forEach((c) => el.append(c)); return el; };

/** أعلى N عنصر + «أخرى» لباقي العناصر */
export function topN(items, n) {
  const list = items.filter((x) => Number(x.value) > 0).sort((a, b) => b.value - a.value);
  if (list.length <= n) return list;
  const rest = list.slice(n - 1).reduce((s, x) => s + x.value, 0);
  return [...list.slice(0, n - 1), { label: 'أخرى', value: rest }];
}

/** أعمدة أفقية. items: [{label, value, series?: [{name, value}]}]؛ لو فيه series بتتعرض مكدّسة */
export function barChart(items, { fmtV = (v) => fmt(v), max = 10 } = {}) {
  const rows = items.filter((x) => Math.abs(Number(x.value)) > 0).sort((a, b) => b.value - a.value).slice(0, max);
  if (!rows.length) return h('div.empty-state', 'لا توجد بيانات للرسم');
  const mx = Math.max(...rows.map((r) => Math.abs(r.value)));
  const names = [...new Set(rows.flatMap((r) => (r.series || []).filter((s) => s.value).map((s) => s.name)))];
  const color = (name) => PALETTE[names.indexOf(name) % PALETTE.length];
  const legend = names.length ? h('div.legend', names.map((n) => h('span', h('i', { style: { background: color(n) } }), n))) : null;
  return h('div.bar-chart', legend, rows.map((r) => h('div.bar-row', h('span.bar-label', { title: r.label }, r.label),
    h('div.bar-track', r.series && r.series.some((s) => s.value)
      ? r.series.filter((s) => s.value > 0).map((s) => h('i.bar-seg', { title: `${s.name}: ${fmtV(s.value)}`, style: { width: (s.value / mx * 100) + '%', background: color(s.name) } }))
      : h('i.bar-seg', { style: { width: (Math.abs(r.value) / mx * 100) + '%', background: r.value < 0 ? '#dc2626' : PALETTE[0] } })),
    h('b.bar-val', fmtV(r.value)))));
}

/** دائرة بيانية (donut) مع دليل بالنسب. items: [{label, value}] */
export function donutChart(items, { top = 6, fmtV = (v) => fmt(v) } = {}) {
  const list = topN(items, top);
  const total = list.reduce((s, x) => s + x.value, 0);
  if (!total) return h('div.empty-state', 'لا توجد بيانات للرسم');
  const R = 44, C = 2 * Math.PI * R; let off = 0;
  const arcs = list.map((x, i) => {
    const len = x.value / total * C;
    const el = svg('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: PALETTE[i % PALETTE.length], 'stroke-width': 22, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 60 60)' });
    off += len; return el;
  });
  const pie = svg('svg', { viewBox: '0 0 120 120', class: 'donut', width: 150, height: 150 }, ...arcs);
  return h('div.donut-wrap', pie, h('div.legend.col', list.map((x, i) => h('span', h('i', { style: { background: PALETTE[i % PALETTE.length] } }), `${x.label}: `, h('b', fmtV(x.value)), ' — ', h('span', { style: { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' } }, `${(x.value / total * 100).toFixed(1)}%`)))));
}

export const chartCard = (title, body) => card(title, body);
export const chartsGrid = (...cards) => h('div.chart-grid', cards.filter(Boolean));
