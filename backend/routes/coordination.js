import { Router } from 'express';
import {
  isCoordinator,
  localClaimTurn, localReleaseTurn,
  localGetLote, localCommitLote,
  localPeekDestinos, localAdvanceDestinos,
  localDistribuir,
  localCatalogo,
  localState,
} from '../lib/coordination.js';

// Endpoints del COORDINADOR (A). B los consume por HTTP para repartir los
// cursores y el turno sin tocar la base de A. Se montan ANTES del authMiddleware
// de /api y se protegen con un token dedicado (X-Coord-Token), compartido por
// entorno entre A y B.
const router = Router();

function checkToken(req, res, next) {
  const esperado = String(process.env.COORD_TOKEN || '');
  if (!esperado) {
    return res.status(400).json({ error: 'Este servidor no tiene COORD_TOKEN configurado; no puede coordinar.' });
  }
  const recibido = String(req.headers['x-coord-token'] || '');
  if (recibido !== esperado) {
    return res.status(401).json({ error: 'Token de coordinación inválido' });
  }
  next();
}

function requireCoordinator(req, res, next) {
  if (!isCoordinator()) {
    return res.status(409).json({ error: 'Esta instancia no es el coordinador (tiene COORD_URL).' });
  }
  next();
}

router.use(checkToken, requireCoordinator);

router.get('/estado', (req, res) => {
  res.json(localState());
});

router.post('/turno/claim', (req, res) => {
  const account = String(req.body?.account || '').trim();
  if (!account) return res.status(400).json({ error: 'Falta account' });
  const leaseMs = Number(req.body?.leaseMs) || undefined;
  res.json(localClaimTurn(account, leaseMs));
});

router.post('/turno/release', (req, res) => {
  const account = String(req.body?.account || '').trim();
  if (!account) return res.status(400).json({ error: 'Falta account' });
  res.json(localReleaseTurn(account));
});

router.get('/lote', (req, res) => {
  res.json({ lote_desde: localGetLote() });
});

router.post('/lote/commit', (req, res) => {
  const ultimo = typeof req.body?.ultimo === 'string' ? req.body.ultimo : '';
  res.json({ lote_desde: localCommitLote(ultimo) });
});

router.get('/destinos', (req, res) => {
  const n = Math.max(1, Math.min(500, Number(req.query.n) || 1));
  res.json(localPeekDestinos(n));
});

router.post('/destinos/advance', (req, res) => {
  const k = Number(req.body?.k) || 0;
  res.json(localAdvanceDestinos(k));
});

router.get('/catalogo', (req, res) => {
  res.json({ grupos: localCatalogo() });
});

router.post('/distribuir', (req, res) => {
  const ini = Number(req.body?.ini);
  const fin = Number(req.body?.fin);
  if (!Number.isFinite(ini) || !Number.isFinite(fin)) {
    return res.status(400).json({ error: 'Faltan ini/fin (ms)' });
  }
  const cantidad = Number(req.body?.cantidad) || 0;
  const minGapMs = Number(req.body?.minGapMs) || 0;
  res.json(localDistribuir({ ini, fin, cantidad, minGapMs }));
});

export default router;
