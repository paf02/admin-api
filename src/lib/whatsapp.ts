/**
 * Cliente de la WhatsApp Cloud API.
 *
 * Ningún número de teléfono vive en el código. El número emisor se identifica
 * por `WHATSAPP_PHONE_NUMBER_ID`, que hoy apunta al número de prueba que da
 * Meta y mañana apuntará al número propio de la tienda: cambiar de número es
 * cambiar una variable, no tocar el bot.
 *
 * Nada de lo que hay acá lanza hacia afuera. Un fallo mandando un mensaje no
 * puede tumbar un webhook ni un pedido: se devuelve el resultado y quien
 * llama decide.
 */

export type WhatsAppEnv = {
  /** ID del número emisor en la plataforma (no el número en sí). */
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** Cuenta de WhatsApp Business a la que pertenece ese número. */
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  /** Token de acceso de la app de Meta. Va como secret. */
  WHATSAPP_ACCESS_TOKEN?: string;
  /** Cadena que Meta repite al dar de alta el webhook. */
  WHATSAPP_VERIFY_TOKEN?: string;
  /** Secreto de la app, para validar la firma de cada webhook. */
  WHATSAPP_APP_SECRET?: string;
  /** Base de la API. Se cambia solo para pruebas locales. */
  WHATSAPP_API_BASE?: string;
  WHATSAPP_API_VERSION?: string;
  /**
   * '1' acepta webhooks sin firma. Solo para desarrollo local: en producción
   * dejaría la puerta abierta a que cualquiera invente pedidos.
   */
  WHATSAPP_ALLOW_UNSIGNED?: string;

  /* Nombres anteriores: se siguen aceptando para no romper lo ya desplegado. */
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
};

export type WhatsAppConfig = {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  apiBase: string;
  version: string;
};

export function whatsappConfig(env: WhatsAppEnv): WhatsAppConfig {
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_PHONE_ID || '',
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_TOKEN || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    apiBase: env.WHATSAPP_API_BASE || 'https://graph.facebook.com',
    version: env.WHATSAPP_API_VERSION || 'v21.0',
  };
}

/** true cuando hay con qué hablarle a la Cloud API. */
export const canSend = (env: WhatsAppEnv) => {
  const config = whatsappConfig(env);
  return Boolean(config.phoneNumberId && config.accessToken);
};

export type SendResult = { ok: boolean; status: number; id?: string; error?: string };

async function post(env: WhatsAppEnv, body: unknown): Promise<SendResult> {
  const config = whatsappConfig(env);
  if (!config.phoneNumberId || !config.accessToken) {
    return { ok: false, status: 0, error: 'WhatsApp sin configurar' };
  }

  const url = `${config.apiBase}/${config.version}/${config.phoneNumberId}/messages`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    const texto = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('whatsapp.send.failed', res.status, texto.slice(0, 300));
      return { ok: false, status: res.status, error: texto.slice(0, 300) };
    }

    let id: string | undefined;
    try {
      id = JSON.parse(texto)?.messages?.[0]?.id;
    } catch {
      /* la respuesta no siempre trae cuerpo útil */
    }
    return { ok: true, status: res.status, id };
  } catch (error: any) {
    console.error('whatsapp.send.error', error?.message);
    return { ok: false, status: 0, error: error?.message?.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mensaje de texto a quien escribió. `to` viaja en formato internacional.
 *
 * Si la conexión se cae antes de llegar a Meta (status 0) se reintenta una
 * vez: dejar sin respuesta a alguien que está escribiendo es peor que el
 * riesgo de repetir un mensaje. Un rechazo de Meta —número inválido, ventana
 * de 24 h vencida— no se reintenta, porque volvería a fallar igual.
 */
export async function sendText(env: WhatsAppEnv, to: string, body: string): Promise<SendResult> {
  const mensaje = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };

  const primero = await post(env, mensaje);
  if (primero.ok || primero.status !== 0) return primero;

  await new Promise((listo) => setTimeout(listo, 700));
  return post(env, mensaje);
}

/**
 * Plantilla aprobada. Hace falta cuando el negocio escribe primero fuera de
 * la ventana de 24 horas; dentro de la ventana alcanza con `sendText`.
 */
export const sendTemplate = (
  env: WhatsAppEnv,
  to: string,
  name: string,
  language: string,
  parameters: string[] = []
) =>
  post(env, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      components: parameters.length
        ? [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  });

/** Deja el mensaje como leído: el cliente ve la doble palomita azul. */
export const markAsRead = (env: WhatsAppEnv, messageId: string) =>
  post(env, { messaging_product: 'whatsapp', status: 'read', message_id: messageId });

/* ------------------------------------------------------------------ *
 * Firma del webhook
 * ------------------------------------------------------------------ */

const hexToBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
};

const iguales = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  // Comparación de tiempo constante: no se filtra dónde difieren
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/**
 * Valida `X-Hub-Signature-256` contra el cuerpo crudo.
 *
 * Sin `WHATSAPP_APP_SECRET` configurado no se puede validar; en ese caso se
 * devuelve `'sin-secreto'` y la ruta decide (en producción, rechazar).
 */
export async function verifySignature(
  env: WhatsAppEnv,
  rawBody: string,
  header: string | null
): Promise<'ok' | 'invalida' | 'sin-secreto' | 'sin-firma'> {
  const { appSecret } = whatsappConfig(env);
  if (!appSecret) return 'sin-secreto';
  if (!header?.startsWith('sha256=')) return 'sin-firma';

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const firma = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  );

  return iguales(firma, hexToBytes(header.slice(7))) ? 'ok' : 'invalida';
}
