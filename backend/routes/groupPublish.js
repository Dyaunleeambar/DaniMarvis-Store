import { Router } from 'express';
import { runGroupPublish, groupPublishStatus } from '../lib/groupPublisher.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json(groupPublishStatus());
});

// Publica/prepara los ítems vencidos de la cola (modo automático respeta
// franja horaria, cap diario y cooldowns). Con force=true ignora las
// condiciones naturales (solo rutas manuales de la UI).
router.post('/run', async (req, res) => {
  const { mode, force: forceRaw, ids } = req.body || {};
  const force = !!forceRaw;
  const idsArr = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  const r = await runGroupPublish({
    auto: !idsArr.length,
    force,
    ids: idsArr,
    mode: typeof mode === 'string' ? mode : null,
  });
  if (r.skipped) return res.status(409).json(r);
  if (r.ok === false) return res.status(400).json(r);
  res.json(r);
});

router.post('/run/:id', async (req, res) => {
  const { mode } = req.body || {};
  const r = await runGroupPublish({
    auto: false,
    force: true,
    ids: [req.params.id],
    mode: typeof mode === 'string' ? mode : null,
  });
  if (r.skipped) return res.status(409).json(r);
  if (r.ok === false) return res.status(400).json(r);
  res.json(r);
});

export default router;