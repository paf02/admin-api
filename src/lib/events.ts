/**
 * Eventos de dominio.
 *
 * Hoy solo se registran; el objetivo es que el día que exista un proveedor de
 * notificaciones (WhatsApp Business API u otro), conectarlo sea implementar
 * `deliver()` y no tocar la ruta de pedidos.
 *
 * El payload lleva únicamente lo que hace falta para avisar «entró un pedido».
 * Nada de dirección, correo ni detalle de productos: una notificación no es el
 * lugar para datos personales, y quien la reciba puede abrir el pedido en el
 * panel para ver el resto.
 */

export type OrderCreatedEvent = {
  type: 'order.created';
  occurredAt: string;
  data: {
    orderNumber: string;
    customerName: string;
    total: number;
    paymentMethod: string;
    itemCount: number;
  };
};

export function buildOrderCreated(data: OrderCreatedEvent['data']): OrderCreatedEvent {
  return {
    type: 'order.created',
    occurredAt: new Date().toISOString(),
    data,
  };
}

/**
 * Publica el evento.
 *
 * Sin proveedor configurado esto queda en el log del Worker (`wrangler tail`),
 * que ya sirve para verificar que el evento se dispara cuando debe.
 *
 * Importante: nunca lanza. Un fallo avisando no puede tumbar un pedido que el
 * cliente ya pagó o confirmó.
 */
export async function publish(event: OrderCreatedEvent): Promise<void> {
  try {
    console.log(JSON.stringify(event));
    // Próximo paso: await deliver(event) contra el proveedor oficial.
  } catch {
    // Silencio deliberado: el pedido ya se creó y eso es lo que importa.
  }
}
