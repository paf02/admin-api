import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { buildDraftCreated, publishDraft, type NotifyEnv } from '../lib/events';
import { leerMensaje, respuestaPara, type ProductoCatalogo } from '../lib/intake';
import {
  canSend,
  markAsRead,
  sendText,
  verifySignature,
  whatsappConfig,
  type WhatsAppEnv,
} from '../lib/whatsapp';

type Bindings = { DB: D1Database } & WhatsAppEnv & NotifyEnv;

export const whatsappRouter = new Hono<{ Bindings: Bindings }>();

const admin = [authMiddleware, adminMiddleware] as const;
const usuarioDe = (c: any) => c.get('user')?.username ?? null;

/* ------------------------------------------------------------------ *
 * Webhook
 * ------------------------------------------------------------------ */

/**
 * Alta del webhook.
 *
 * Meta llama una vez con un token y espera que le devuelvan el desafío tal
 * cual. Es público a propósito —así lo exige la plataforma— y lo único que
 * lo protege es que el token coincida.
 */
whatsappRouter.get('/webhook', (c) => {
  const { verifyToken } = whatsappConfig(c.env);
  const modo = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const desafio = c.req.query('hub.challenge') ?? '';

  if (!verifyToken) {
    console.error('whatsapp.webhook.sin-verify-token');
    return c.text('Webhook sin configurar', 503);
  }

  if (modo === 'subscribe' && token === verifyToken) {
    return c.text(desafio, 200);
  }

  // Abrir esta dirección en el navegador no lleva los parámetros de Meta, y
  // un «verificación fallida» seco hace pensar que algo está roto. Si no vino
  // ningún parámetro es una visita humana: se le explica qué es esto.
  if (!modo && !token) {
    return c.text(
      [
        'Webhook de WhatsApp de Estela Pura.',
        '',
        'Esta dirección no es para abrirla a mano: la llama Meta con sus propios',
        'parámetros (hub.mode, hub.verify_token y hub.challenge) al dar de alta el',
        'webhook, y después le manda acá los mensajes que reciba el número.',
        '',
        'Si ves esto, el endpoint está en pie y respondiendo.',
      ].join('\n'),
      200
    );
  }

  // Con parámetros pero token equivocado: esto sí es un fallo de verificación
  console.warn('whatsapp.webhook.verificacion-fallida');
  return c.text('Verificación fallida', 403);
});

/**
 * Mensajes entrantes.
 *
 * Se responde 200 de inmediato y el trabajo real ocurre después: si Meta no
 * recibe respuesta rápida reintenta, y cada reintento sería otro borrador.
 * El ID del mensaje, que es único, es lo que garantiza que un reintento no
 * duplique nada.
 */
whatsappRouter.post('/webhook', async (c) => {
  const crudo = await c.req.text();
  const firma = await verifySignature(c.env, crudo, c.req.header('x-hub-signature-256') ?? null);

  // La URL del webhook es pública: la firma es lo único que distingue a Meta
  // de cualquiera que la descubra. Por eso se exige por defecto, y sin
  // secreto configurado no se procesa nada.
  if (firma === 'invalida' || firma === 'sin-firma') {
    console.error('whatsapp.webhook.firma', firma);
    return c.text('Firma inválida', 401);
  }
  if (firma === 'sin-secreto' && c.env.WHATSAPP_ALLOW_UNSIGNED !== '1') {
    console.error('whatsapp.webhook.sin-secreto');
    return c.text('Webhook sin configurar', 503);
  }

  let cuerpo: any;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return c.text('EVENT_RECEIVED', 200);
  }

  const trabajo = procesarEntrada(c.env, cuerpo).catch((error: any) =>
    console.error('whatsapp.webhook.error', error?.message)
  );

  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(trabajo);
  else await trabajo;

  return c.text('EVENT_RECEIVED', 200);
});

/** Mensajes de texto que trae el webhook, ya aplanados. */
function mensajesDe(cuerpo: any) {
  const salida: { id: string; from: string; texto: string; nombre: string | null }[] = [];

  for (const entrada of cuerpo?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      const valor = cambio?.value;
      const perfiles = new Map<string, string>(
        (valor?.contacts ?? []).map((c: any) => [c?.wa_id, c?.profile?.name])
      );

      for (const mensaje of valor?.messages ?? []) {
        // Audio, imagen o ubicación se registran, pero no se interpretan
        const texto = mensaje?.text?.body ?? '';
        salida.push({
          id: mensaje?.id,
          from: mensaje?.from,
          texto,
          nombre: perfiles.get(mensaje?.from) ?? null,
        });
      }
    }
  }

  return salida.filter((m) => m.id && m.from);
}

async function procesarEntrada(env: Bindings, cuerpo: any) {
  const mensajes = mensajesDe(cuerpo);
  if (!mensajes.length) return; // estados de entrega y otros eventos

  const { results: catalogo } = await env.DB.prepare(
    `SELECT p.ProductoID, p.Nombre, p.PrecioVenta, p.Stock,
            m.Nombre AS MarcaNombre, c.Nombre AS CategoriaNombre
       FROM Productos p
       LEFT JOIN Marcas m     ON m.MarcaID = p.MarcaID
       LEFT JOIN Categorias c ON c.CategoriaID = p.CategoriaID
      WHERE p.Estado = 1`
  ).all();

  for (const mensaje of mensajes) {
    // Reintento de Meta: el mismo ID no se procesa dos veces
    const visto = await env.DB.prepare(`SELECT MensajeID FROM WhatsAppMensajes WHERE MensajeID = ?`)
      .bind(mensaje.id)
      .first();
    if (visto) {
      console.log('whatsapp.webhook.repetido', mensaje.id);
      continue;
    }

    const borrador = leerMensaje(mensaje.texto, catalogo as unknown as ProductoCatalogo[]);
    let borradorId: number | null = null;

    // Un saludo no genera borrador: solo se contesta
    if (borrador.lineas.length || borrador.intencion === 'compra' || borrador.intencion === 'consulta') {
      const insert = await env.DB.prepare(
        `INSERT INTO PedidosBorrador
           (Canal, Telefono, NombreContacto, MensajeOriginal, Intencion, Lineas, Total, NoReconocido)
         VALUES ('whatsapp', ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          mensaje.from,
          mensaje.nombre,
          mensaje.texto,
          borrador.intencion,
          JSON.stringify(borrador.lineas),
          borrador.total,
          borrador.noReconocido.join(', ') || null
        )
        .run();

      borradorId = Number(insert.meta.last_row_id);
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO WhatsAppMensajes (MensajeID, Telefono, BorradorID) VALUES (?, ?, ?)`
    )
      .bind(mensaje.id, mensaje.from, borradorId)
      .run();

    // Respuesta automática. Confirma lo entendido; no cierra la venta.
    if (canSend(env)) {
      await markAsRead(env, mensaje.id);
      await sendText(env, mensaje.from, respuestaPara(borrador, mensaje.nombre));
    } else {
      console.warn('whatsapp.sin-credenciales: no se respondió a', mensaje.from);
    }

    if (borradorId) {
      await publishDraft(
        buildDraftCreated({
          draftId: borradorId,
          channel: 'whatsapp',
          contactName: mensaje.nombre,
          itemCount: borrador.lineas.reduce((n, l) => n + l.cantidad, 0),
          total: borrador.total,
          intent: borrador.intencion,
        }),
        env
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Borradores (panel)
 * ------------------------------------------------------------------ */

/** Listado. Por defecto solo lo que está sin atender. */
whatsappRouter.get('/borradores', ...admin, async (c) => {
  const estado = c.req.query('estado') || 'Nuevo';
  const limite = Math.min(Number(c.req.query('limit')) || 100, 300);

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM PedidosBorrador
        ${estado === 'todos' ? '' : 'WHERE Estado = ?'}
        ORDER BY BorradorID DESC LIMIT ?`
    )
      .bind(...(estado === 'todos' ? [limite] : [estado, limite]))
      .all();

    return c.json({
      success: true,
      data: (results as any[]).map((fila) => ({ ...fila, Lineas: JSON.parse(fila.Lineas || '[]') })),
    });
  } catch (error: any) {
    console.error('whatsapp.borradores', error?.message);
    return c.json({ success: false, message: 'No se pudieron cargar los borradores' }, 500);
  }
});

/** Contador para la campana del panel. */
whatsappRouter.get('/borradores/resumen', ...admin, async (c) => {
  try {
    const fila = await c.env.DB.prepare(
      `SELECT SUM(CASE WHEN Estado = 'Nuevo' THEN 1 ELSE 0 END) AS Nuevos,
              COUNT(*) AS Total
         FROM PedidosBorrador`
    ).first();
    return c.json({ success: true, data: fila });
  } catch (error: any) {
    console.error('whatsapp.resumen', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el resumen' }, 500);
  }
});

whatsappRouter.get('/borradores/:id', ...admin, async (c) => {
  try {
    const fila: any = await c.env.DB.prepare(`SELECT * FROM PedidosBorrador WHERE BorradorID = ?`)
      .bind(c.req.param('id'))
      .first();

    if (!fila) return c.json({ success: false, message: 'Borrador no encontrado' }, 404);

    return c.json({ success: true, data: { ...fila, Lineas: JSON.parse(fila.Lineas || '[]') } });
  } catch (error: any) {
    console.error('whatsapp.borrador', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el borrador' }, 500);
  }
});

/**
 * Cambia el estado del borrador.
 *
 * «Convertido» se marca desde el panel después de crear el pedido con la ruta
 * de siempre (POST /api/ventas): acá no se crean ventas ni se toca el stock,
 * para que exista una sola forma de generar un pedido.
 */
whatsappRouter.patch('/borradores/:id', ...admin, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const estado = String(body?.estado ?? '');
  const ventaId = body?.ventaId ? Number(body.ventaId) : null;

  if (!['Nuevo', 'Convertido', 'Descartado'].includes(estado)) {
    return c.json({ success: false, message: 'Estado no admitido' }, 400);
  }

  try {
    const resultado = await c.env.DB.prepare(
      `UPDATE PedidosBorrador
          SET Estado = ?, VentaID = COALESCE(?, VentaID), ActualizadoEn = datetime('now','localtime')
        WHERE BorradorID = ?`
    )
      .bind(estado, ventaId, c.req.param('id'))
      .run();

    if (!resultado.meta.changes) {
      return c.json({ success: false, message: 'Borrador no encontrado' }, 404);
    }

    console.log('whatsapp.borrador.estado', c.req.param('id'), estado, usuarioDe(c));
    return c.json({ success: true, message: `Borrador marcado como ${estado.toLowerCase()}` });
  } catch (error: any) {
    console.error('whatsapp.borrador.patch', error?.message);
    return c.json({ success: false, message: 'No se pudo actualizar el borrador' }, 500);
  }
});

/** Estado de la configuración, para ver desde el panel qué falta. */
whatsappRouter.get('/estado', ...admin, (c) => {
  const config = whatsappConfig(c.env);
  return c.json({
    success: true,
    data: {
      numeroConfigurado: Boolean(config.phoneNumberId),
      cuentaConfigurada: Boolean(config.businessAccountId),
      tokenConfigurado: Boolean(config.accessToken),
      verificacionConfigurada: Boolean(config.verifyToken),
      firmaConfigurada: Boolean(config.appSecret),
      puedeResponder: canSend(c.env),
      api: `${config.apiBase}/${config.version}`,
    },
  });
});
