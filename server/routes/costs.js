import { Router } from 'express';
import { can, canModule, need } from '../lib/perms.js';
import { audit } from '../lib/core.js';
import { getConfig, cementCandidates, saveConfig, getSheet, savePeriod, approvePeriod, reopenPeriod, history } from '../lib/costing.js';

export function costsRouter() {
  const r = Router();
  r.use((req, res, next) => (canModule(req.user, 'costs') ? next() : res.status(403).json({ error: 'ليس لديك صلاحية على موديول التكاليف' })));
  r.get('/config', async (req, res) => { need(req.user, 'costs.config'); const c = await getConfig(); res.json({ ...c, cement_candidates: await cementCandidates(c) }); });
  r.put('/config', async (req, res) => { need(req.user, 'costs.config.edit'); const c = await saveConfig(req.body); await audit(req.user, 'config', 'costs', null, c); res.json({ ...c, cement_candidates: await cementCandidates(c) }); });
  r.get('/sheet', async (req, res) => { need(req.user, 'costs.unit-cost'); res.json(await getSheet(String(req.query.month || ''), Number(req.query.project_id) || 0)); });
  r.put('/period', async (req, res) => {
    need(req.user, 'costs.unit-cost.save'); const s = await savePeriod(req.body, req.user);
    await audit(req.user, 'save', 'unit_cost_period', null, { month: s.month, project_id: s.project_id, spread_rate: s.inputs.spread_rate }); res.json(s);
  });
  r.post('/approve', async (req, res) => {
    need(req.user, 'costs.unit-cost.approve'); const s = await approvePeriod(String(req.body.month || ''), req.body.project_id, req.user);
    await audit(req.user, 'approve', 'unit_cost_period', null, { month: s.month, project_id: s.project_id, unit_cost: s.unit_cost.total }); res.json(s);
  });
  r.post('/reopen', async (req, res) => {
    need(req.user, 'costs.unit-cost.reopen'); const s = await reopenPeriod(String(req.body.month || ''), req.body.project_id);
    await audit(req.user, 'reopen', 'unit_cost_period', null, { month: s.month, project_id: s.project_id }); res.json(s);
  });
  r.get('/history', async (req, res) => { need(req.user, 'costs.history'); res.json(await history(req.query)); });
  return r;
}
