// Gap entre publicaciones: fijo o por rango (Ajustes > Tiempos).
//
// Lo que se prueba: la política pura (sortear, acotar, decidir), que el sorteo se
// haga UNA vez por publicación y se guarde en la marca del intento, que el modo se
// normalice como la agenda lo exige, y el cableado hasta la pantalla. Lo que el test
// NO puede probar es cómo responde Facebook a un ritmo u otro: eso se mide en el log
// ([agenda] ... gap 1–3 min (al azar)).
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};
const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-gap-'));
mkdirSync(dir, { recursive: true });
process.env.DANIMARVIS_DB = join(dir, 'prueba.db');
process.env.DANIMARVIS_ENV_PATH = join(dir, 'nada.env');

const { initDB, getDB } = await import('../backend/db/database.js');
const {
  sortearGapMs, gapEfectivoMs, describirGap, evaluarLimites, marcarIntentoAhora,
  decisionActual, getAgendaConfig,
} = await import('../backend/lib/groupPublisher/index.js');
const { mergePublishConfig } = await import('../backend/lib/settingsMerge.js');
await initDB();

const MIN = 60000;
const db = () => getDB();
const leerPC = () => JSON.parse(db().prepare('SELECT publish_config FROM settings WHERE id = 1').get().publish_config || '{}');
const escribirPC = (pc) => db().prepare('UPDATE settings SET publish_config = ? WHERE id = 1').run(JSON.stringify(pc));
const RANGO = { gap_modo: 'rango', min_gap_min: 1, gap_max_min: 3, max_per_hour: 100 };
const FIJO = { gap_modo: 'fijo', min_gap_min: 5, gap_max_min: 5, max_per_hour: 100 };

console.log('\n1. sortearGapMs: un valor dentro del rango, o nada si es fijo\n');
{
  ok('modo fijo no sortea', sortearGapMs(FIJO) === null);
  ok('sin cfg no sortea ni revienta', sortearGapMs(null) === null && sortearGapMs(undefined) === null);
  ok('con rand=0 sale el mínimo (1 min)', sortearGapMs(RANGO, () => 0) === 1 * MIN);
  ok('con rand=0,5 sale la mitad (2 min)', sortearGapMs(RANGO, () => 0.5) === 2 * MIN);
  ok('con rand≈1 sale el máximo (3 min), nunca más', sortearGapMs(RANGO, () => 0.9999999) === 3 * MIN);
  ok('un rand fuera de 0..1 se acota', sortearGapMs(RANGO, () => 7) === 3 * MIN && sortearGapMs(RANGO, () => -4) === 1 * MIN);
  ok('un rand inválido (NaN) cae al mínimo', sortearGapMs(RANGO, () => NaN) === 1 * MIN);
  ok('la resolución es de 1 s', [0.1, 0.33, 0.777].every((r) => sortearGapMs(RANGO, () => r) % 1000 === 0));
  ok('máximo menor que el mínimo no rompe: queda en el mínimo',
    sortearGapMs({ ...RANGO, min_gap_min: 4, gap_max_min: 2 }, () => 0.9) === 4 * MIN);
  let min = Infinity; let max = 0;
  for (let i = 0; i < 2000; i++) { const g = sortearGapMs(RANGO); min = Math.min(min, g); max = Math.max(max, g); }
  ok('con el azar real, 2000 sorteos quedan siempre dentro de 1–3 min', min >= 1 * MIN && max <= 3 * MIN, `${min}..${max}`);
}

console.log('\n2. gapEfectivoMs: qué gap rige ahora\n');
{
  ok('fijo: siempre min_gap_min', gapEfectivoMs(FIJO) === 5 * MIN);
  ok('fijo ignora un sorteo viejo guardado (cambiar de modo aplica al instante)', gapEfectivoMs(FIJO, 2 * MIN) === 5 * MIN);
  ok('rango: usa el sorteo guardado', gapEfectivoMs(RANGO, 2 * MIN) === 2 * MIN);
  ok('rango: un sorteo por debajo del rango nuevo sube al mínimo', gapEfectivoMs({ ...RANGO, min_gap_min: 5, gap_max_min: 8 }, 2 * MIN) === 5 * MIN);
  ok('rango: un sorteo por encima del rango nuevo baja al máximo', gapEfectivoMs({ ...RANGO, min_gap_min: 1, gap_max_min: 2 }, 9 * MIN) === 2 * MIN);
  ok('rango sin sorteo guardado: el lado prudente (el máximo), solo esa vez', gapEfectivoMs(RANGO, null) === 3 * MIN);
  ok('sin cfg cae al default de la agenda (5 min)', gapEfectivoMs(null) === 5 * MIN);
  ok('min_gap_min inválido cae al default, nunca a 0', gapEfectivoMs({ gap_modo: 'fijo', min_gap_min: 'x' }) === 5 * MIN);
  ok('describirGap fijo', describirGap(FIJO) === '5 min');
  ok('describirGap rango', describirGap(RANGO) === '1–3 min (al azar)');
}

console.log('\n3. evaluarLimites con el gap por rango\n');
{
  const ahora = Date.now();
  const ancla = ahora - 1.5 * MIN;
  const a = evaluarLimites({ cfg: RANGO, nowMs: ahora, lastAttemptMs: ancla, gapMsGuardado: 2 * MIN });
  ok('con un sorteo de 2 min y 1,5 min transcurridos, frena', !a.ok && a.codigo === 'gap', JSON.stringify(a));
  ok('el motivo dice el gap sorteado y cuánto falta', a.motivo === 'separación mínima de 2 min: faltan 1 min', a.motivo);
  const b = evaluarLimites({ cfg: RANGO, nowMs: ahora, lastAttemptMs: ahora - 2 * MIN, gapMsGuardado: 2 * MIN });
  ok('a los 2 min exactos ya deja salir', b.ok === true, JSON.stringify(b));
  const c = evaluarLimites({ cfg: RANGO, nowMs: ahora, lastAttemptMs: ahora - 1 * MIN, gapMsGuardado: 1 * MIN });
  ok('con un sorteo de 1 min, a 1 min ya sale', c.ok === true);
  const d = evaluarLimites({ cfg: RANGO, nowMs: ahora, lastAttemptMs: ahora - 0.5 * MIN, gapMsGuardado: 90000 });
  ok('un gap sorteado con fracción se muestra con decimales', d.motivo.startsWith('separación mínima de 1.5 min'), d.motivo);
  const e = evaluarLimites({ cfg: FIJO, nowMs: ahora, lastAttemptMs: ahora - 4 * MIN });
  ok('modo fijo: el mensaje de siempre', !e.ok && e.motivo === 'separación mínima de 5 min: faltan 1 min', e.motivo);
  const f = evaluarLimites({ cfg: { ...RANGO, max_per_hour: 2 }, nowMs: ahora, lastAttemptMs: ahora - 10 * MIN, gapMsGuardado: 1 * MIN, intentosHora: 2 });
  ok('el tope por hora sigue mandando aunque el gap ya pasó', !f.ok && f.codigo === 'tope_hora');
}

console.log('\n4. por qué se sortea UNA vez por publicación y no en cada tick\n');
{
  // Generador con semilla: el test no puede depender de la suerte.
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cfg = { gap_modo: 'rango', min_gap_min: 1, gap_max_min: 10 };
  const N = 20000;
  // El disparador revisa cada minuto: el gap efectivo es el primer tick >= al gap.
  const rngA = mulberry32(7); let sumaUna = 0;
  for (let i = 0; i < N; i++) sumaUna += Math.ceil(sortearGapMs(cfg, rngA) / MIN);
  const rngB = mulberry32(7); let sumaTick = 0;
  for (let i = 0; i < N; i++) { let t = 1; while (t < sortearGapMs(cfg, rngB) / MIN) t++; sumaTick += t; }
  const mediaUna = sumaUna / N; const mediaTick = sumaTick / N;
  ok('sorteando una vez, el gap medio queda en el centro del rango (≈5,5–6 min)', mediaUna > 5.3 && mediaUna < 6.3, mediaUna.toFixed(2));
  ok('sorteando en cada tick el gap medio se sesga hacia el mínimo', mediaTick < mediaUna - 0.5, `${mediaTick.toFixed(2)} vs ${mediaUna.toFixed(2)}`);
}

console.log('\n5. la marca del intento guarda el sorteo (base real)\n');
{
  marcarIntentoAhora(RANGO);
  const m = leerPC()._ultimoIntento;
  ok('en modo rango la marca lleva gap_ms', Number.isFinite(m.gap_ms) && m.gap_ms >= 1 * MIN && m.gap_ms <= 3 * MIN, JSON.stringify(m));
  ok('y sigue llevando el ancla (ms y at)', m.ms > 0 && typeof m.at === 'string');
  marcarIntentoAhora(FIJO);
  ok('en modo fijo la marca NO lleva gap_ms (se limpia el sorteo anterior)', !('gap_ms' in leerPC()._ultimoIntento));
  marcarIntentoAhora();
  ok('sin cfg tampoco sortea (llamada de siempre)', !('gap_ms' in leerPC()._ultimoIntento));

  // decisionActual lee el sorteo de la marca
  const ahora = Date.now();
  const pc = leerPC();
  pc._ultimoIntento = { at: new Date(ahora - 1.5 * MIN).toISOString(), ms: ahora - 1.5 * MIN, gap_ms: 2 * MIN };
  escribirPC(pc);
  const d1 = decisionActual(RANGO, ahora);
  ok('decisionActual respeta el sorteo guardado: a 1,5 de 2 min frena', !d1.ok && d1.codigo === 'gap' && d1.motivo.includes('de 2 min'), JSON.stringify(d1));
  const d2 = decisionActual(RANGO, ahora + 1 * MIN);
  ok('un minuto después (2,5 min) ya sale', d2.ok === true, JSON.stringify(d2));
  const d3 = decisionActual(FIJO, ahora);
  ok('en modo fijo ignora ese sorteo y espera los 5 min', !d3.ok && d3.motivo.includes('de 5 min'), JSON.stringify(d3));
  const d4 = decisionActual({ ...RANGO, min_gap_min: 5, gap_max_min: 8 }, ahora);
  ok('si el rango cambió después del sorteo, el valor viejo se acota al rango nuevo (5 min)', !d4.ok && d4.motivo.includes('de 5 min'), JSON.stringify(d4));

  // marca sin sorteo (recién pasado a rango): lado prudente
  const pc2 = leerPC();
  pc2._ultimoIntento = { at: new Date(ahora - 2 * MIN).toISOString(), ms: ahora - 2 * MIN };
  escribirPC(pc2);
  const d5 = decisionActual(RANGO, ahora);
  ok('rango sin sorteo guardado: usa el máximo (3 min) esta vez', !d5.ok && d5.motivo.includes('de 3 min'), JSON.stringify(d5));
}

console.log('\n6. getAgendaConfig normaliza el modo\n');
{
  const conAgenda = (agenda) => { const pc = leerPC(); pc.agenda = agenda; escribirPC(pc); return getAgendaConfig(); };
  const sinNada = conAgenda({});
  ok('sin nada guardado: modo fijo (lo de siempre)', sinNada.gap_modo === 'fijo' && sinNada.min_gap_min === 5 && sinNada.gap_max_min === 5, JSON.stringify([sinNada.gap_modo, sinNada.min_gap_min, sinNada.gap_max_min]));
  ok('un modo desconocido cae a fijo', conAgenda({ gap_modo: 'turbo', min_gap_min: 2 }).gap_modo === 'fijo');
  const r = conAgenda({ gap_modo: 'rango', min_gap_min: 1, gap_max_min: 3 });
  ok('rango válido se conserva', r.gap_modo === 'rango' && r.min_gap_min === 1 && r.gap_max_min === 3);
  ok('un máximo menor que el mínimo sube al mínimo', conAgenda({ gap_modo: 'rango', min_gap_min: 4, gap_max_min: 2 }).gap_max_min === 4);
  ok('un máximo absurdo se limita a 1440', conAgenda({ gap_modo: 'rango', min_gap_min: 1, gap_max_min: 99999 }).gap_max_min === 1440);
  ok('sin máximo, el máximo es el mínimo', conAgenda({ gap_modo: 'rango', min_gap_min: 3 }).gap_max_min === 3);
  ok('el mínimo sigue acotado a 1–1440', conAgenda({ min_gap_min: 0 }).min_gap_min === 5 && conAgenda({ min_gap_min: 5000 }).min_gap_min === 1440);
}

console.log('\n7. guardar desde Ajustes: el merge conserva la agenda\n');
{
  const base = { agenda: { lote_desde: 'Grupo X', grupos_por_post: 9, max_per_hour: 12, min_gap_min: 5 }, metodo_texto: 'pasteEvent' };
  const m = mergePublishConfig(base, {
    tiempos: { perfil: 'seguro' },
    agenda: { min_gap_min: 1, gap_modo: 'rango', gap_max_min: 3 },
  });
  ok('guarda el modo y los dos extremos', m.agenda.gap_modo === 'rango' && m.agenda.min_gap_min === 1 && m.agenda.gap_max_min === 3);
  ok('conserva el cursor de lote y el tope por hora', m.agenda.lote_desde === 'Grupo X' && m.agenda.max_per_hour === 12 && m.agenda.grupos_por_post === 9);
  ok('y lo demás de la config', m.metodo_texto === 'pasteEvent' && m.tiempos.perfil === 'seguro');
  const solo = mergePublishConfig(m, { agenda: { auto: true, tick_min: 1 } });
  ok('guardar la tarjeta Agenda (que ya no manda el gap) no lo borra', solo.agenda.gap_modo === 'rango' && solo.agenda.min_gap_min === 1 && solo.agenda.gap_max_min === 3);
}

console.log('\n8. cableado y limpieza\n');
{
  const cola = leer('../backend/lib/groupPublisher/cola.js');
  ok('cada intento sortea con la config de la agenda', cola.includes('marcarIntentoAhora(agendaCfg)'));
  const sch = leer('../backend/lib/groupPublisher/schedulers.js');
  ok('el log y el estado de la agenda dicen el modo del gap', sch.includes('describirGap(cfg)') && sch.includes('gap_modo: cfg ? cfg.gap_modo : null'));

  const vista = leer('../frontend/js/views/settingsView.js');
  ok('Tiempos tiene el selector de modo y los dos extremos', vista.includes('name="g_modo"') && vista.includes('name="g_min"') && vista.includes('name="g_max"'));
  ok('al guardar manda el gap a la agenda, junto a los tiempos',
    vista.includes('agenda: { min_gap_min: gapMin, gap_modo: modoGap, gap_max_min: gapMax }') && vista.includes('tiempos: { perfil, valores: personal, confirm_red: redPersonal }'));
  ok('el máximo menor que el mínimo se rechaza con aviso', vista.includes('el máximo no puede ser menor que el mínimo'));
  ok('la tarjeta Agenda ya no edita el gap (un solo lugar)', !vista.includes('name="ag_gap"') && !vista.includes("fd.get('ag_gap')"));
  ok('y dice dónde se configura', vista.includes('Se configura en la tarjeta <strong>Tiempos del publicador</strong>'));
  ok('los valores por defecto de la pantalla coinciden con el backend (5 min, 12/h)', vista.includes('min_gap_min: 5, max_per_hour: 12'));

  // el gap_min de Tiempos era código muerto (nadie lo leía): fuera de las tres copias
  const sinMuerto = (txt) => !/(^|[^_\w])gap_min\b/.test(txt);
  ok('gap_min ya no está en tiempos.js', sinMuerto(leer('../backend/lib/groupPublisher/tiempos.js')));
  ok('ni en tiempos_poster.js', sinMuerto(leer('../utilidades/fb-ranking/tiempos_poster.js')));
  ok('ni en la pantalla', sinMuerto(vista));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
