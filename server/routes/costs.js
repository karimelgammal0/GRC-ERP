import { Router } from 'express';
import { can, canModule, need } from '../lib/perms.js';
import { audit } from '../lib/core.js';
import * as P3 from '../lib/phase3.js';
import { getAlloc, approveAlloc, reopenAlloc } from '../lib/alloc.js';
import { getConfig, basisCandidates, basisOf, productKinds, kindOf as kindFor, saveConfig, getSheet, savePeriod, approvePeriod, reopenPeriod, history } from '../lib/costing.js';

export function costsRouter() {
  const r = Router();
  r.use((req, res, next) => (canModule(req.user, 'costs') ? next() : res.status(403).json({ error: 'ليس لديك صلاحية على موديول التكاليف' })));
  r.get('/config', async (req, res) => { need(req.user, 'costs.config'); const c = await getConfig(); const kind = await kindFor(req.query.kind); res.json({ ...c, kind, kinds: await productKinds(), basis_meta: { ...basisOf(kind), pats: undefined }, candidates: await basisCandidates(c, kind) }); });
  r.put('/config', async (req, res) => { need(req.user, 'costs.config.edit'); const c = await saveConfig(req.body); await audit(req.user, 'config', 'costs', null, c); const kind = await kindFor(req.body.basis?.kind || req.query.kind); res.json({ ...c, kind, kinds: await productKinds(), basis_meta: { ...basisOf(kind), pats: undefined }, candidates: await basisCandidates(c, kind) }); });
  r.get('/sheet', async (req, res) => { need(req.user, 'costs.unit-cost'); res.json(await getSheet(String(req.query.month || ''), Number(req.query.project_id) || 0, req.query.kind || 'GRC')); });
  r.put('/period', async (req, res) => {
    need(req.user, 'costs.unit-cost.save'); const s = await savePeriod(req.body, req.user);
    await audit(req.user, 'save', 'unit_cost_period', null, { month: s.month, kind: s.kind, project_id: s.project_id, spread_rate: s.inputs.spread_rate }); res.json(s);
  });
  r.post('/approve', async (req, res) => {
    need(req.user, 'costs.unit-cost.approve'); const s = await approvePeriod(String(req.body.month || ''), req.body.project_id, req.user, req.body.kind);
    await audit(req.user, 'approve', 'unit_cost_period', null, { month: s.month, project_id: s.project_id, unit_cost: s.unit_cost.total }); res.json(s);
  });
  r.post('/reopen', async (req, res) => {
    need(req.user, 'costs.unit-cost.reopen'); const s = await reopenPeriod(String(req.body.month || ''), req.body.project_id, req.body.kind);
    await audit(req.user, 'reopen', 'unit_cost_period', null, { month: s.month, project_id: s.project_id }); res.json(s);
  });
  // ---- توزيع التكاليف غير المباشرة (شهري) ----
  r.get('/alloc', async (req, res) => { need(req.user, 'costs.alloc'); res.json(await getAlloc(String(req.query.month || ''))); });
  r.post('/alloc/approve', async (req, res) => { need(req.user, 'costs.alloc.approve'); const x = await approveAlloc(String(req.body.month || ''), req.user); await audit(req.user, 'approve', 'indirect_allocation', null, { month: x.month, total: x.total }); res.json(x); });
  r.post('/alloc/reopen', async (req, res) => { need(req.user, 'costs.alloc.reopen'); const x = await reopenAlloc(String(req.body.month || '')); await audit(req.user, 'reopen', 'indirect_allocation', null, { month: x.month }); res.json(x); });
  // ---- تكلفة المنتج التام لكل مشروع وشهر ----
  r.get('/runs', async (req, res) => { need(req.user, 'costs.projects-cost'); res.json(await P3.monthOverview(String(req.query.month || ''))); });
  r.get('/run', async (req, res) => { need(req.user, 'costs.projects-cost'); res.json(await P3.getRun(String(req.query.month || ''), Number(req.query.project_id))); });
  r.put('/run', async (req, res) => { need(req.user, 'costs.projects-cost.save'); res.json(await P3.saveRun(String(req.body.month || ''), Number(req.body.project_id), req.body.carry)); });
  r.post('/run/approve', async (req, res) => {
    need(req.user, 'costs.projects-cost.approve'); const x = await P3.approveRun(String(req.body.month || ''), Number(req.body.project_id), req.user);
    await audit(req.user, 'approve', 'costing_run', null, { month: x.month, project_id: x.project_id, total: x.total }); res.json(x);
  });
  r.post('/run/reopen', async (req, res) => {
    need(req.user, 'costs.projects-cost.reopen'); const x = await P3.reopenRun(String(req.body.month || ''), Number(req.body.project_id));
    await audit(req.user, 'reopen', 'costing_run', null, { month: x.month, project_id: x.project_id }); res.json(x);
  });
  r.get('/history', async (req, res) => { need(req.user, 'costs.history'); res.json(await history(req.query)); });
  return r;
}
