import { historyStatement } from './orders';
import { movementStatement, restoreStatement } from './inventory';

/**
 * Caducidad de pedidos SINPE sin verificar.
 *
 * Las existencias se apartan al crear el pedido, antes de comprobar el pago:
 * es lo correcto, porque impide vender dos veces la misma botella mientras se
 * espera la transferencia. El problema es lo que pasa cuando la transferencia
 * nunca llega: sin nada que lo suelte, ese frasco queda reservado para
 * siempre y desaparece de la tienda aunque siga en el estante.
 *
 * Con una o dos unidades por fragancia, unos pocos pedidos abandonados vacían
 * el catálogo en silencio.
 *
 * Reglas deliberadas:
 *
 * - Solo pedidos que la tienda no tocó (`EstadoVenta = 'Pendiente'`). Si
 *   alguien ya lo confirmó o lo puso a preparar, está al tanto: cancelárselo
 *   por debajo sería peor que dejarlo abierto.
 * - Solo SINPE sin verificar. El efectivo contra entrega se paga al recibir,
 *   así que «sin pagar» es su estado normal, no un abandono.
 * - Las existencias se devuelven por el mismo camino que la cancelación
 *   manual, con la guarda `StockDevuelto` para no devolverlas dos veces.
 */

/** Horas de gracia antes de soltar las existencias. */
export const SINPE_EXPIRY_HOURS = 24;

/** Tope por corrida: si algo sale mal, que no arrase con todo de una vez. */
const MAX_PER_RUN = 50;

type Expirable = {
  VentaID: number;
  NumeroPedido: string | null;
};

export async function expireUnverifiedSinpe(
  db: D1Database,
  hours: number = SINPE_EXPIRY_HOURS
): Promise<{ revisados: number; cancelados: number; errores: number }> {
  const { results: vencidos } = await db
    .prepare(
      `SELECT VentaID, NumeroPedido
         FROM Ventas
        WHERE MetodoPago   = 'SINPE Móvil'
          AND EstadoPago   = 'Verificación requerida'
          AND EstadoVenta  = 'Pendiente'
          AND StockDevuelto = 0
          AND Fecha <= datetime('now', 'localtime', ?)
        ORDER BY VentaID
        LIMIT ?`
    )
    .bind(`-${hours} hours`, MAX_PER_RUN)
    .all<Expirable>();

  let cancelados = 0;
  let errores = 0;

  for (const venta of vencidos) {
    try {
      // El stock actual de cada línea, para dejar el antes y el después en el
      // historial igual que en una cancelación manual.
      const { results: detalles } = await db
        .prepare(
          `SELECT d.ProductoID, d.Cantidad, p.Stock
             FROM DetalleVenta d
             LEFT JOIN Productos p ON p.ProductoID = d.ProductoID
            WHERE d.VentaID = ?`
        )
        .bind(venta.VentaID)
        .all<{ ProductoID: number; Cantidad: number; Stock: number }>();

      const numero = venta.NumeroPedido ?? `#${venta.VentaID}`;

      // `StockDevuelto = 0` en el UPDATE es la guarda: si alguien canceló el
      // pedido entre la consulta y esta escritura, esto no aplica y el stock
      // no se devuelve dos veces.
      const statements = [
        db
          .prepare(
            `UPDATE Ventas
                SET EstadoVenta = 'Cancelado', StockDevuelto = 1
              WHERE VentaID = ? AND StockDevuelto = 0 AND EstadoVenta = 'Pendiente'`
          )
          .bind(venta.VentaID),
        ...detalles.flatMap((d) => {
          const anterior = Number(d.Stock) || 0;
          return [
            restoreStatement(db, d.ProductoID, d.Cantidad),
            movementStatement(db, {
              productoId: d.ProductoID,
              anterior,
              cambio: d.Cantidad,
              nuevo: anterior + d.Cantidad,
              motivo: 'Pedido cancelado',
              nota: `${numero} — SINPE sin verificar tras ${hours} h`,
              ventaId: venta.VentaID,
              usuario: 'sistema',
            }),
          ];
        }),
        historyStatement(
          db,
          venta.VentaID,
          'Cancelado',
          `Cancelado automáticamente: SINPE sin verificar tras ${hours} h`,
          'sistema'
        ),
      ];

      await db.batch(statements);
      cancelados += 1;
    } catch (error: any) {
      // Un pedido que falla no debe detener a los demás.
      console.error('expire.venta', venta.VentaID, error?.message);
      errores += 1;
    }
  }

  return { revisados: vencidos.length, cancelados, errores };
}
