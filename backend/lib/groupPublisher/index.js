// Barrel del publicador de grupos. Es el ÚNICO punto de entrada de la API
// pública: el resto de los módulos (server.js, routes/, tests) importan de acá.
//
// El split por responsabilidades vive en esta carpeta:
//   util.js      fechas/horas puras y sin estado
//   estado.js    lecturas de la cola que comparten varios módulos
//   config.js    defaults, lectura de publish_config y la técnica de texto
//   limites.js   ritmo, corte automático, anti-duplicado y decisión del tick
//   poster.js    invocación del poster hijo y lectura de su salida
//   cola.js      resolución de inputs, corrida y estado de corrida
//   schedulers.js los dos relojes (worker con límites y disparador por fecha)
//
// `decisionActual` se suma a la API pública a propósito: era interna de la
// agenda y era la única forma de ver la política de límites con los valores
// reales de la base.
export {
  DEFAULT_AUTO_PUBLISH, DEFAULT_AGENDA, DEFAULT_MASTER, METODOS_TEXTO, DEFAULT_METODO_TEXTO,
  metodoTextoDeConfig, getAutopublishConfig, setLoteCursor, getMasterConfig, getAgendaConfig, getMetodoTexto,
} from './config.js';

export { elegirAnclaIntento } from './estado.js';

export {
  leerBreaker, registrarFallo, limpiarFallos, evaluarLimites, cuantosPorTick,
  claveDuplicado, marcarDuplicadosEn, decisionActual,
} from './limites.js';

export { parsePosterOutput, parsePosterDiag, notaLote, CAUSAS, classifyFailure, esFalloTransitorio } from './poster.js';

export { logFinCorrida, startGroupPublish } from './cola.js';

export {
  runSchedulerTick, groupPublishStatus, schedulerState,
  startGroupPublishScheduler, stopGroupPublishScheduler, rescheduleGroupPublish,
  agendaSchedulerState, runAgendaTick, startAgendaScheduler, stopAgendaScheduler, rescheduleAgenda,
} from './schedulers.js';

// alias explícito: server.js lo usa para leer si el worker estaba activo antes de
// guardar la config, y asi un guardado no enciende un worker apagado.
export { schedulerState as groupPublishSchedulerState } from './schedulers.js';
