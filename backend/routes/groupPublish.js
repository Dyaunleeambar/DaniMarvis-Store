import { Router } from 'express';
import { startGroupPublish, groupPublishStatus } from '../lib/groupPublisher.js';

const router = Router();

router.get('/status', async (req, res) => {
  res.json(await groupPublishStatus());
});

// Publica/prepara los ítems vencidos de la cola (modo automático respeta
// franja horaria, cap diario y gap). Con force=true ignora esas condiciones
// naturales (solo rutas manuales de la UI).
//
// NO espera al run: devuelve 202 con el runId y el trabajo sigue en background.
// El poster tiene --max-seconds=300 y entre posts hay 45-135s de separación, así
// que una corrida completa son minutos. El resultado se lee por polling en
// GET /status (campo `current`).
router.post('/run', (req, res) => {
  const { mode, force: forceRaw, ids } = req.body || {};
  const force = !!forceRaw;
  const idsArr = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  const r = startGroupPublish({
    auto: !idsArr.length,
    force,
    ids: idsArr,
    mode: typeof mode === 'string' ? mode : null,
    origen: 'manual',
  });
  if (r.skipped) return res.status(409).json(r);
  res.status(202).json(r);
});

router.post('/run/:id', (req, res) => {
  const { mode } = req.body || {};
  const r = startGroupPublish({
    auto: false,
    force: true,
    ids: [req.params.id],
    mode: typeof mode === 'string' ? mode : null,
    origen: 'manual',
  });
  if (r.skipped) return res.status(409).json(r);
  res.status(202).json(r);
});

export default router;