/**
 * Costo de envío.
 *
 * Las mismas reglas que muestra la tienda
 * (estelapuracr-pwa/src/config/store.js). Se calculan también acá porque el
 * envío es un cobro: si el monto viniera del navegador, un cliente podría
 * mandar 0 y el pedido quedaría registrado sin el envío que sí hay que pagar.
 * El precio de los productos ya se calcula en el servidor por la misma razón.
 *
 * Si se cambian las tarifas, hay que cambiarlas en ambos lados. Es el precio
 * de no compartir un módulo entre el Worker y la tienda; a cambio, ninguno de
 * los dos depende de que el otro esté bien.
 */

const RATES: Record<string, number> = {
  'Entrega personalizada': 2500,
  'Envío a todo el país': 4500,
};

/** Desde este monto de mercadería el envío no se cobra. */
export const FREE_SHIPPING_FROM = 30000;

/**
 * Devuelve el costo para un método y un subtotal.
 *
 * Un método desconocido devuelve null: el pedido se registra con el envío por
 * confirmar en vez de inventar una tarifa o rechazar la compra.
 */
export function shippingFor(metodoEntrega: string | null | undefined, subtotal: number): number | null {
  if (!metodoEntrega) return null;

  const rate = RATES[metodoEntrega.trim()];
  if (rate === undefined) return null;

  return subtotal >= FREE_SHIPPING_FROM ? 0 : rate;
}
