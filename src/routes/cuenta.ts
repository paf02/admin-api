import { Hono } from 'hono';
import { enviarCorreo, plantillaCodigo } from '../lib/correo';
import {
  correoValido,
  hashCodigo,
  igualSeguro,
  leerTokenCliente,
  normalizarCorreo,
  nuevoCodigo,
  tokenCliente,
} from '../lib/cuentas';

type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;
  RESEND_API_KEY?: string;
  CORREO_REMITENTE?: string;
  CORREO_MODO_PRUEBA?: string;
};

export const cuentaRouter = new Hono<{ Bindings: Bindings }>();

const MINUTOS_CODIGO = 15;
const INTENTOS_POR_CODIGO = 5;
// Pedir código: tres por correo cada cuarto de hora, quince por IP cada hora.
// Alcanza de sobra para quien no recibe el primero y corta a quien lo usaría
// para llenarle el buzón a otra persona.
const TOPE_CORREO = 3;
const TOPE_IP = 15;

const ipDe = (c: any) =>
  c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'desconocida';

/** Sesión de cliente. Nada de esto expone datos de otra persona. */
async function sesion(c: any) {
  const cabecera = c.req.header('Authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) return null;
  return leerTokenCliente(token, c.env.JWT_SECRET);
}

async function conSesion(c: any, next: any) {
  const s = await sesion(c);
  if (!s) return c.json({ success: false, message: 'Entrá a tu cuenta' }, 401);
  c.set('cliente', s);
  await next();
}

const perfilPublico = (fila: any) => ({
  correo: fila.Correo,
  nombre: fila.Nombre || '',
  telefono: fila.Telefono || '',
  provincia: fila.Provincia || '',
  canton: fila.Canton || '',
  distrito: fila.Distrito || '',
  direccion: fila.DireccionExacta || '',
  waze: fila.Waze || '',
});

/* ── Entrar ─────────────────────────────────────────────────────────── */

/**
 * Paso 1: pedir el código.
 *
 * Responde lo mismo exista o no la cuenta. Cualquier correo puede crear una,
 * así que no hay nada que ocultar sobre quién está registrado, pero tampoco
 * hace falta confirmárselo a quien va probando direcciones ajenas.
 */
cuentaRouter.post('/codigo', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = normalizarCorreo(body?.correo);
  if (!correoValido(correo)) {
    return c.json({ success: false, message: 'Escribí un correo válido' }, 400);
  }

  const ip = ipDe(c);

  try {
    const freno: any = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN Correo = ? AND CreadoEn > datetime('now','localtime','-15 minutes') THEN 1 ELSE 0 END) AS PorCorreo,
         SUM(CASE WHEN IP = ?     AND CreadoEn > datetime('now','localtime','-60 minutes') THEN 1 ELSE 0 END) AS PorIP
       FROM ClientesCodigos`
    ).bind(correo, ip).first();

    if ((Number(freno?.PorCorreo) || 0) >= TOPE_CORREO || (Number(freno?.PorIP) || 0) >= TOPE_IP) {
      return c.json(
        { success: false, message: 'Ya pediste varios códigos. Esperá unos minutos y volvé a intentar.' },
        429
      );
    }

    const codigo = nuevoCodigo();

    await c.env.DB.batch([
      // Un código nuevo invalida los anteriores del mismo correo
      c.env.DB.prepare(`UPDATE ClientesCodigos SET Usado = 1 WHERE Correo = ? AND Usado = 0`).bind(correo),
      c.env.DB.prepare(
        `INSERT INTO ClientesCodigos (Correo, CodigoHash, Expira, IP)
         VALUES (?, ?, datetime('now','localtime', ?), ?)`
      ).bind(correo, await hashCodigo(codigo, correo), `+${MINUTOS_CODIGO} minutes`, ip),
      // La tabla no crece para siempre
      c.env.DB.prepare(`DELETE FROM ClientesCodigos WHERE CreadoEn < datetime('now','localtime','-2 days')`),
    ]);

    const { asunto, html, texto } = plantillaCodigo(codigo, MINUTOS_CODIGO);
    const envio = await enviarCorreo(c.env, correo, asunto, html, texto);

    if (!envio.enviado) {
      // Sin correo configurado no se puede entrar: mejor decirlo que dejar a
      // la persona esperando un mensaje que nunca va a llegar. El código se
      // borra para no dejar rastro de un envío que no ocurrió, y para que el
      // freno de tres por cuarto de hora no cuente intentos fallidos.
      await c.env.DB.prepare(
        `DELETE FROM ClientesCodigos WHERE Correo = ? AND Usado = 0`
      ).bind(correo).run();

      return c.json(
        { success: false, message: 'No pudimos enviar el código. Escríbenos y te ayudamos.' },
        503
      );
    }

    return c.json({ success: true, message: `Te enviamos un código a ${correo}` });
  } catch (error: any) {
    console.error('cuenta.codigo', error?.message);
    return c.json({ success: false, message: 'No se pudo enviar el código' }, 500);
  }
});

/** Paso 2: canjear el código por una sesión. Acá nace la cuenta si no existía. */
cuentaRouter.post('/entrar', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = normalizarCorreo(body?.correo);
  const codigo = String(body?.codigo ?? '').replace(/\D/g, '');

  if (!correoValido(correo) || codigo.length !== 6) {
    return c.json({ success: false, message: 'Revisá el correo y el código' }, 400);
  }

  try {
    const fila: any = await c.env.DB.prepare(
      `SELECT CodigoID, CodigoHash, Intentos
         FROM ClientesCodigos
        WHERE Correo = ? AND Usado = 0 AND Expira > datetime('now','localtime')
        ORDER BY CodigoID DESC LIMIT 1`
    ).bind(correo).first();

    if (!fila) {
      return c.json({ success: false, message: 'Ese código venció. Pedí uno nuevo.' }, 401);
    }

    if (Number(fila.Intentos) >= INTENTOS_POR_CODIGO) {
      await c.env.DB.prepare(`UPDATE ClientesCodigos SET Usado = 1 WHERE CodigoID = ?`)
        .bind(fila.CodigoID).run();
      return c.json({ success: false, message: 'Demasiados intentos. Pedí un código nuevo.' }, 429);
    }

    if (!igualSeguro(await hashCodigo(codigo, correo), String(fila.CodigoHash))) {
      await c.env.DB.prepare(`UPDATE ClientesCodigos SET Intentos = Intentos + 1 WHERE CodigoID = ?`)
        .bind(fila.CodigoID).run();
      return c.json({ success: false, message: 'Ese código no es correcto' }, 401);
    }

    await c.env.DB.prepare(`UPDATE ClientesCodigos SET Usado = 1 WHERE CodigoID = ?`)
      .bind(fila.CodigoID).run();

    // La cuenta se crea al primer ingreso. El nombre y el teléfono se toman
    // del último pedido hecho con ese correo, así no hay que escribirlos de
    // nuevo si la persona ya compró antes.
    await c.env.DB.prepare(
      `INSERT INTO Clientes (Correo, Nombre, Telefono)
       SELECT ?, v.Cliente, v.Telefono
         FROM (SELECT ? AS c) x
         LEFT JOIN Ventas v
           ON lower(trim(v.Email)) = ?
          AND v.VentaID = (SELECT MAX(VentaID) FROM Ventas WHERE lower(trim(Email)) = ?)
       ON CONFLICT(Correo) DO NOTHING`
    ).bind(correo, correo, correo, correo).run();

    await c.env.DB.prepare(
      `UPDATE Clientes SET UltimoAcceso = datetime('now','localtime') WHERE Correo = ?`
    ).bind(correo).run();

    const cliente: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE Correo = ?`)
      .bind(correo).first();

    const token = await tokenCliente(Number(cliente.ClienteID), correo, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, perfil: perfilPublico(cliente) } });
  } catch (error: any) {
    console.error('cuenta.entrar', error?.message);
    return c.json({ success: false, message: 'No se pudo entrar' }, 500);
  }
});

/* ── Perfil ─────────────────────────────────────────────────────────── */

cuentaRouter.get('/', conSesion, async (c) => {
  const { clienteId } = c.get('cliente') as any;
  const fila: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE ClienteID = ?`)
    .bind(clienteId).first();
  if (!fila) return c.json({ success: false, message: 'Cuenta no encontrada' }, 404);
  return c.json({ success: true, data: perfilPublico(fila) });
});

/** Datos de entrega. El correo no se cambia acá: es la identidad verificada. */
cuentaRouter.put('/', conSesion, async (c) => {
  const { clienteId } = c.get('cliente') as any;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;
  const telefono = String(body?.telefono ?? '').replace(/[\s-]/g, '');

  if (telefono && !/^(?:\+?506)?[2-8]\d{7}$/.test(telefono)) {
    return c.json({ success: false, message: 'Revisá el número de teléfono' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `UPDATE Clientes
          SET Nombre = ?, Telefono = ?, Provincia = ?, Canton = ?, Distrito = ?,
              DireccionExacta = ?, Waze = ?
        WHERE ClienteID = ?`
    ).bind(
      texto(body?.nombre, 80),
      telefono || null,
      texto(body?.provincia, 40),
      texto(body?.canton, 40),
      texto(body?.distrito, 40),
      texto(body?.direccion, 300),
      texto(body?.waze, 300),
      clienteId
    ).run();

    const fila: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE ClienteID = ?`)
      .bind(clienteId).first();
    return c.json({ success: true, data: perfilPublico(fila) });
  } catch (error: any) {
    console.error('cuenta.guardar', error?.message);
    return c.json({ success: false, message: 'No se pudo guardar' }, 500);
  }
});

/* ── Pedidos ────────────────────────────────────────────────────────── */

/**
 * Los pedidos de quien entró: los que se hicieron con su correo verificado.
 *
 * No se devuelve dirección ni teléfono. La persona ya los conoce, y no
 * mostrarlos deja el listado inofensivo si alguien más agarra el teléfono.
 */
cuentaRouter.get('/pedidos', conSesion, async (c) => {
  const { correo } = c.get('cliente') as any;

  try {
    const { results }: any = await c.env.DB.prepare(
      `SELECT NumeroPedido, Fecha, EstadoVenta, EstadoPago, MetodoEntrega, MetodoPago,
              Total, CostoEnvio, EnvioPorConfirmar, Consulta
         FROM Ventas
        WHERE lower(trim(Email)) = ?
        ORDER BY VentaID DESC
        LIMIT 50`
    ).bind(correo).all();

    return c.json({ success: true, data: results || [] });
  } catch (error: any) {
    console.error('cuenta.pedidos', error?.message);
    return c.json({ success: false, message: 'No se pudieron cargar tus pedidos' }, 500);
  }
});

/** Un pedido con sus líneas, para verlo y para «volver a pedir». */
cuentaRouter.get('/pedidos/:numero', conSesion, async (c) => {
  const { correo } = c.get('cliente') as any;
  const numero = c.req.param('numero');

  try {
    const venta: any = await c.env.DB.prepare(
      `SELECT VentaID, NumeroPedido, Fecha, EstadoVenta, EstadoPago, MetodoEntrega, MetodoPago,
              Total, CostoEnvio, EnvioPorConfirmar, Descuento, Observacion, Consulta
         FROM Ventas
        WHERE NumeroPedido = ? AND lower(trim(Email)) = ?`
    ).bind(numero, correo).first();

    if (!venta) return c.json({ success: false, message: 'No encontramos ese pedido' }, 404);

    const { results }: any = await c.env.DB.prepare(
      `SELECT d.ProductoID, d.Cantidad, d.Precio, d.SubTotal,
              COALESCE(d.NombreProducto, p.Nombre) AS Nombre,
              p.Stock, p.Estado
         FROM DetalleVenta d
         LEFT JOIN Productos p ON p.ProductoID = d.ProductoID
        WHERE d.VentaID = ?`
    ).bind(venta.VentaID).all();

    delete venta.VentaID;
    return c.json({ success: true, data: { ...venta, lineas: results || [] } });
  } catch (error: any) {
    console.error('cuenta.pedido', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el pedido' }, 500);
  }
});

/* ── Lista de deseos ────────────────────────────────────────────────── */

cuentaRouter.get('/favoritos', conSesion, async (c) => {
  const { clienteId } = c.get('cliente') as any;
  const { results }: any = await c.env.DB.prepare(
    `SELECT Tipo AS kind, Referencia AS ref FROM ClientesFavoritos
      WHERE ClienteID = ? ORDER BY AgregadoEn DESC`
  ).bind(clienteId).all();
  return c.json({ success: true, data: results || [] });
});

/**
 * Guarda la lista completa. Es una lista corta y se manda entera: así el
 * teléfono y la computadora terminan siempre con lo mismo, sin llevar la
 * cuenta de qué se agregó o se quitó en cada lado.
 */
cuentaRouter.put('/favoritos', conSesion, async (c) => {
  const { clienteId } = c.get('cliente') as any;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const lista = Array.isArray(body?.favoritos) ? body.favoritos : [];
  const limpia = lista
    .filter((f: any) => (f?.kind === 'perfume' || f?.kind === 'decant') && f?.ref !== undefined)
    .map((f: any) => ({ kind: f.kind, ref: String(f.ref).slice(0, 80) }))
    .slice(0, 100);

  try {
    const sentencias = [
      c.env.DB.prepare(`DELETE FROM ClientesFavoritos WHERE ClienteID = ?`).bind(clienteId),
      ...limpia.map((f: any) =>
        c.env.DB.prepare(
          `INSERT INTO ClientesFavoritos (ClienteID, Tipo, Referencia) VALUES (?, ?, ?)
           ON CONFLICT DO NOTHING`
        ).bind(clienteId, f.kind, f.ref)
      ),
    ];
    await c.env.DB.batch(sentencias);
    return c.json({ success: true, data: limpia });
  } catch (error: any) {
    console.error('cuenta.favoritos', error?.message);
    return c.json({ success: false, message: 'No se pudo guardar la lista' }, 500);
  }
});
