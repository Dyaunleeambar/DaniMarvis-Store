// Tests de pistaSinCompositor: la pista que se agrega al error "No se encontró
// el compositor del grupo" para distinguir grupo cerrado de sesión caída o de
// bloqueo de Facebook. Se importa la función REAL del poster (su módulo puro),
// no se reimplementa.
//
// El caso que motiva esto: el 2026-10-15 se dispararon los fallos de
// publicaciones programadas y el error era siempre el mismo texto, así que no
// se podía saber desde los logs si había que re-loguear, esperar por un límite
// o descartar el grupo.
import { createRequire } from 'module';
import fs from 'fs';
const require_ = createRequire(import.meta.url);
const { pistaSinCompositor, decidirEnvio, ENVIO_VACIO_SOSTENIDO } = require_('../utilidades/fb-ranking/diagnostico_fb.js');

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) { console.log('  ok   ' + nombre); }
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

console.log('pistaSinCompositor\n');

ok('sin texto: sin pista', pistaSinCompositor('') === '');
ok('texto irrelevante: sin pista', pistaSinCompositor('Compra y venta en Matanzas') === '');

ok('muro de login',
  pistaSinCompositor('Inicia sesión en Facebook para continuar').includes('iniciar sesión'));
ok('login en inglés',
  pistaSinCompositor('You must log in to continue').includes('iniciar sesión'));

ok('aviso de bloqueo',
  pistaSinCompositor('No puedes publicar en este momento, has alcanzado un límite').includes('bloqueo'));
ok('bloqueo por demasiadas publicaciones',
  pistaSinCompositor('Demasiadas publicaciones. Intenta de nuevo más tarde.').includes('bloqueo'));
ok('restricción temporal',
  pistaSinCompositor('Tu cuenta está temporalmente restringida').includes('bloqueo'));

ok('grupo que exige unirse',
  pistaSinCompositor('Únete al grupo para ver las publicaciones').includes('unirse'));
ok('join group',
  pistaSinCompositor('Join group to see posts').includes('unirse'));

ok('grupo no disponible',
  pistaSinCompositor('Este contenido no está disponible').includes('no está disponible'));

// La prioridad importa: si el texto menciona login Y otra cosa, gana login.
ok('prioriza login sobre bloqueo',
  pistaSinCompositor('Inicia sesión. También hay un límite').includes('iniciar sesión'));

console.log('\ndecidirEnvio\n');

// El post ya aparece en el feed: señal fuerte, termina de inmediato.
ok('post en el feed -> listo',
  decidirEnvio({ aparecio: true, enCurso: false, conTexto: 0 }, 0).done === true);
ok('post en el feed gana aunque haya indicadores',
  decidirEnvio({ aparecio: true, enCurso: true, conTexto: 2 }, 0).done === true);

// Sigue subiendo: no terminó, aunque el compositor esté vacío.
ok('indicador de subida -> no listo',
  decidirEnvio({ aparecio: false, enCurso: true, conTexto: 0 }, 3).done === false);

// Todavía hay texto en el compositor: no terminó.
ok('compositor con texto -> no listo',
  decidirEnvio({ aparecio: false, enCurso: false, conTexto: 1 }, 3).done === false);

// Un parpadeo de compositor vacío (una muestra) NO debe dar por terminado.
ok('vacío por una sola muestra -> no listo',
  decidirEnvio({ aparecio: false, enCurso: false, conTexto: 0 }, 0).done === false);

// Sostenido suficientes muestras: listo.
{
  let n = 0; let fin = null;
  for (let i = 0; i < ENVIO_VACIO_SOSTENIDO; i++) {
    const r = decidirEnvio({ aparecio: false, enCurso: false, conTexto: 0 }, n);
    n = r.vacioSostenido; if (r.done) { fin = r; break; }
  }
  ok('vacío sostenido el umbral -> listo', fin && fin.done === true);
  ok('el contador sube muestra a muestra', n === ENVIO_VACIO_SOSTENIDO);
}

// Se corta la racha: si aparece texto, el contador vuelve a cero.
ok('la racha se reinicia si vuelve el texto',
  decidirEnvio({ aparecio: false, enCurso: false, conTexto: 1 }, 3).vacioSostenido === 0);
ok('la racha se reinicia si hay subida',
  decidirEnvio({ aparecio: false, enCurso: true, conTexto: 0 }, 3).vacioSostenido === 0);

// Muestra corrupta/ausente no debe dar por terminado (conservador).
ok('muestra nula -> no listo',
  decidirEnvio(null, 0).done === false);

// Regresión: el diagnóstico del compositor declaraba `possibles` (doble s) pero
// usaba `posibles`, y el ReferenceError se comía TODO el diagnóstico: los fallos
// salían como "(0 editor(es) con texto, el mayor de 0px²)" sin explicar por qué,
// y el texto de bloqueo de Facebook nunca se leía. El error solo aparece en
// runtime DENTRO de page.evaluate (nada lo detecta hasta que falla una corrida),
// así que se vigila la fuente acá.
const srcPoster = fs.readFileSync(new URL('../utilidades/fb-ranking/group_poster.js', import.meta.url), 'utf8');
ok('la lista de carteles del diagnóstico usa el nombre correcto',
  srcPoster.includes('const posibles =') && !srcPoster.includes('possibles'));

if (fallos) { console.log('\n' + fallos + ' FALLA(S)'); process.exit(1); }
console.log('\nTodo en verde');
