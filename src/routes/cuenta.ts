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
import { consumirToken, crearToken, mirarToken, type TipoToken } from '../lib/tokensCuenta';
import { enviarCorreoCuenta } from '../lib/correoCuenta';
import { correoConfigurado } from '../lib/correo';

type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;
  // Enlaces de confirmación y de contraseña nueva
  RESEND_API_KEY?: string;
  CORREO_REMITENTE?: string;
  CORREO_MODO_PRUEBA?: string;
  SITE_URL?: string;
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

/**
 * Cuánto se espera entre dos correos a la misma dirección.
 *
 * El tope por IP lo pone el limitador de Cloudflare; este es por buzón, que
 * es otro problema: quien no quiere una cuenta acá no tiene por qué aguantar
 * veinte mensajes porque alguien se divierta escribiendo su correo.
 */
const MINUTOS_ENTRE_ENVIOS = 5;

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

  // Una consulta por llave primaria en cada petición con sesión. Es lo que
  // cuesta poder cerrar las sesiones abiertas al cambiar la contraseña, y de
  // paso ahorra que cada endpoint pregunte si el correo está confirmado.
  const fila: any = await c.env.DB.prepare(
    `SELECT Verificado, SesionesDesde FROM Clientes WHERE ClienteID = ?`
  ).bind(s.clienteId).first();

  if (!fila) return c.json({ success: false, message: 'Entrá a tu cuenta' }, 401);

  const desde = Number(fila.SesionesDesde) || 0;
  if (desde && s.emitido < desde) {
    return c.json({ success: false, message: 'Tu sesión venció. Entrá de nuevo.' }, 401);
  }

  c.set('cliente', { ...s, verificado: Boolean(fila.Verificado) });
  await next();
}

/**
 * Lo que sale de `Ventas` exige el correo confirmado.
 *
 * Un pedido es «tuyo» si lo hiciste con ese correo, así que sin comprobar el
 * correo la cuenta es apenas una afirmación. Responde 403 y no 401 para que
 * la tienda muestre «confirmá tu correo» en vez de echar a la persona.
 */
async function conVerificado(c: any, next: any) {
  if (!(c.get('cliente') as any)?.verificado) {
    return c.json(
      {
        success: false,
        verificado: false,
        message: 'Confirmá tu correo desde el enlace que te mandamos y vas a ver tus pedidos.',
      },
      403
    );
  }
  await next();
}

/**
 * Perfil que ve la tienda.
 *
 * Sin el correo confirmado no se devuelve ningún dato personal: en la base
 * quedan nombres y teléfonos que una versión anterior copiaba del último
 * pedido hecho con esa dirección, y son de quien compró, no de quien acaba de
 * escribir ese correo en un formulario.
 */
const perfilPublico = (fila: any) => {
  const verificado = Boolean(fila.Verificado);
  const dato = (valor: any) => (verificado ? valor || '' : '');

  return {
    correo: fila.Correo,
    verificado,
    nombre: dato(fila.Nombre),
    telefono: dato(fila.Telefono),
    provincia: dato(fila.Provincia),
    canton: dato(fila.Canton),
    distrito: dato(fila.Distrito),
    direccion: dato(fila.DireccionExacta),
    waze: dato(fila.Waze),
  };
};

/** Segundos desde la época, que es como se guarda `SesionesDesde`. */
const ahoraEnSegundos = () => Math.floor(Date.now() / 1000);

/**
 * Manda el correo sin hacer esperar a quien pidió.
 *
 * En `/recuperar` importa por algo más que la velocidad: si la respuesta
 * tardara más cuando la cuenta existe, el tiempo de espera diría lo que el
 * mensaje se cuida de no decir.
 */
function enSegundoPlano(c: any, tarea: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(tarea);
  } catch {
    // En local no hay executionCtx: se deja correr y se ignora el resultado
    void Promise.resolve(tarea).catch(() => {});
  }
}

/** ¿Ya salió un correo a esta dirección hace muy poco? */
async function envioReciente(db: D1Database, marca: string) {
  const fila: any = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM IntentosLogin
        WHERE Usuario = ? AND Fecha > datetime('now', 'localtime', ?)`
    )
    .bind(marca, `-${MINUTOS_ENTRE_ENVIOS} minutes`)
    .first();

  return (Number(fila?.n) || 0) > 0;
}

/**
 * Deja constancia del envío en la misma tabla de intentos, con `Exito = 1`
 * para que no cuente como fallo: pedir un enlace no puede bloquear a nadie.
 */
async function anotarEnvio(db: D1Database, marca: string, ip: string) {
  await db
    .prepare(`INSERT INTO IntentosLogin (Usuario, IP, Exito) VALUES (?, ?, 1)`)
    .bind(marca, ip)
    .run();
}

/**
 * Con el correo ya probado, se recuperan el nombre y el teléfono del último
 * pedido hecho con esa dirección.
 *
 * Es la comodidad que el registro hacía antes —quien ya compró no vuelve a
 * escribir sus datos— pero ahora en el único momento en que se puede hacer sin
 * regalarle los datos de un cliente a quien escribió su correo. Solo rellena
 * huecos: nunca pisa algo que la persona haya guardado.
 */
async function rellenarDesdeUltimoPedido(db: D1Database, correo: string) {
  try {
    await db
      .prepare(
        `UPDATE Clientes
            SET Nombre   = COALESCE(Nombre,   (SELECT Cliente  FROM Ventas
                                                WHERE lower(trim(Email)) = ?
                                                ORDER BY VentaID DESC LIMIT 1)),
                Telefono = COALESCE(Telefono, (SELECT Telefono FROM Ventas
                                                WHERE lower(trim(Email)) = ?
                                                ORDER BY VentaID DESC LIMIT 1))
          WHERE Correo = ?`
      )
      .bind(correo, correo, correo)
      .run();
  } catch (error: any) {
    // Es una comodidad, no un requisito: si falla, la cuenta queda igual
    console.error('cuenta.rellenar', error?.message);
  }
}

/** Emite el token y manda el correo. Nunca lanza: devuelve si salió o no. */
async function mandarEnlace(c: any, correo: string, tipo: TipoToken) {
  try {
    const token = await crearToken(c.env.DB, correo, tipo, ipDe(c));
    const r = await enviarCorreoCuenta(c.env, correo, tipo, token);
    if (!r.enviado) console.error('cuenta.enlace', tipo, r.motivo);
    return r.enviado;
  } catch (error: any) {
    console.error('cuenta.enlace.error', tipo, error?.message);
    return false;
  }
}

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
 * La cuenta nace sin confirmar y sin un solo dato copiado de pedidos
 * anteriores: escribir un correo no prueba nada todavía. El enlace de
 * confirmación sale enseguida, y hasta que alguien lo abra, la cuenta no ve
 * ningún pedido.
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
      await c.env.DB.prepare(
        `INSERT INTO Clientes (Correo, PasswordHash) VALUES (?, ?)`
      ).bind(correo, hash).run();
    }

    const cliente: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE Correo = ?`)
      .bind(correo).first();

    // El enlace sale ahora. Si el correo falla, la cuenta queda creada igual y
    // desde la tienda se puede pedir otro: perder el envío no puede dejar a
    // nadie con media cuenta.
    await anotarEnvio(c.env.DB, `verificar:${correo}`, ipDe(c));
    const correoEnviado = await mandarEnlace(c, correo, 'verificacion');

    const token = await tokenCliente(Number(cliente.ClienteID), correo, c.env.JWT_SECRET);
    return c.json({
      success: true,
      data: { token, perfil: perfilPublico(cliente), correoEnviado },
    });
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

    // Cambiar la contraseña cierra las demás sesiones. La de este dispositivo
    // se renueva acá mismo: quien acaba de escribir su contraseña actual no
    // tiene por qué volver a entrar.
    const ahora = ahoraEnSegundos();
    await c.env.DB.prepare(
      `UPDATE Clientes SET PasswordHash = ?, SesionesDesde = ? WHERE ClienteID = ?`
    ).bind(await hashPassword(nueva), ahora, clienteId).run();

    const sesionNueva = await tokenCliente(clienteId, correo, c.env.JWT_SECRET);
    return c.json({
      success: true,
      message: 'Contraseña cambiada',
      data: { token: sesionNueva },
    });
  } catch (error: any) {
    console.error('cuenta.clave', error?.message);
    return c.json({ success: false, message: 'No se pudo cambiar la contraseña' }, 500);
  }
});

/* ── Confirmar el correo ────────────────────────────────────────────── */

/**
 * Confirma la dirección con el token que llegó por correo.
 *
 * Devuelve una sesión nueva: quien abre el enlace desde el teléfono, donde
 * quizá nunca entró, queda adentro sin escribir la contraseña otra vez.
 */
cuentaRouter.post('/verificar', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const correo = await consumirToken(c.env.DB, 'verificacion', String(body?.token ?? ''));

  if (!correo) {
    return c.json(
      { success: false, message: 'Ese enlace ya no sirve. Entrá a tu cuenta y pedí uno nuevo.' },
      400
    );
  }

  try {
    await c.env.DB.prepare(`UPDATE Clientes SET Verificado = 1 WHERE Correo = ?`)
      .bind(correo).run();
    await rellenarDesdeUltimoPedido(c.env.DB, correo);

    const cliente: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE Correo = ?`)
      .bind(correo).first();

    if (!cliente) return c.json({ success: false, message: 'Cuenta no encontrada' }, 404);

    const token = await tokenCliente(Number(cliente.ClienteID), correo, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, perfil: perfilPublico(cliente) } });
  } catch (error: any) {
    console.error('cuenta.verificar', error?.message);
    return c.json({ success: false, message: 'No se pudo confirmar el correo' }, 500);
  }
});

/** Otro enlace de confirmación, para quien no recibió el primero. */
cuentaRouter.post('/reenviar', conSesion, async (c) => {
  const { correo, verificado } = c.get('cliente') as any;

  if (verificado) {
    return c.json({ success: true, message: 'Tu correo ya está confirmado' });
  }

  if (!correoConfigurado(c.env)) {
    return c.json(
      { success: false, message: 'No podemos mandar el enlace en este momento. Escribinos por WhatsApp.' },
      503
    );
  }

  const marca = `verificar:${correo}`;
  if (await envioReciente(c.env.DB, marca)) {
    return c.json(
      { success: false, message: `Ya te mandamos uno. Esperá ${MINUTOS_ENTRE_ENVIOS} minutos y revisá también el correo no deseado.` },
      429
    );
  }

  await anotarEnvio(c.env.DB, marca, ipDe(c));
  const enviado = await mandarEnlace(c, correo, 'verificacion');

  if (!enviado) {
    return c.json({ success: false, message: 'No pudimos mandar el enlace. Probá en un rato.' }, 502);
  }

  return c.json({ success: true, message: 'Te mandamos el enlace de nuevo' });
});

/* ── Recuperar la contraseña ────────────────────────────────────────── */

/**
 * Pide el enlace para elegir una contraseña nueva.
 *
 * La respuesta es la misma exista o no la cuenta. Decir «ese correo no está
 * registrado» convierte este endpoint en una forma cómoda de averiguar quién
 * compra en la tienda, que no es asunto de quien pregunta.
 */
cuentaRouter.post('/recuperar', async (c) => {
  if (!(await dentroDelLimite((c.env as any).LIMITE_CLAVES, `recuperar:${ipDe(c)}`))) {
    return c.json({ success: false, message: 'Demasiados intentos seguidos. Esperá un minuto.' }, 429);
  }

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

  // Sin servicio de correo no se puede prometer un enlace: es mejor decirlo
  // que dejar a la persona esperando un mensaje que nunca se intentó mandar.
  if (!correoConfigurado(c.env)) {
    return c.json(
      { success: false, message: 'No podemos mandar el enlace en este momento. Escribinos por WhatsApp y te ayudamos.' },
      503
    );
  }

  const respuesta = {
    success: true,
    message: 'Si hay una cuenta con ese correo, te llega un enlace en unos minutos.',
  };

  try {
    const marca = `recuperar:${correo}`;
    if (await envioReciente(c.env.DB, marca)) return c.json(respuesta);

    const cliente: any = await c.env.DB.prepare(
      `SELECT ClienteID FROM Clientes WHERE Correo = ? AND PasswordHash IS NOT NULL`
    ).bind(correo).first();

    if (cliente) {
      await anotarEnvio(c.env.DB, marca, ipDe(c));
      enSegundoPlano(c, mandarEnlace(c, correo, 'clave'));
    }
  } catch (error: any) {
    // Tampoco acá se cambia la respuesta: un fallo interno no tiene por qué
    // contarle a nadie si esa cuenta existe.
    console.error('cuenta.recuperar', error?.message);
  }

  return c.json(respuesta);
});

/**
 * Guarda la contraseña nueva con el token del correo.
 *
 * Abrir ese enlace prueba lo mismo que el correo de bienvenida, así que la
 * cuenta queda confirmada de paso. Las sesiones abiertas se cierran: quien
 * llega hasta acá suele hacerlo porque alguien más sabe su contraseña.
 */
cuentaRouter.post('/nueva-clave', async (c) => {
  if (!(await dentroDelLimite((c.env as any).LIMITE_CLAVES, `nueva-clave:${ipDe(c)}`))) {
    return c.json({ success: false, message: 'Demasiados intentos seguidos. Esperá un minuto.' }, 429);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const enlace = String(body?.token ?? '');
  const clave = String(body?.clave ?? '');

  const vencido = {
    success: false,
    message: 'Ese enlace ya no sirve. Pedí uno nuevo desde «¿Olvidaste tu contraseña?».',
  };

  try {
    // Primero se mira a quién pertenece, sin gastarlo: las reglas de la clave
    // dependen del correo, y sería absurdo quemar el enlace para después
    // decirle a la persona que su contraseña era muy corta.
    const correo = await mirarToken(c.env.DB, 'clave', enlace);
    if (!correo) return c.json(vencido, 400);

    const problema = revisarClave(clave, correo);
    if (problema) return c.json({ success: false, message: problema }, 400);

    // Recién ahora se gasta. Dos pestañas con el mismo enlace no pueden pasar
    // las dos: la segunda no encuentra la fila sin usar.
    const confirmado = await consumirToken(c.env.DB, 'clave', enlace);
    if (!confirmado) return c.json(vencido, 400);

    const ahora = ahoraEnSegundos();

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE Clientes
            SET PasswordHash = ?, Verificado = 1, SesionesDesde = ?
          WHERE Correo = ?`
      ).bind(await hashPassword(clave), ahora, confirmado),
      // Que el bloqueo por intentos no le impida entrar con la nueva
      c.env.DB.prepare(`DELETE FROM IntentosLogin WHERE Usuario = ?`).bind(`cliente:${confirmado}`),
    ]);

    await rellenarDesdeUltimoPedido(c.env.DB, confirmado);

    const cliente: any = await c.env.DB.prepare(`SELECT * FROM Clientes WHERE Correo = ?`)
      .bind(confirmado).first();

    if (!cliente) return c.json({ success: false, message: 'Cuenta no encontrada' }, 404);

    const token = await tokenCliente(Number(cliente.ClienteID), confirmado, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token, perfil: perfilPublico(cliente) } });
  } catch (error: any) {
    console.error('cuenta.nueva-clave', error?.message);
    return c.json({ success: false, message: 'No se pudo cambiar la contraseña' }, 500);
  }
});

/**
 * Reinicio desde el panel, para cuando un cliente olvida su contraseña.
 *
 * Dejó de ser el camino normal —para eso está `/recuperar`, que manda un
 * enlace— y queda como la salida para quien perdió el acceso a su correo. Solo
 * administradores, y nunca devuelve la contraseña vieja porque no existe en
 * ninguna parte.
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
      c.env.DB.prepare(
        `UPDATE Clientes SET PasswordHash = ?, SesionesDesde = ? WHERE ClienteID = ?`
      ).bind(await hashPassword(nueva), ahoraEnSegundos(), cliente.ClienteID),
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
cuentaRouter.put('/', conSesion, conVerificado, async (c) => {
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
cuentaRouter.get('/pedidos', conSesion, conVerificado, async (c) => {
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
cuentaRouter.get('/pedidos/:numero', conSesion, conVerificado, async (c) => {
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
