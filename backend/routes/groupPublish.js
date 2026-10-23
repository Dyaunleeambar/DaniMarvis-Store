import { Router } from 'express';
import { startGroupPublish, groupPublishStatus } from '../lib/groupPublisher/index.js';
import { getAccountConfig, ACCOUNT_IDS } from '../lib/accountConfig.js';
import { abrirChromeParaLogin, detectarPerfilFacebook } from '../lib/chromeLauncher.js';

const router = Router();

router.get('/status', async (req, res) => {
  res.json(await groupPublishStatus());
});

// Cuentas de Facebook: abre el Chrome de una cuenta (con su perfil/puerto/proxy)
// para que el usuario inicie sesión A MANO. La app nunca escribe credenciales.
// `?detect=1` además consulta qué perfil quedó logueado en ese Chrome.
router.post('/accounts/:id/open', async (req, res) => {
  const id = String(req.params.id || '').toUpperCase();
  if (!ACCOUNT_IDS.includes(id)) return res.status(400).json({ error: 'Cuenta inválida (A o B).' });
  const acc = getAccountConfig(id);
  const destino = typeof req.body?.url === 'string' && /^https?:\/\//i.test(req.body.url)
    ? req.body.url
    : 'https://www.facebook.com/login';
  const r = await abrirChromeParaLogin(destino, acc);
  if (!r.ok) return res.status(500).json({ error: r.error || 'No se pudo abrir Chrome', ...r });
  let profile = null;
  if (req.body?.detect !== false) {
    // Dar un margen a que Chrome termine de abrir la página antes de mirar.
    await new Promise(resolve => setTimeout(resolve, 2500));
    profile = await detectarPerfilFacebook(r.port);
  }
  res.json({ ...r, account: id, expected: acc.fbProfile || '', profile });
});

// Consulta pasiva (no lanza nada): qué perfil de Facebook tiene logueado el
// Chrome de la cuenta, si está escuchando en su puerto.
router.get('/accounts/:id/profile', async (req, res) => {
  const id = String(req.params.id || '').toUpperCase();
  if (!ACCOUNT_IDS.includes(id)) return res.status(400).json({ error: 'Cuenta inválida (A o B).' });
  const acc = getAccountConfig(id);
  const profile = await detectarPerfilFacebook(acc.debugPort);
  res.json({ account: id, expected: acc.fbProfile || '', profile });
});

// Publica/prepara los ítems vencidos de la cola (modo automático respeta
// franja horaria, cap diario y gap). Con force=true ignora esas condiciones
// naturales (solo rutas manuales de la UI).
//
// NO espera al run: devuelve 202 con el runId y el trabajo sigue en background.
// El poster tiene --max-seconds=600 y entre posts hay 45-135s de separación, así
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