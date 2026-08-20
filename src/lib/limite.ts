/**
 * Límite de peticiones por IP.
 *
 * Crear un pedido es público —tiene que serlo, el cliente compra sin cuenta—
 * y cada pedido descuenta existencias y manda un correo. Sin un tope, un
 * script deja el inventario en cero en un minuto y, como el SINPE sin
 * verificar aguanta 24 horas, esas existencias no vuelven a la tienda hasta
 * el día siguiente. Lo mismo para las claves: sin tope, probar contraseñas
 * sale gratis.
 *
 * El conteo lo lleva Cloudflare con el binding `ratelimit`, no la base: no
 * cuesta una escritura por visita y no hay tabla que limpiar.
 *
 * FALLA ABIERTO A PROPÓSITO. Si el binding no está configurado —el entorno
 * de PuraTech, una prueba local— o el limitador tira un error, la petición
 * pasa. Una venta perdida por un fallo del limitador es peor que una venta
 * de más: el tope existe para frenar un abuso, no para ser la puerta.
 */

/** Lo que expone el binding; se declara acá para no atarse a sus tipos. */
export type Limitador = {
  limit(opciones: { key: string }): Promise<{ success: boolean }>;
};

export type LimitesEnv = {
  /** Pedidos nuevos desde la tienda. */
  LIMITE_PEDIDOS?: Limitador;
  /** Intentos de entrar, tanto al panel como a una cuenta de cliente. */
  LIMITE_CLAVES?: Limitador;
};

/**
 * IP de quien pide. Cloudflare la pone en cada petición que entra; en local
 * no existe y todas las peticiones caen en la misma cubeta, que para una
 * prueba es justo lo que se quiere.
 */
export function ipDe(c: { req: { header(nombre: string): string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'sin-ip';
}

/**
 * `true` si la petición cabe dentro del tope.
 *
 * La clave define qué se cuenta junto: pasar `pedidos:<ip>` cuenta los
 * pedidos de esa IP sin mezclarlos con los intentos de clave.
 */
export async function dentroDelLimite(limitador: Limitador | undefined, clave: string): Promise<boolean> {
  if (!limitador) return true;

  try {
    const { success } = await limitador.limit({ key: clave });
    return success;
  } catch (error: any) {
    console.error('limite.error', clave, error?.message);
    return true;
  }
}
