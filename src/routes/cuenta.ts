import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { hashPassword, verifyPasswordDetallado } from '../utils/crypto';
import {
  correoValido,
  leerTokenCliente,
  normalizarCorreo,
  revisarClave,
  tokenCliente,
} from '../lib/cuentas';
import { dentroDelLimite } from '../lib/limite';

type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;
};

export const cuentaRouter = new Hono<{ Bindings: Bindings }>();

/*
 * Freno a los intentos de adivinar la contraseña, con la misma tabla y los
 * mismos números que el panel: cinco fallos del mismo correo o quince desde
 * la misma IP cierran la puerta quince minutos. El usuario se anota con
 * prefijo «cliente:» para que un cliente bloqueado no bloquee al panel.
 */
const VENTANA_MINUTOS = 15;
const TOPE_CORREO = 5;
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

async function estaBloqueado(db: D1Database, correo: string, ip: string) {
  const fila: any = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN Usuario = ? THEN 1 ELSE 0 END) AS PorCorreo,
         SUM(CASE WHEN IP = ?      THEN 1 ELSE 0 END) AS PorIP
       FROM IntentosLogin
       WHERE Exito = 0 AND Fecha > datetime('now', 'localtime', ?)`
    )
    .bind(`cliente:${correo}`, ip, `-${VENTANA_MINUTOS} minutes`)
    .first();

  return (Number(fila?.PorCorreo) || 0) >= TOPE_CORREO || (Number(fila?.PorIP) || 0) >= TOPE_IP;
}

async function anotarIntento(db: D1Database, correo: string, ip: string, exito: boolean) {
  await db.batch([
    db.prepare(`INSERT INTO IntentosLogin (Usuario, IP, Exito) VALUES (?, ?, ?)`)
      .bind(`cliente:${correo}`, ip, exito ? 1 : 0),
    db.prepare(`DELETE FROM IntentosLogin WHERE Fecha < datetime('now', 'localtime', '-1 day')`),
  ]);
}

/**
 * Crear la cuenta.
 *
 * Si ya existe se dice con todas las letras: es lo que la persona necesita
 * saber para ir a entrar en vez de quedarse trabada, y cualquiera puede
 * comprobar lo mismo intentando registrarse igual.
 *
 * El nombre y el teléfono se toman del último pedido hecho con ese correo,
 * así quien ya compró no tiene que volver a escribirlos.
 */
cuentaRouter.post('/registro', async (c) => {
  // Entrar ya está protegido por intento fallido; registrarse no lo estaba, y
  // cada registro cuesta un hash PBKDF2 y una fila nueva.
  if (!(await dentroDelLimite((c.env as any).LIMITE_CLAVES, `registro:${ipDe(c)}`))) {
    return c.json(
      { success: false, message: 'Demasiados intentos seguidos. Esperá un minuto.' },
      429
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = normalizarCorreo(body?.correo);
  const clave = String(body?.clave ?? '');

  if (!correoValido(correo)) {
    return c.json({ success: false, message: 'Escribí un correo válido' }, 400);
  }

  const problema = revisarClave(clave, correo);
  if (problema) return c.json({ success: false, message: problema }, 400);

  try {
    const existe = await c.env.DB.prepare(
      `SELECT ClienteID, PasswordHash FROM Clientes WHERE Correo = ?`
    ).bind(correo).first<any>();

    if (existe?.PasswordHash) {
      return c.json({ success: false, message: 'Ya hay una cuenta con ese correo. Entrá con tu contraseña.' }, 409);
    }

    const hash = await hashPassword(clave);

    if (existe) {
      // Cuenta creada por una versión anterior, todavía sin contraseña
      await c.env.DB.prepare(`UPDATE Clientes SET PasswordHash = ? WHERE ClienteID = ?`)
        .bind(hash, existe.ClienteID).run();
    } else {
      const ultimo: any = await c.env.DB.prepare(
        `SELECT Cliente, Telefono FROM Ventas
          WHERE lower(trim(Email)) = ? ORDER BY VentaID DESC LIMIT 1`
      ).bind(correo).first();

      await c.env.DB.prepare(
        `INSERT INTO Clientes (Correo, Nombre, Telefono, PasswordHash) VALUES (?, ?, ?, ?)`
      ).bind(correo, ultimo?.Cliente ?? null, ultimo?.Telefono ?? null, hash).run();
    }

    const cliente: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE Correo = ?`)
      .bind(correo).first();

    const token = await tokenCliente(Number(cliente.ClienteID), correo, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, perfil: perfilPublico(cliente) } });
  } catch (error: any) {
    console.error('cuenta.registro', error?.message);
    return c.json({ success: false, message: 'No se pudo crear la cuenta' }, 500);
  }
});

/** Entrar. El mensaje de error es el mismo falle el correo o falle la clave. */
cuentaRouter.post('/entrar', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = normalizarCorreo(body?.correo);
  const clave = String(body?.clave ?? '');
  const ip = ipDe(c);

  if (!correo || !clave) {
    return c.json({ success: false, message: 'Escribí tu correo y tu contraseña' }, 400);
  }

  try {
    if (await estaBloqueado(c.env.DB, correo, ip)) {
      return c.json(
        { success: false, message: `Demasiados intentos. Probá de nuevo en ${VENTANA_MINUTOS} minutos.` },
        429
      );
    }

    const cliente: any = await c.env.DB.prepare(
      `SELECT * FROM Clientes WHERE Correo = ? AND PasswordHash IS NOT NULL`
    ).bind(correo).first();

    if (!cliente) {
      await anotarIntento(c.env.DB, correo, ip, false);
      return c.json({ success: false, message: 'Correo o contraseña incorrectos' }, 401);
    }

    const { valido, necesitaActualizar } = await verifyPasswordDetallado(clave, cliente.PasswordHash);

    if (!valido) {
      await anotarIntento(c.env.DB, correo, ip, false);
      return c.json({ success: false, message: 'Correo o contraseña incorrectos' }, 401);
    }

    await anotarIntento(c.env.DB, correo, ip, true);

    const sentencias = [
      c.env.DB.prepare(`UPDATE Clientes SET UltimoAcceso = datetime('now','localtime') WHERE ClienteID = ?`)
        .bind(cliente.ClienteID),
    ];
    if (necesitaActualizar) {
      sentencias.push(
        c.env.DB.prepare(`UPDATE Clientes SET PasswordHash = ? WHERE ClienteID = ?`)
          .bind(await hashPassword(clave), cliente.ClienteID)
      );
    }
    await c.env.DB.batch(sentencias);

    const token = await tokenCliente(Number(cliente.ClienteID), correo, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, perfil: perfilPublico(cliente) } });
  } catch (error: any) {
    console.error('cuenta.entrar', error?.message);
    return c.json({ success: false, message: 'No se pudo entrar' }, 500);
  }
});

/** Cambiar la contraseña propia. Exige la actual: un token robado no alcanza. */
cuentaRouter.post('/clave', conSesion, async (c) => {
  const { clienteId, correo } = c.get('cliente') as any;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const actual = String(body?.actual ?? '');
  const nueva = String(body?.nueva ?? '');

  const problema = revisarClave(nueva, correo);
  if (problema) return c.json({ success: false, message: problema }, 400);

  try {
    const cliente: any = await c.env.DB.prepare(
      `SELECT PasswordHash FROM Clientes WHERE ClienteID = ?`
    ).bind(clienteId).first();

    const { valido } = await verifyPasswordDetallado(actual, cliente?.PasswordHash ?? '');
    if (!valido) {
      // 403 y no 401: la sesión es válida, lo que falla es la contraseña que
      // se escribió. Con 401 el navegador entiende «tu sesión venció», borra
      // el token y echa de la cuenta a quien solo se equivocó al teclear.
      return c.json({ success: false, message: 'La contraseña actual no es correcta' }, 403);
    }

    await c.env.DB.prepare(`UPDATE Clientes SET PasswordHash = ? WHERE ClienteID = ?`)
      .bind(await hashPassword(nueva), clienteId).run();

    return c.json({ success: true, message: 'Contraseña cambiada' });
  } catch (error: any) {
    console.error('cuenta.clave', error?.message);
    return c.json({ success: false, message: 'No se pudo cambiar la contraseña' }, 500);
  }
});

/**
 * Reinicio desde el panel, para cuando un cliente olvida su contraseña.
 *
 * Sin servicio de correo no hay forma automática de recuperarla, así que la
 * tienda le pone una temporal y se la pasa por WhatsApp. Solo administradores,
 * y nunca devuelve la contraseña vieja porque no existe en ninguna parte.
 */
cuentaRouter.post('/reiniciar', authMiddleware, adminMiddleware, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = normalizarCorreo(body?.correo);
  const nueva = String(body?.clave ?? '');

  const problema = revisarClave(nueva, correo);
  if (problema) return c.json({ success: false, message: problema }, 400);

  try {
    const cliente: any = await c.env.DB.prepare(`SELECT ClienteID FROM Clientes WHERE Correo = ?`)
      .bind(correo).first();

    if (!cliente) return c.json({ success: false, message: 'No hay cuenta con ese correo' }, 404);

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE Clientes SET PasswordHash = ? WHERE ClienteID = ?`)
        .bind(await hashPassword(nueva), cliente.ClienteID),
      // Que el bloqueo por intentos no le impida entrar con la nueva
      c.env.DB.prepare(`DELETE FROM IntentosLogin WHERE Usuario = ?`).bind(`cliente:${correo}`),
    ]);

    return c.json({ success: true, message: 'Contraseña reiniciada' });
  } catch (error: any) {
    console.error('cuenta.reiniciar', error?.message);
    return c.json({ success: false, message: 'No se pudo reiniciar' }, 500);
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
