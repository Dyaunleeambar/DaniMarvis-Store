// Ingresos del negocio = comisiones YA COBRADAS, sin contar ventas canceladas.
//
// El valor de los productos vendidos NO es ingreso: es lo que pagó el cliente, y
// eso va al proveedor. Lo que queda para el negocio es la comisión, y solo cuenta
// como ingreso cuando se cobró (commission_paid). USD y MN se devuelven por
// separado porque no se pueden sumar sin convertir.
//
// Esta es la misma regla que aplica el frontend (ingresosDeVentas en
// frontend/js/utils/utils.js, usada por Ventas y por el PDF). Como son dos
// implementaciones, scripts/test-ingresos-comisiones.mjs verifica que den el mismo
// resultado sobre las mismas filas.
const SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN commission_currency = 'MN' THEN commission_amount ELSE 0 END), 0) AS mn,
    COALESCE(SUM(CASE WHEN commission_currency = 'USD' OR commission_currency IS NULL THEN commission_amount ELSE 0 END), 0) AS usd
  FROM sales
  WHERE COALESCE(commission_paid, 0) != 0
    AND COALESCE(delivery_status, '') != 'cancelled'
`;

/** { usd, mn }: comisiones cobradas de ventas no canceladas. */
export function ingresosPorComisiones(db) {
  const fila = db.prepare(SQL).get() || {};
  return { usd: Number(fila.usd) || 0, mn: Number(fila.mn) || 0 };
}
