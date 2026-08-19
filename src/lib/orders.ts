/**
 * Reglas de pedidos compartidas por las rutas.
 *
 * Los valores de estado son los mismos que ya usa la tienda pública
 * (estelapuracr-pwa/src/lib/orders.js). No se inventa un vocabulario nuevo:
 * si acá dice 'Enviado', allá dice 'Enviado'.
 */

export const ORDER_STATUS = [
  'Pendiente',
  'Confirmado',
  'Preparando',
  'Listo',
  'Enviado',
  'Entregado',
  'Cancelado',
] as const;

export type OrderStatus = (typeof ORDER_STATUS)[number];

export const PAYMENT_STATUS = [
  'Pendiente de pago',
  'Verificación requerida',
  'Pagado',
  'Fallido',
  'Reembolsado',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

/** La tienda cobra únicamente así. No hay pasarela ni tarjetas. */
export const PAYMENT_METHODS = ['SINPE Móvil', 'Efectivo contra entrega'] as const;

/**
 * SINPE queda esperando que alguien confirme la transferencia; el efectivo
 * queda pendiente hasta la entrega. Ningún método se marca pagado solo.
 */
export function initialPaymentStatus(metodoPago: string): PaymentStatus {
  return metodoPago === 'SINPE Móvil' ? 'Verificación requerida' : 'Pendiente de pago';
}

/** EP-000123. Mismo formato que ve el cliente en su confirmación. */
export function orderNumberFrom(ventaId: number): string {
  return `EP-${String(ventaId).padStart(6, '0')}`;
}

/**
 * Transiciones permitidas.
 *
 * Un pedido entregado o cancelado es terminal: no se reabre desde el panel,
 * porque eso volvería ambiguo si el stock ya se devolvió o no.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Pendiente: ['Confirmado', 'Preparando', 'Cancelado'],
  Confirmado: ['Preparando', 'Listo', 'Cancelado'],
  Preparando: ['Listo', 'Cancelado'],
  Listo: ['Enviado', 'Entregado', 'Cancelado'],
  Enviado: ['Entregado', 'Cancelado'],
  Entregado: [],
  Cancelado: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as OrderStatus];
  return Array.isArray(allowed) && allowed.includes(to as OrderStatus);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return ORDER_STATUS.includes(value as OrderStatus);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return PAYMENT_STATUS.includes(value as PaymentStatus);
}

/** Una línea de la bitácora. Se agrega, nunca se edita ni se borra. */
export function historyStatement(
  db: D1Database,
  ventaId: number,
  accion: string,
  detalle: string | null,
  usuario: string | null
) {
  return db
    .prepare(
      `INSERT INTO VentaHistorial (VentaID, Accion, Detalle, Usuario) VALUES (?, ?, ?, ?)`
    )
    .bind(ventaId, accion, detalle, usuario);
}
