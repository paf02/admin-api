/**
 * Eventos de dominio y aviso al administrador.
 *
 * Cuando entra un pedido, la tienda necesita enterarse en el teléfono. El
 * evento se publica siempre (queda en el log del Worker) y, si están
 * configuradas las credenciales de WhatsApp Business, además se manda el
 * aviso al número del administrador.
 *
 * Reglas que no se negocian:
 * - `publish()` nunca lanza. Un aviso que falla no puede tumbar un pedido ya
 *   registrado: el pedido vive en la base y el panel es la fuente de verdad.
 * - El aviso va HACIA el administrador. El cliente nunca manda nada por
 *   WhatsApp: su pedido se completa y se registra en el sitio.
 * - No viajan datos de más: ni dirección, ni correo, ni teléfono del cliente.
 *   Quien reciba el aviso abre el pedido en el panel para ver el resto.
 */

import { canPush, sendPush, type VapidEnv } from './push';

export type NotifyEnv = VapidEnv & {
  /** Base de datos: de acá salen los dispositivos suscritos al panel. */
  DB?: D1Database;
  /** Token permanente de la app de WhatsApp Business (secret). */
  WHATSAPP_TOKEN?: string;
  /** ID del número emisor en la plataforma de WhatsApp. */
  WHATSAPP_PHONE_ID?: string;
  /** Número del administrador que recibe el aviso, en formato internacional. */
  ADMIN_WHATSAPP?: string;
  /** Base del enlace al pedido en el panel, por ejemplo https://…/pedidos/ */
  ADMIN_ORDER_URL?: string;
  /** Plantilla aprobada, si se usa fuera de la ventana de 24 horas. */
  WHATSAPP_TEMPLATE?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
};

export type DraftCreatedEvent = {
  type: 'draft.created';
  occurredAt: string;
  data: {
    draftId: number;
    channel: string;
    contactName: string | null;
    itemCount: number;
    total: number;
    intent: string;
  };
};

export type OrderCreatedEvent = {
  type: 'order.created';
  occurredAt: string;
  data: {
    orderId: number;
    orderNumber: string;
    customerName: string;
    total: number;
    paymentMethod: string;
    paymentStatus: string;
    itemCount: number;
    items: { name: string; quantity: number }[];
  };
};

export function buildOrderCreated(data: OrderCreatedEvent['data']): OrderCreatedEvent {
  return {
    type: 'order.created',
    occurredAt: new Date().toISOString(),
    data,
  };
}

export function buildDraftCreated(data: DraftCreatedEvent['data']): DraftCreatedEvent {
  return { type: 'draft.created', occurredAt: new Date().toISOString(), data };
}

const colones = (monto: number) => `₡${Math.round(monto).toLocaleString('es-CR')}`;

/** Texto del aviso. El mismo contenido que vería alguien abriendo el panel. */
export function notificationText(event: OrderCreatedEvent, env: NotifyEnv): string {
  const d = event.data;

  const lines = [
    '🔔 Nuevo pedido',
    '',
    `Pedido ${d.orderNumber}`,
    '',
    'Cliente:',
    d.customerName,
    '',
    'Productos:',
    ...d.items.map((item) => `${item.quantity} × ${item.name}`),
    '',
    'Pago:',
    `${d.paymentMethod} · ${d.paymentStatus}`,
    '',
    'Total:',
    colones(d.total),
  ];

  if (env.ADMIN_ORDER_URL) {
    lines.push('', 'Ver pedido:', `${env.ADMIN_ORDER_URL.replace(/\/$/, '')}/${d.orderId}`);
  }

  return lines.join('\n');
}

/** true cuando hay con qué mandar el aviso por WhatsApp. Sin credenciales solo se registra. */
export const canNotify = (env: NotifyEnv) =>
  Boolean(env?.WHATSAPP_TOKEN && env?.WHATSAPP_PHONE_ID && env?.ADMIN_WHATSAPP);

/**
 * Aviso al panel por Web Push.
 *
 * Va a todos los dispositivos suscritos —teléfono y computadora pueden estar
 * los dos— y lleva solo lo necesario para reconocer el pedido: número, total
 * y cuántos artículos. Ni nombre, ni teléfono, ni dirección: eso se ve
 * abriendo el pedido, que exige sesión.
 *
 * Las suscripciones que el servicio da por muertas (404/410) se borran en el
 * momento, así la lista no acumula dispositivos que ya no existen.
 */
async function deliverPush(
  env: NotifyEnv,
  payload: string,
  referencia: string
): Promise<void> {
  if (!env.DB || !canPush(env)) return;

  const { results } = await env.DB.prepare(
    `SELECT Endpoint, P256dh, Auth FROM PushSuscripciones`
  ).all();

  if (!results.length) return;

  const enviados = await Promise.all(
    (results as any[]).map((row) =>
      sendPush(env, { endpoint: row.Endpoint, p256dh: row.P256dh, auth: row.Auth }, payload)
    )
  );

  const statements = [];
  for (const envio of enviados) {
    if (envio.gone) {
      statements.push(
        env.DB.prepare(`DELETE FROM PushSuscripciones WHERE Endpoint = ?`).bind(envio.endpoint)
      );
      continue;
    }

    if (envio.ok) {
      statements.push(
        env.DB.prepare(
          `UPDATE PushSuscripciones
              SET UltimoEnvio = datetime('now', 'localtime'), Fallos = 0
            WHERE Endpoint = ?`
        ).bind(envio.endpoint)
      );
    } else {
      console.error('push.failed', referencia, envio.status, envio.error);
      statements.push(
        env.DB.prepare(
          `UPDATE PushSuscripciones SET Fallos = Fallos + 1 WHERE Endpoint = ?`
        ).bind(envio.endpoint)
      );
    }
  }

  if (statements.length) await env.DB.batch(statements);
}

/**
 * Entrega el aviso por la plataforma de WhatsApp Business.
 *
 * Con `WHATSAPP_TEMPLATE` configurado manda la plantilla aprobada (necesaria
 * cuando el negocio escribe primero fuera de la ventana de 24 horas); sin
 * ella manda texto libre, que sirve mientras la ventana esté abierta.
 */
async function deliver(event: OrderCreatedEvent, env: NotifyEnv): Promise<void> {
  const d = event.data;
  const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`;

  const body = env.WHATSAPP_TEMPLATE
    ? {
        messaging_product: 'whatsapp',
        to: env.ADMIN_WHATSAPP,
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || 'es' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: d.orderNumber },
                { type: 'text', text: d.customerName },
                { type: 'text', text: colones(d.total) },
                { type: 'text', text: d.paymentMethod },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: env.ADMIN_WHATSAPP,
        type: 'text',
        text: { preview_url: false, body: notificationText(event, env) },
      };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (!res.ok) {
      // Se registra aparte: el pedido está bien, lo que falló es el aviso
      const detail = await res.text().catch(() => '');
      console.error('notify.failed', d.orderNumber, res.status, detail.slice(0, 300));
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publica el evento y, si se puede, avisa al administrador.
 *
 * Nunca lanza y nunca revierte nada: si el aviso falla, el pedido sigue
 * creado, con sus existencias descontadas y visible en el panel.
 */
export async function publish(event: OrderCreatedEvent, env?: NotifyEnv): Promise<void> {
  console.log(JSON.stringify(event));
  if (!env) return;

  const d = event.data;
  const payload = JSON.stringify({
    tipo: 'order.created',
    numero: d.orderNumber,
    ventaId: d.orderId,
    total: d.total,
    articulos: d.itemCount,
    url: `/pedidos/${d.orderId}`,
  });

  // Cada canal falla por su cuenta: que no ande WhatsApp no puede dejar sin
  // aviso al panel, y que falle un push no puede tumbar nada.
  const canales: Promise<void>[] = [];

  if (canNotify(env)) {
    canales.push(
      deliver(event, env).catch((error: any) =>
        console.error('notify.error', d.orderNumber, error?.message)
      )
    );
  }

  canales.push(
    deliverPush(env, payload, d.orderNumber).catch((error: any) =>
      console.error('push.error', d.orderNumber, error?.message)
    )
  );

  await Promise.allSettled(canales);
}

/**
 * Aviso de borrador entrante por WhatsApp.
 *
 * Va solo al panel: un borrador no es una venta y no tiene sentido avisarlo
 * por WhatsApp a quien justamente está en WhatsApp. Igual que el de pedidos,
 * nunca lanza.
 */
export async function publishDraft(event: DraftCreatedEvent, env?: NotifyEnv): Promise<void> {
  console.log(JSON.stringify(event));
  if (!env) return;

  const d = event.data;
  const quien = d.contactName ? ` de ${d.contactName}` : '';
  const cuerpo =
    d.itemCount > 0
      ? `${d.itemCount} ${d.itemCount === 1 ? 'producto' : 'productos'} · ${colones(d.total)}`
      : 'Mensaje sin productos reconocidos';

  const payload = JSON.stringify({
    tipo: 'draft.created',
    titulo: `Pedido por WhatsApp${quien}`,
    cuerpo,
    url: `/whatsapp/${d.draftId}`,
  });

  await deliverPush(env, payload, `borrador-${d.draftId}`).catch((error: any) =>
    console.error('push.error', `borrador-${d.draftId}`, error?.message)
  );
}
