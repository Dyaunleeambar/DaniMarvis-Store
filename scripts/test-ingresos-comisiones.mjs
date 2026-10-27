// Tests de "Ingresos totales" (Ventas, su PDF y el Dashboard): son las COMISIONES YA
// COBRADAS (USD y MN por separado) de ventas NO canceladas, no la suma del valor de
// los productos vendidos.
// Se importa el utils.js REAL del frontend; el cableado en la vista y el PDF se
// verifica leyendo su código (no se abre un navegador).
import { readFileSync } from 'node:fs';
import { sumarComisiones, ingresosDeVentas, textoComisiones, formatUSD } from '../frontend/js/utils/utils.js';
import { ingresosPorComisiones } from '../backend/lib/ingresos.js';
import { abrirMemoria } from './helpers/sqljs.mjs';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const venta = (total, com, moneda, pagada, estado = 'delivered') => ({ total_amount: total, commission_amount: com, commission_currency: moneda, commission_paid: pagada, delivery_status: estado });

console.log('1. sumarComisiones: qué cuenta como ingreso\n');
{
  const ventas = [
    venta(1000, 50, 'USD', 1),     // cobrada
    venta(2000, 120, 'USD', 1),    // cobrada
    venta(500, 3000, 'MN', 1),     // cobrada en MN
    venta(9000, 400, 'USD', 0),    // pendiente: NO es ingreso todavía
    venta(300, 1500, 'MN', 0),     // pendiente en MN
  ];
  const c = sumarComisiones(ventas, true);
  ok('suma solo las comisiones cobradas en USD', c.usd === 170, JSON.stringify(c));
  ok('suma solo las comisiones cobradas en MN', c.mn === 3000, JSON.stringify(c));
  const p = sumarComisiones(ventas, false);
  ok('las pendientes son las que quedan fuera de los ingresos', p.usd === 400 && p.mn === 1500, JSON.stringify(p));
  ok('el valor de los productos vendidos no entra para nada',
    sumarComisiones([venta(1e6, 10, 'USD', 1)], true).usd === 10);
  ok('cobradas + pendientes = todas las comisiones',
    c.usd + p.usd === 570 && c.mn + p.mn === 4500);
}

console.log('\n2. casos raros\n');
{
  ok('lista vacía o nula no revienta', sumarComisiones([], true).usd === 0 && sumarComisiones(null, true).mn === 0);
  ok('sin moneda se toma como USD', sumarComisiones([venta(1, 25, undefined, 1)], true).usd === 25);
  ok('monto vacío o inválido cuenta como 0', sumarComisiones([venta(1, null, 'USD', 1), venta(1, 'abc', 'USD', 1), venta(1, '7.5', 'USD', 1)], true).usd === 7.5);
  ok('commission_paid acepta 1, true y "1"', sumarComisiones([venta(1, 1, 'USD', 1), venta(1, 2, 'USD', true), venta(1, 4, 'USD', '1')], true).usd === 7);
  ok('commission_paid 0, false o ausente es pendiente', sumarComisiones([venta(1, 1, 'USD', 0), venta(1, 2, 'USD', false), venta(1, 4, 'USD', undefined)], true).usd === 0);
  ok('una moneda desconocida no se mezcla con USD ni MN', (() => { const r = sumarComisiones([venta(1, 9, 'EUR', 1)], true); return r.usd === 0 && r.mn === 0; })());
}

console.log('\n3. textoComisiones\n');
{
  ok('solo USD', textoComisiones({ usd: 12, mn: 0 }) === formatUSD(12));
  ok('USD y MN juntos, separados por " + "', /^\$12\.00 \+ .+/.test(textoComisiones({ usd: 12, mn: 5000 }).replace(/\s/g, ' ')) || textoComisiones({ usd: 12, mn: 5000 }).includes(' + '));
  ok('solo MN no muestra un USD vacío', !textoComisiones({ usd: 0, mn: 5000 }).includes(' + ') && !textoComisiones({ usd: 0, mn: 5000 }).startsWith(formatUSD(0)));
  ok('sin nada, cero con el mismo formato que el resto de los montos', textoComisiones({ usd: 0, mn: 0 }) === formatUSD(0));
  ok('acepta formateadores propios (el PDF usa los suyos)', textoComisiones({ usd: 1, mn: 2 }, (n) => `U${n}`, (n) => `M${n}`) === 'U1 + M2');
}

console.log('\n4. cableado: vista y PDF muestran comisiones cobradas, no el valor de lo vendido\n');
{
  const vista = leer('../frontend/js/views/salesView.js');
  ok('la vista calcula los ingresos con las comisiones cobradas (sin canceladas)', vista.includes('textoComisiones(ingresosDeVentas(sales))'));
  ok('la tarjeta "Ingresos totales" muestra ese valor', /<div class="stat-value">\$\{ingresosTxt\}<\/div>\s*<div class="stat-label">Ingresos totales<\/div>/.test(vista));
  ok('el encabezado dice Ingresos, no el total de lo vendido', vista.includes('Ingresos: ${ingresosTxt}') && !vista.includes('Total: ${formatUSD(totalRevenue)}'));
  ok('ya no suma total_amount para los ingresos', !/totalRevenue/.test(vista));
  const pdf = leer('../frontend/js/utils/salesPdfGenerator.js');
  ok('el PDF usa las comisiones cobradas en el resumen y en el pie', (pdf.match(/ingresosDeVentas\(all\)/g) || []).length === 2);
  ok('el PDF ya no suma total_amount para los ingresos', !/totalRevenue/.test(pdf));
  ok('el PDF dice de dónde sale el número', pdf.includes('Ingresos totales (comisiones cobradas)'));
}

console.log('\n5. las ventas canceladas no suman a los ingresos\n');
{
  const ventas = [
    venta(1000, 50, 'USD', 1, 'delivered'),
    venta(1000, 80, 'USD', 1, 'cancelled'),   // cobrada pero cancelada: fuera
    venta(1000, 900, 'MN', 1, 'cancelled'),
    venta(1000, 20, 'USD', 1, 'pending'),     // pendiente de entrega pero cobrada: cuenta
    venta(1000, 5, 'USD', 1, undefined),      // sin estado: cuenta
  ];
  const r = ingresosDeVentas(ventas);
  ok('una venta cancelada con comisión cobrada no suma', r.usd === 75 && r.mn === 0, JSON.stringify(r));
  ok('una venta sin entregar todavía sí cuenta si la comisión se cobró', ingresosDeVentas([venta(1, 20, 'USD', 1, 'pending')]).usd === 20);
  ok('una venta sin estado cuenta', ingresosDeVentas([venta(1, 5, 'USD', 1, undefined)]).usd === 5);
  ok('lista vacía o nula no revienta', ingresosDeVentas([]).usd === 0 && ingresosDeVentas(null).mn === 0);
}

console.log('\n6. el Dashboard (SQL) y Ventas (JS) dan el mismo número\n');
{
  const { db } = await abrirMemoria(`CREATE TABLE sales (
    id INTEGER PRIMARY KEY, total_amount REAL, commission_amount REAL,
    commission_currency TEXT, commission_paid INTEGER, delivery_status TEXT);`);
  const filas = [
    [1000, 50, 'USD', 1, 'delivered'],
    [2000, 3000, 'MN', 1, 'delivered'],
    [9000, 400, 'USD', 0, 'pending'],        // pendiente: no es ingreso
    [500, 80, 'USD', 1, 'cancelled'],        // cancelada: fuera
    [500, 700, 'MN', 1, 'cancelled'],
    [100, 12.5, null, 1, 'pending'],         // sin moneda = USD
    [100, 8, 'USD', 1, null],                // sin estado: cuenta
    [100, 99, 'EUR', 1, 'delivered'],        // moneda desconocida: ni USD ni MN
    [100, null, 'USD', 1, 'delivered'],      // monto vacío: 0
    [100, 6, 'USD', null, 'delivered'],      // paid NULL = pendiente
  ];
  for (const f of filas) db.prepare('INSERT INTO sales (total_amount, commission_amount, commission_currency, commission_paid, delivery_status) VALUES (?, ?, ?, ?, ?)').run(...f);
  const sql = ingresosPorComisiones(db);
  ok('el SQL suma las cobradas no canceladas en USD (50 + 12,5 + 8)', sql.usd === 70.5, JSON.stringify(sql));
  ok('y en MN (3000)', sql.mn === 3000, JSON.stringify(sql));
  const js = ingresosDeVentas(filas.map(([t, c, m, p, e]) => ({ total_amount: t, commission_amount: c, commission_currency: m, commission_paid: p, delivery_status: e })));
  ok('el frontend da exactamente lo mismo sobre las mismas filas', js.usd === sql.usd && js.mn === sql.mn, JSON.stringify({ js, sql }));
  const vacia = (await abrirMemoria(`CREATE TABLE sales (id INTEGER PRIMARY KEY, total_amount REAL, commission_amount REAL, commission_currency TEXT, commission_paid INTEGER, delivery_status TEXT);`)).db;
  const r0 = ingresosPorComisiones(vacia);
  ok('sin ventas: cero en ambas monedas', r0.usd === 0 && r0.mn === 0);
}

console.log('\n7. cableado del Dashboard\n');
{
  const server = leer('../backend/server.js');
  ok('el endpoint agrega los ingresos por comisiones', server.includes('ingresosPorComisiones(db)') && server.includes('stats.income_commissions_usd = ingresos.usd') && server.includes('stats.income_commissions_mn = ingresos.mn'));
  ok('se mantiene total_revenue en la respuesta (compatibilidad)', server.includes('as total_revenue'));
  const dash = leer('../frontend/js/views/dashboardView.js');
  ok('el Dashboard muestra las comisiones cobradas como Ingresos totales', dash.includes('stats.income_commissions_usd') && dash.includes('stats.income_commissions_mn') && dash.includes('<div class="stat-label">Ingresos totales</div>'));
  ok('el Dashboard ya no muestra el valor de lo vendido como ingreso', !dash.includes('stats.total_revenue'));
  ok('un servidor viejo (sin los campos nuevos) no rompe el panel', dash.includes('Number(stats.income_commissions_usd) || 0'));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
