import { Router } from 'express';
import { can } from '../lib/perms.js';
import { AppError } from '../db.js';
import * as P3 from '../lib/phase3.js';

/** مساعدات شاشات المرحلة 3 (قراءة فقط): كميات الإنتاج، الرصيد المتاح للتسليم، بنود التسليم المتاحة للمستخلص */
export function phase3Router() {
  const r = Router();
  const need = (req, ...keys) => { if (!can(req.user, keys)) throw new AppError('ليس لديك صلاحية', 403); };
  r.get('/production', async (req, res) => { need(req, 'production.quantities', 'production.log', 'costs.projects-cost'); res.json(await P3.monthProduction(String(req.query.month || ''), Number(req.query.project_id) || null)); });
  r.get('/availability', async (req, res) => { need(req, 'sales.deliveries', 'production.fg-stock'); res.json(await P3.fgAvailability(Number(req.query.project_id), req.query.date || null)); });
  r.get('/certifiable', async (req, res) => { need(req, 'sales.certificates'); res.json(await P3.certifiableLines(Number(req.query.project_id), { from: req.query.from, to: req.query.to, certId: req.query.cert_id })); });
  r.get('/deduction-defaults', async (req, res) => { need(req, 'sales.certificates'); res.json({ profit_pct: await P3.profitPct() }); });
  return r;
}
