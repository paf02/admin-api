import { canSend, sendTemplate, sendText, type WhatsAppEnv } from './whatsapp';

/**
 * Avisos al cliente por WhatsApp.
 *
 * Hoy el cliente compra y no vuelve a saber nada hasta que alguien de la
 * tienda le escribe a mano; de ahí salen casi todos los «¿ya salió mi
 * pedido?». Esto avisa solo cuando algo cambia de verdad para él.
 *
 * El envío lo hace `lib/whatsapp.ts` —el mismo que usa el resto del Worker—
 * así que credenciales, tiempos de espera y reintentos viven en un solo
 * lugar y esto se limita a decidir qué decir y cuándo.
 *
 * LO IMPORTANTE, y es regla de Meta, no del código:
 *
 * WhatsApp Business solo permite texto libre dentro de las 24 horas
 * siguientes a un mensaje DEL CLIENTE. Acá el cliente compra en el sitio y
 * casi nunca escribe primero, así que esa ventana suele estar cerrada y el
 * texto libre se rechaza (error 131047).
 *
 * Por eso cada aviso debería tener su PLANTILLA APROBADA en Meta Business
 * Manager, configurada por variable de entorno. Sin plantilla se intenta
 * igual como texto —sirve si el cliente escribió hace poco— y si falla queda
 * en el log. El pedido nunca se ve afectado.
 */

export type CustomerNotifyEnv = WhatsAppEnv & {
  /** Plantillas aprobadas, una por momento. */
  WA_TPL_PAGO?: string;
  WA_TPL_LISTO?: string;
  WA_TPL_ENVIADO?: string;
  WA_TPL_ENTREGADO?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
  /** Base pública para el enlace de seguimiento. */
  SITE_URL?: string;
};

/**
 * Momentos que ameritan avisar. Pasar de 'Pendiente' a 'Confirmado' o a
 * 'Preparando' es movimiento interno: al cliente no le dice nada y solo
 * gastaría su atención.
 */
export type CustomerEvent = 'pago' | 'listo' | 'enviado' | 'entregado';

const PLANTILLA: Record<CustomerEvent, keyof CustomerNotifyEnv> = {
  pago: 'WA_TPL_PAGO',
  listo: 'WA_TPL_LISTO',
  enviado: 'WA_TPL_ENVIADO',
  entregado: 'WA_TPL_ENTREGADO',
};

const ESTADO_LEGIBLE: Record<CustomerEvent, string> = {
  pago: 'pago confirmado',
  listo: 'listo',
  enviado: 'en camino',
  entregado: 'entregado',
};

/** Texto de respaldo, para cuando la ventana de 24 h sí está abierta. */
const TEXTO: Record<CustomerEvent, (numero: string) => string> = {
  pago: (n) => `Confirmamos tu pago del pedido ${n}. Ya lo estamos preparando.`,
  listo: (n) => `Tu pedido ${n} ya está listo. Te escribimos para coordinar la entrega.`,
  enviado: (n) => `Tu pedido ${n} va en camino.`,
  entregado: (n) => `Tu pedido ${n} fue entregado. ¡Gracias por comprar en Estela Pura!`,
};

/** Los teléfonos se guardan a 8 dígitos; la Cloud API los quiere con país. */
function aInternacional(telefono: string | null | undefined): string | null {
  const digitos = String(telefono ?? '').replace(/\D/g, '');
  if (digitos.length === 8) return `506${digitos}`;
  if (digitos.length > 8 && digitos.length <= 15) return digitos;
  return null;
}

export type PedidoAviso = {
  NumeroPedido: string | null;
  Telefono: string | null;
  Consulta?: string | null;
};

/**
 * Manda el aviso. Nunca lanza: un cambio de estado no puede fallar porque
 * WhatsApp esté caído, y el panel sigue siendo la verdad del pedido.
 */
export async function avisarAlCliente(
  env: CustomerNotifyEnv,
  evento: CustomerEvent,
  pedido: PedidoAviso
): Promise<void> {
  try {
    if (!canSend(env)) return;

    const numero = pedido.NumeroPedido;
    const destino = aInternacional(pedido.Telefono);
    if (!numero || !destino) return;

    const plantilla = env[PLANTILLA[evento]] as string | undefined;

    if (plantilla) {
      // {{1}} número de pedido · {{2}} estado en palabras
      const res = await sendTemplate(
        env,
        destino,
        plantilla,
        env.WHATSAPP_TEMPLATE_LANG || 'es',
        [numero, ESTADO_LEGIBLE[evento]]
      );
      if (!res.ok) console.error('avisoCliente.plantilla', evento, numero, res.status, res.error);
      return;
    }

    // Sin plantilla: solo llega si el cliente escribió en las últimas 24 h.
    const sitio = (env.SITE_URL || 'https://estelapuracr.com').replace(/\/$/, '');
    const enlace = pedido.Consulta ? `${sitio}/pedido/${numero}?c=${pedido.Consulta}` : null;

    const cuerpo = [TEXTO[evento](numero), enlace ? `\n\nSeguilo acá: ${enlace}` : '']
      .filter(Boolean)
      .join('');

    const res = await sendText(env, destino, cuerpo);
    if (!res.ok) {
      // 131047 = fuera de la ventana de 24 h: falta configurar la plantilla
      console.error('avisoCliente.texto', evento, numero, res.status, res.error);
    }
  } catch (error: any) {
    console.error('avisoCliente.error', evento, error?.message);
  }
}
