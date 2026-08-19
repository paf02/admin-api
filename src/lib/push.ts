/**
 * Web Push desde el Worker.
 *
 * Implementa lo mínimo del estándar para poder avisar al panel sin depender
 * de una librería de Node: la firma VAPID (RFC 8292) y el cifrado del
 * mensaje (RFC 8291 / 8188). Todo con WebCrypto, que es lo que hay en
 * Workers.
 *
 * El envío nunca lanza hacia afuera: quien llama recibe el estado y decide.
 * Una suscripción muerta se responde con 404 o 410 y se borra; nada de esto
 * puede afectar al pedido que originó el aviso.
 */

export type VapidEnv = {
  /** Clave pública VAPID (punto sin comprimir, base64url). */
  VAPID_PUBLIC_KEY?: string;
  /** Clave privada VAPID (escalar d, base64url). Va como secret. */
  VAPID_PRIVATE_KEY?: string;
  /** Contacto exigido por el estándar: mailto: o https:. */
  VAPID_SUBJECT?: string;
};

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/* ------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------ */

export function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const utf8 = (text: string) => new TextEncoder().encode(text);

/* ------------------------------------------------------------------ *
 * VAPID: JWT firmado con la clave privada del servidor
 * ------------------------------------------------------------------ */

/** La clave privada se guarda como escalar; x e y salen de la pública. */
async function importVapidKey(env: VapidEnv): Promise<CryptoKey> {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY!);

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: env.VAPID_PRIVATE_KEY!,
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function vapidHeader(env: VapidEnv, endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || 'mailto:pedidos@estelapuracr.com',
  };

  const unsigned = `${bytesToB64url(utf8(JSON.stringify(header)))}.${bytesToB64url(
    utf8(JSON.stringify(claims))
  )}`;

  const key = await importVapidKey(env);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(unsigned)
  );

  return `vapid t=${unsigned}.${bytesToB64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* ------------------------------------------------------------------ *
 * Cifrado del mensaje (aes128gcm)
 * ------------------------------------------------------------------ */

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bits
  );
  return new Uint8Array(bytes);
}

async function encryptPayload(sub: PushSubscriptionRecord, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  // Par efímero del servidor para este mensaje
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;

  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256)
  );

  // IKM = HKDF(auth_secret, shared, "WebPush: info" || ua_public || as_public)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 256);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 96);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);

  // 0x02 cierra el único registro del mensaje
  const plaintext = concat(utf8(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext)
  );

  // Cabecera aes128gcm: salt | rs | idlen | clave pública efímera
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);

  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* ------------------------------------------------------------------ *
 * Envío
 * ------------------------------------------------------------------ */

export const canPush = (env: VapidEnv) =>
  Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY);

export type PushResult = {
  endpoint: string;
  ok: boolean;
  status: number;
  /** true cuando el servicio dice que la suscripción ya no existe. */
  gone: boolean;
  error?: string;
};

/** Manda un aviso a una suscripción. Nunca lanza. */
export async function sendPush(
  env: VapidEnv,
  sub: PushSubscriptionRecord,
  payload: string,
  ttlSeconds = 3600
): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, payload);
    const authorization = await vapidHeader(env, sub.endpoint);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);

    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(ttlSeconds),
          Urgency: 'high',
        },
        body,
        signal: abort.signal,
      });

      return {
        endpoint: sub.endpoint,
        ok: res.ok,
        status: res.status,
        gone: res.status === 404 || res.status === 410,
        error: res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 200),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error: any) {
    return {
      endpoint: sub.endpoint,
      ok: false,
      status: 0,
      gone: false,
      error: error?.message?.slice(0, 200),
    };
  }
}
