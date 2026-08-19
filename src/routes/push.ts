import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { canPush, sendPush, type PushSubscriptionRecord, type VapidEnv } from '../lib/push';

type Bindings = { DB: D1Database } & VapidEnv;

export const pushRouter = new Hono<{ Bindings: Bindings }>();

/** Todo lo de avisos internos es del panel: nada de esto es público. */
const admin = [authMiddleware, adminMiddleware] as const;

const usuarioDe = (c: any) => c.get('user')?.username ?? null;

/**
 * Clave pública VAPID.
 *
 * El navegador la necesita para suscribirse. Es pública por definición, pero
 * igual va detrás de la sesión: solo el panel se suscribe a avisos internos.
 */
pushRouter.get('/clave', ...admin, (c) =>
  c.json({
    success: true,
    data: {
      publicKey: c.env.VAPID_PUBLIC_KEY ?? null,
      configurado: canPush(c.env),
    },
  })
);

/** Suscripciones activas de quien consulta, para mostrar cuántos dispositivos hay. */
pushRouter.get('/suscripciones', ...admin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT SuscripcionID, Dispositivo, CreadoEn, UltimoEnvio, Fallos
         FROM PushSuscripciones WHERE Usuario = ? ORDER BY SuscripcionID DESC`
    ).bind(usuarioDe(c)).all();

    return c.json({ success: true, data: results });
  } catch (error: any) {
    console.error('push.list', error?.message);
    return c.json({ success: false, message: 'No se pudieron cargar los dispositivos' }, 500);
  }
});

/**
 * Registra el dispositivo.
 *
 * El endpoint es la identidad del aparato: si ya existe, se actualizan las
 * claves y se reinicia el contador de fallos en vez de crear otra fila.
 */
pushRouter.post('/suscripciones', ...admin, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const endpoint = String(body?.endpoint ?? '').trim();
  const p256dh = String(body?.keys?.p256dh ?? '').trim();
  const auth = String(body?.keys?.auth ?? '').trim();
  const dispositivo = body?.dispositivo ? String(body.dispositivo).slice(0, 60) : null;

  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return c.json({ success: false, message: 'Suscripción incompleta' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO PushSuscripciones (Endpoint, P256dh, Auth, Usuario, Dispositivo)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(Endpoint) DO UPDATE SET
         P256dh = excluded.P256dh,
         Auth = excluded.Auth,
         Usuario = excluded.Usuario,
         Dispositivo = COALESCE(excluded.Dispositivo, PushSuscripciones.Dispositivo),
         Fallos = 0`
    ).bind(endpoint, p256dh, auth, usuarioDe(c), dispositivo).run();

    return c.json({ success: true, message: 'Dispositivo registrado' });
  } catch (error: any) {
    console.error('push.subscribe', error?.message);
    return c.json({ success: false, message: 'No se pudo registrar el dispositivo' }, 500);
  }
});

/** Baja del dispositivo. Se identifica por su endpoint, no por usuario. */
pushRouter.delete('/suscripciones', ...admin, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const endpoint = String(body?.endpoint ?? '').trim();
  if (!endpoint) return c.json({ success: false, message: 'Falta el endpoint' }, 400);

  try {
    await c.env.DB.prepare(`DELETE FROM PushSuscripciones WHERE Endpoint = ?`)
      .bind(endpoint)
      .run();
    return c.json({ success: true, message: 'Dispositivo dado de baja' });
  } catch (error: any) {
    console.error('push.unsubscribe', error?.message);
    return c.json({ success: false, message: 'No se pudo dar de baja el dispositivo' }, 500);
  }
});

/**
 * Aviso de prueba a los dispositivos de quien lo pide.
 *
 * Sirve para verificar el permiso, la suscripción y el clic sin tener que
 * crear un pedido de mentira en la base.
 */
pushRouter.post('/prueba', ...admin, async (c) => {
  if (!canPush(c.env)) {
    return c.json({ success: false, message: 'Faltan las claves VAPID en el servidor' }, 503);
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT Endpoint, P256dh, Auth FROM PushSuscripciones WHERE Usuario = ?`
    ).bind(usuarioDe(c)).all();

    if (!results.length) {
      return c.json({ success: false, message: 'Este usuario no tiene dispositivos suscritos' }, 404);
    }

    const payload = JSON.stringify({
      tipo: 'prueba',
      titulo: 'Prueba de aviso',
      cuerpo: 'Si ves esto, los avisos de pedidos están funcionando.',
      url: '/pedidos',
    });

    const enviados = await Promise.all(
      (results as any[]).map((row) =>
        sendPush(c.env, { endpoint: row.Endpoint, p256dh: row.P256dh, auth: row.Auth }, payload)
      )
    );

    // Una suscripción muerta se limpia en el momento
    const gone = enviados.filter((r) => r.gone).map((r) => r.endpoint);
    if (gone.length) {
      await c.env.DB.batch(
        gone.map((endpoint) =>
          c.env.DB.prepare(`DELETE FROM PushSuscripciones WHERE Endpoint = ?`).bind(endpoint)
        )
      );
    }

    const ok = enviados.filter((r) => r.ok).length;
    enviados.filter((r) => !r.ok).forEach((r) => console.error('push.test.failed', r.status, r.error));

    return c.json({
      success: ok > 0,
      message: ok > 0 ? `Aviso enviado a ${ok} dispositivo(s)` : 'Ningún dispositivo recibió el aviso',
      data: { enviados: ok, dadosDeBaja: gone.length },
    });
  } catch (error: any) {
    console.error('push.test', error?.message);
    return c.json({ success: false, message: 'No se pudo enviar el aviso de prueba' }, 500);
  }
});
