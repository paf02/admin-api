import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import {
  canTransition,
  historyStatement,
  initialPaymentStatus,
  isOrderStatus,
  isPaymentStatus,
  orderNumberFrom,
  PAYMENT_METHODS,
} from '../lib/orders';
import { buildOrderCreated, publish } from '../lib/events';
import { shippingFor } from '../lib/shipping';
import { avisarAlCliente } from '../lib/notifyCustomer';
import { avisarPorCorreo } from '../lib/avisoCorreo';
import { dentroDelLimite, ipDe } from '../lib/limite';
import {
  buscarCandidatos,
  montoDelMensaje,
  nombreDelMensaje,
  referenciaDelMensaje,
  telefonoDelMensaje,
} from '../lib/sinpe';
import {
  deductStatement,
  movementStatement,
  restoreStatement,
} from '../lib/inventory';

import type { NotifyEnv } from '../lib/events';

type Bindings = { DB: D1Database } & NotifyEnv;

export const ventasRouter = new Hono<{ Bindings: Bindings }>();

/** Solo el panel puede leer pedidos: llevan nombre, teléfono y dirección. */
const admin = [authMiddleware, adminMiddleware] as const;

const usuarioDe = (c: any) => c.get('user')?.username ?? null;

/**
 * Clave de seguimiento del pedido: aleatoria, no derivable del número.
 * Va en el enlace que recibe el cliente y es lo único que autoriza a verlo.
 */
const claveConsulta = () => crypto.randomUUID().replace(/-/g, '').slice(0, 18);

/* ------------------------------------------------------------------ *
 * Lectura
 * ------------------------------------------------------------------ */

/**
 * Listado con filtros. Los filtros se arman como SQL parametrizado; nada de
 * lo que llega por query string entra concatenado a la consulta.
 */
ventasRouter.get('/', ...admin, async (c) => {
  const { estado, estadoPago, metodoPago, desde, hasta, q, limit } = c.req.query();

  const where: string[] = [];
  const binds: unknown[] = [];

  if (estado) {
    where.push('v.EstadoVenta = ?');
    binds.push(estado);
  }
  if (estadoPago) {
    where.push('v.EstadoPago = ?');
    binds.push(estadoPago);
  }
  if (metodoPago) {
    where.push('v.MetodoPago = ?');
    binds.push(metodoPago);
  }
  if (desde) {
    where.push('date(v.Fecha) >= date(?)');
    binds.push(desde);
  }
  if (hasta) {
    where.push('date(v.Fecha) <= date(?)');
    binds.push(hasta);
  }
  if (q) {
    // Un parámetro por campo: D1 liga posicionalmente, así que repetir el
    // valor es más seguro que numerar los placeholders a mano.
    where.push(
      '(v.NumeroPedido LIKE ? OR v.Cliente LIKE ? OR v.Telefono LIKE ? OR v.Email LIKE ?)'
    );
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }

  const sql = `
    SELECT
      v.*,
      (SELECT COUNT(*) FROM DetalleVenta d WHERE d.VentaID = v.VentaID)      AS Lineas,
      (SELECT COALESCE(SUM(d.Cantidad), 0) FROM DetalleVenta d WHERE d.VentaID = v.VentaID) AS Unidades
    FROM Ventas v
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY v.VentaID DESC
    LIMIT ?
  `;

  const max = Math.min(Number(limit) || 200, 500);

  try {
    const { results } = await c.env.DB.prepare(sql).bind(...binds, max).all();
    return c.json({ success: true, data: results });
  } catch (error: any) {
    console.error('ventas.list', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el listado de pedidos' }, 500);
  }
});

/** Contadores del panel. Una sola consulta por tarjeta, sin traer los pedidos. */
ventasRouter.get('/resumen', ...admin, async (c) => {
  try {
    const row = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN EstadoVenta = 'Pendiente'  THEN 1 ELSE 0 END) AS Nuevos,
        SUM(CASE WHEN Revisado = 0 AND EstadoVenta <> 'Cancelado' THEN 1 ELSE 0 END) AS SinRevisar,
        SUM(CASE WHEN EstadoPago = 'Verificación requerida' THEN 1 ELSE 0 END) AS PorVerificar,
        SUM(CASE WHEN EstadoVenta = 'Preparando' THEN 1 ELSE 0 END) AS Preparando,
        SUM(CASE WHEN EstadoVenta = 'Listo'      THEN 1 ELSE 0 END) AS Listos,
        SUM(CASE WHEN EstadoVenta = 'Enviado'    THEN 1 ELSE 0 END) AS EnRuta,
        SUM(CASE WHEN date(Fecha) = date('now','localtime') THEN 1 ELSE 0 END) AS PedidosHoy,
        SUM(CASE WHEN EstadoVenta = 'Entregado'
                  AND date(Fecha) = date('now','localtime') THEN 1 ELSE 0 END) AS EntregadosHoy
      FROM Ventas
    `).first();

    return c.json({ success: true, data: row });
  } catch (error: any) {
    console.error('ventas.resumen', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el resumen' }, 500);
  }
});

/**
 * Detalle. Antes esta ruta era pública: cualquiera podía recorrer los IDs y
 * leer nombre, teléfono y dirección de todos los pedidos.
 */
/**
 * Seguimiento público del pedido: /ventas/consulta/:numero?c=<clave>
 *
 * Un pedido vive en el navegador que lo hizo, así que quien limpie el
 * historial o cambie de teléfono se queda sin forma de ver en qué va lo suyo.
 * Con el enlace puede, desde donde sea.
 *
 * La clave es lo que autoriza, no el número: los números son correlativos
 * (EP-000001, EP-000002…) y sin clave cualquiera leería pedidos ajenos
 * probando el siguiente. La respuesta es idéntica cuando el pedido no existe
 * y cuando la clave no coincide, para que tampoco se pueda averiguar cuáles
 * existen.
 *
 * Devuelve lo justo para saber en qué va —estado, productos, totales—: sin
 * dirección exacta, sin correo, sin teléfono y sin quién lo atendió.
 */
/**
 * Propone a qué pedido corresponde un SINPE.
 *
 * Recibe el mensaje del banco tal cual llega —pegado a mano o reenviado
 * automáticamente— y devuelve los pedidos que calzan. No marca nada: la
 * confirmación sigue siendo un toque humano, porque cobrarle a la persona
 * equivocada significa entregar un perfume que nadie pagó.
 */
ventasRouter.post('/sinpe/sugerencia', ...admin, async (c) => {
  const { texto } = await c.req.json().catch(() => ({} as any));

  const monto = montoDelMensaje(String(texto ?? ''));
  if (!monto) {
    return c.json(
      { success: false, message: 'No encontramos un monto en ese mensaje.' },
      400
    );
  }

  try {
    // SINPE_PROPIO es el número de la tienda: los avisos lo incluyen como
    // cuenta receptora y confundirlo con el del cliente arruina el cotejo.
    const telefono = telefonoDelMensaje(String(texto ?? ''), (c.env as any).SINPE_PROPIO);
    const nombre = nombreDelMensaje(String(texto ?? ''));
    const referencia = referenciaDelMensaje(String(texto ?? ''));
    const candidatos = await buscarCandidatos(c.env.DB, monto, telefono, nombre);

    return c.json({
      success: true,
      data: {
        monto,
        telefono,
        nombre,
        referencia,
        candidatos,
        // Sin candidatos no siempre es un error: puede ser un pago que no
        // corresponde a ningún pedido, o un monto que ya se verificó.
        mensaje: candidatos.length
          ? null
          : 'Ningún pedido pendiente calza con ese monto. Puede que ya lo hayas verificado.',
      },
    });
  } catch (error: any) {
    console.error('ventas.sinpe', error?.message);
    return c.json({ success: false, message: 'No pudimos revisar los pedidos.' }, 500);
  }
});

ventasRouter.get('/consulta/:numero', async (c) => {
  const numero = String(c.req.param('numero') ?? '').trim().toUpperCase();
  const clave = String(c.req.query('c') ?? '').trim();

  const noEncontrado = () =>
    c.json({ success: false, message: 'No encontramos ese pedido.' }, 404);

  if (!numero || !clave) return noEncontrado();

  try {
    const venta = await c.env.DB.prepare(
      `SELECT VentaID, NumeroPedido, Fecha, Cliente, Consulta,
              MetodoPago, EstadoPago, EstadoVenta,
              MetodoEntrega, CostoEnvio, EnvioPorConfirmar, Total
         FROM Ventas
        WHERE NumeroPedido = ?`
    ).bind(numero).first<any>();

    if (!venta || !venta.Consulta || venta.Consulta !== clave) return noEncontrado();

    const { results: detalles } = await c.env.DB.prepare(
      `SELECT COALESCE(d.NombreProducto, p.Nombre) AS NombreProducto,
              d.Cantidad, d.Precio, d.SubTotal
         FROM DetalleVenta d
         LEFT JOIN Productos p ON p.ProductoID = d.ProductoID
        WHERE d.VentaID = ?
        ORDER BY d.DetalleID`
    ).bind(venta.VentaID).all();

    return c.json({
      success: true,
      data: {
        NumeroPedido: venta.NumeroPedido,
        Fecha: venta.Fecha,
        Nombre: venta.Cliente,
        EstadoVenta: venta.EstadoVenta,
        EstadoPago: venta.EstadoPago,
        MetodoPago: venta.MetodoPago,
        MetodoEntrega: venta.MetodoEntrega,
        CostoEnvio: venta.CostoEnvio,
        EnvioPorConfirmar: venta.EnvioPorConfirmar,
        Total: venta.Total,
        detalles,
      },
    });
  } catch (error: any) {
    console.error('ventas.consulta', error?.message);
    return c.json({ success: false, message: 'No pudimos consultar el pedido.' }, 500);
  }
});

ventasRouter.get('/:id', ...admin, async (c) => {
  const id = c.req.param('id');

  const venta = await c.env.DB.prepare(`SELECT * FROM Ventas WHERE VentaID = ?`).bind(id).first();
  if (!venta) {
    return c.json({ success: false, message: 'Pedido no encontrado' }, 404);
  }

  const { results: detalles } = await c.env.DB.prepare(`
    SELECT
      d.*,
      COALESCE(d.NombreProducto, p.Nombre) AS ProductoNombre,
      m.Nombre AS MarcaNombre,
      cat.Nombre AS CategoriaNombre,
      p.ImagenURL
    FROM DetalleVenta d
    LEFT JOIN Productos  p   ON d.ProductoID = p.ProductoID
    LEFT JOIN Marcas     m   ON p.MarcaID = m.MarcaID
    LEFT JOIN Categorias cat ON p.CategoriaID = cat.CategoriaID
    WHERE d.VentaID = ?
    ORDER BY d.DetalleID
  `).bind(id).all();

  const { results: historial } = await c.env.DB.prepare(
    `SELECT Accion, Detalle, Usuario, Fecha FROM VentaHistorial WHERE VentaID = ? ORDER BY HistorialID`
  ).bind(id).all();

  return c.json({ success: true, data: { ...venta, detalles, historial } });
});

/**
 * Qué más compró esta persona.
 *
 * Se la reconoce por teléfono o correo —lo único que la tienda pide— y se
 * comparan normalizados, porque el mismo número se escribe de cinco formas
 * («8888 8888», «8888-8888», «+506 88888888»).
 *
 * El total gastado deja fuera los pedidos cancelados: no se cobraron. Los
 * cancelados sí aparecen en la lista, marcados, porque saber que alguien
 * cancela seguido también es información.
 */
ventasRouter.get('/:id/cliente', ...admin, async (c) => {
  const id = c.req.param('id');

  try {
    const venta: any = await c.env.DB.prepare(
      `SELECT VentaID, Cliente, Telefono, Email FROM Ventas WHERE VentaID = ?`
    ).bind(id).first();

    if (!venta) return c.json({ success: false, message: 'Pedido no encontrado' }, 404);

    // Solo dígitos: así «8888-8888» y «+506 8888 8888» son el mismo cliente
    const telefono = String(venta.Telefono ?? '').replace(/\D/g, '').slice(-8);
    const email = String(venta.Email ?? '').trim().toLowerCase();

    if (!telefono && !email) {
      return c.json({
        success: true,
        data: { identificadoPor: null, pedidos: 0, total: 0, anteriores: [] },
      });
    }

    const { results: anteriores } = await c.env.DB.prepare(
      `SELECT VentaID, NumeroPedido, Fecha, Total, EstadoVenta, EstadoPago
         FROM Ventas
        WHERE VentaID <> ?
          AND (
            (? <> '' AND substr(replace(replace(replace(replace(COALESCE(Telefono,''),' ',''),'-',''),'+',''),'(',''), -8) = ?)
            OR (? <> '' AND lower(COALESCE(Email,'')) = ?)
          )
        ORDER BY VentaID DESC
        LIMIT 25`
    ).bind(id, telefono, telefono, email, email).all();

    const validos = (anteriores as any[]).filter((v) => v.EstadoVenta !== 'Cancelado');

    return c.json({
      success: true,
      data: {
        identificadoPor: telefono ? 'teléfono' : 'correo',
        pedidos: validos.length,
        cancelados: anteriores.length - validos.length,
        total: validos.reduce((suma, v) => suma + (Number(v.Total) || 0), 0),
        anteriores,
      },
    });
  } catch (error: any) {
    console.error('ventas.cliente', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el historial del cliente' }, 500);
  }
});

/* ------------------------------------------------------------------ *
 * Creación (tienda pública)
 * ------------------------------------------------------------------ */

/**
 * Crea el pedido.
 *
 * Es la única ruta sin autenticación, porque la usa el cliente al pagar. Por
 * eso los precios NO se toman del cuerpo: se leen de Productos. Antes venían
 * del navegador, así que cualquiera podía mandar Total = 1 y el panel lo
 * habría mostrado como cierto.
 *
 * El stock se descuenta acá y solo acá. Los cambios de estado posteriores no
 * vuelven a tocarlo.
 */
ventasRouter.post('/', async (c) => {
  // Antes de leer nada: cada pedido descuenta existencias y manda un correo,
  // así que el tope va antes del trabajo, no después.
  if (!(await dentroDelLimite((c.env as any).LIMITE_PEDIDOS, `pedidos:${ipDe(c)}`))) {
    return c.json(
      {
        success: false,
        message: 'Demasiados pedidos seguidos. Esperá un minuto y volvé a intentarlo.',
      },
      429
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const cliente = String(body.Cliente ?? '').trim();
  const metodoPago = String(body.MetodoPago ?? '').trim();
  const lineas = Array.isArray(body.productos) ? body.productos : [];

  if (!cliente) return c.json({ success: false, message: 'Falta el nombre del cliente' }, 400);
  if (!lineas.length) return c.json({ success: false, message: 'El pedido no tiene productos' }, 400);
  if (!PAYMENT_METHODS.includes(metodoPago as any)) {
    return c.json({ success: false, message: 'Método de pago no admitido' }, 400);
  }

  // Cantidades por producto, ya saneadas y agrupadas.
  const pedidas = new Map<number, number>();
  for (const linea of lineas) {
    const id = Number(linea?.ProductoID);
    const cantidad = Math.floor(Number(linea?.Cantidad));
    if (!Number.isFinite(id) || !Number.isFinite(cantidad) || cantidad <= 0) {
      return c.json({ success: false, message: 'Producto o cantidad inválida' }, 400);
    }
    pedidas.set(id, (pedidas.get(id) ?? 0) + cantidad);
  }

  const ids = [...pedidas.keys()];
  const { results: productos } = await c.env.DB.prepare(
    `SELECT ProductoID, Nombre, PrecioVenta, PrecioCompra, Stock, Estado
       FROM Productos WHERE ProductoID IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();

  const porId = new Map<number, any>(productos.map((p: any) => [Number(p.ProductoID), p]));

  // Precio y existencias salen de la base, no del cliente.
  const sinStock: string[] = [];
  let subtotal = 0;
  const detalles: { id: number; nombre: string; cantidad: number; compra: number; precio: number; sub: number }[] = [];

  for (const [id, cantidad] of pedidas) {
    const producto = porId.get(id);
    if (!producto || !producto.Estado) {
      return c.json({ success: false, message: 'Un producto del pedido ya no está disponible' }, 409);
    }
    if (Number(producto.Stock) < cantidad) {
      sinStock.push(`${producto.Nombre} (quedan ${producto.Stock})`);
      continue;
    }
    const precio = Number(producto.PrecioVenta);
    const sub = precio * cantidad;
    subtotal += sub;
    detalles.push({
      id,
      nombre: String(producto.Nombre),
      cantidad,
      compra: Number(producto.PrecioCompra) || 0,
      precio,
      sub,
    });
  }

  if (sinStock.length) {
    return c.json(
      { success: false, message: `Sin existencias suficientes: ${sinStock.join(', ')}`, sinStock },
      409
    );
  }

  // El envío se calcula acá, no se acepta del cuerpo: es un cobro, y un
  // navegador que mandara CostoEnvio = 0 dejaría el pedido sin el envío que
  // igual hay que pagar. Método desconocido = por confirmar, sin inventar
  // tarifa ni rechazar la compra.
  const envio = shippingFor(body.MetodoEntrega, subtotal);
  const envioPorConfirmar = envio === null ? 1 : 0;
  const costoEnvio = envio ?? 0;
  const total = subtotal + costoEnvio;

  // Primero se apartan las existencias, después se crea el pedido.
  //
  // La guarda `Stock >= ?` impide el negativo, pero por sí sola no basta: si
  // dos clientes compran la última unidad a la vez, el UPDATE perdedor
  // simplemente no afecta filas y, sin revisar nada, quedaría un pedido
  // registrado sin descontar nada. Por eso se revisa `changes` de cada uno y,
  // si alguno no aplicó, se devuelve lo ya apartado y no se crea el pedido.
  let apartadas: typeof detalles = [];
  try {
    const deducciones = await c.env.DB.batch(
      detalles.map((d) => deductStatement(c.env.DB, d.id, d.cantidad))
    );

    apartadas = detalles.filter((_, i) => deducciones[i]?.meta?.changes === 1);

    if (apartadas.length !== detalles.length) {
      if (apartadas.length) {
        await c.env.DB.batch(
          apartadas.map((d) => restoreStatement(c.env.DB, d.id, d.cantidad))
        );
      }
      const faltantes = detalles
        .filter((d) => !apartadas.includes(d))
        .map((d) => d.nombre);
      return c.json(
        {
          success: false,
          message: `Alguien se adelantó con: ${faltantes.join(', ')}. Revisá las existencias.`,
          sinStock: faltantes,
        },
        409
      );
    }
  } catch (error: any) {
    console.error('ventas.reserva', error?.message);
    return c.json({ success: false, message: 'No se pudieron apartar las existencias' }, 500);
  }

  try {
    // Clave del enlace de seguimiento. Se genera una sola vez y se usa tanto
    // al guardar como en la respuesta: si se generara dos veces, el enlace que
    // recibe el cliente no abriría su propio pedido.
    const consulta = claveConsulta();

    const insert = await c.env.DB.prepare(`
      INSERT INTO Ventas (
        Cliente, Telefono, Email,
        Provincia, Canton, Distrito, DireccionExacta, Waze,
        MetodoEntrega, CostoEnvio, EnvioPorConfirmar,
        MetodoPago, EstadoPago,
        EstadoVenta, Observacion, Total, Consulta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?)
    `).bind(
      cliente,
      body.Telefono ?? null,
      body.Email ?? null,
      body.Provincia ?? null,
      body.Canton ?? null,
      body.Distrito ?? null,
      body.DireccionExacta ?? null,
      body.Waze ?? null,
      body.MetodoEntrega ?? null,
      costoEnvio,
      envioPorConfirmar,
      metodoPago,
      initialPaymentStatus(metodoPago),
      body.Observacion ?? null,
      total,
      consulta
    ).run();

    const ventaId = Number(insert.meta.last_row_id);
    const numero = orderNumberFrom(ventaId);

    // Las existencias ya se apartaron arriba; acá solo queda dejar constancia.
    const statements = [
      c.env.DB.prepare(`UPDATE Ventas SET NumeroPedido = ? WHERE VentaID = ?`).bind(
        numero,
        ventaId
      ),
      ...detalles.flatMap((d) => {
        const anterior = Number(porId.get(d.id)?.Stock) || 0;
        return [
          c.env.DB.prepare(
            `INSERT INTO DetalleVenta (VentaID, ProductoID, Cantidad, PrecioCompra, Precio, SubTotal, NombreProducto)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(ventaId, d.id, d.cantidad, d.compra, d.precio, d.sub, d.nombre),
          movementStatement(c.env.DB, {
            productoId: d.id,
            anterior,
            cambio: -d.cantidad,
            nuevo: anterior - d.cantidad,
            motivo: 'Venta',
            ventaId,
          }),
        ];
      }),
      historyStatement(c.env.DB, ventaId, 'Creado', `Pedido ${numero} recibido`, null),
    ];

    await c.env.DB.batch(statements);

    // El aviso al administrador va aparte y nunca bloquea la respuesta: el
    // cliente ya tiene su pedido creado aunque la notificación tarde o falle.
    const evento = buildOrderCreated({
      orderId: ventaId,
      orderNumber: numero,
      customerName: cliente,
      total,
      paymentMethod: metodoPago,
      paymentStatus: initialPaymentStatus(metodoPago),
      itemCount: detalles.reduce((n, d) => n + d.cantidad, 0),
      items: detalles.map((d) => ({ name: d.nombre, quantity: d.cantidad })),
    });

    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(publish(evento, c.env));
    } else {
      await publish(evento, c.env);
    }

    return c.json(
      {
        success: true,
        message: 'Pedido registrado',
        data: { VentaID: ventaId, NumeroPedido: numero, Total: total, Consulta: consulta },
      },
      201
    );
  } catch (error: any) {
    console.error('ventas.create', error?.message);
    // Las existencias ya estaban apartadas: si el pedido no llegó a crearse,
    // devolverlas es obligatorio o quedan retenidas por un pedido inexistente.
    try {
      await c.env.DB.batch(apartadas.map((d) => restoreStatement(c.env.DB, d.id, d.cantidad)));
    } catch (rollbackError: any) {
      console.error('ventas.create.rollback', rollbackError?.message);
    }
    return c.json({ success: false, message: 'No se pudo registrar el pedido' }, 500);
  }
});

/* ------------------------------------------------------------------ *
 * Operación (panel)
 * ------------------------------------------------------------------ */

/**
 * Cambia el estado del pedido.
 *
 * No toca existencias: el stock ya se descontó al crear. Recorrer
 * Pendiente → Confirmado → Preparando → Listo → Entregado no descuenta cinco
 * veces, no descuenta ninguna.
 */
ventasRouter.patch('/:id/estado', ...admin, async (c) => {
  const id = Number(c.req.param('id'));
  const { estado } = await c.req.json().catch(() => ({}));

  if (!isOrderStatus(estado)) {
    return c.json({ success: false, message: 'Estado no válido' }, 400);
  }
  if (estado === 'Cancelado') {
    return c.json(
      { success: false, message: 'Usá la acción de cancelar: devuelve las existencias' },
      400
    );
  }

  const venta = await c.env.DB.prepare(
    `SELECT EstadoVenta, NumeroPedido, Telefono, Consulta FROM Ventas WHERE VentaID = ?`
  )
    .bind(id)
    .first<{ EstadoVenta: string; NumeroPedido: string | null; Telefono: string | null; Consulta: string | null }>();

  if (!venta) return c.json({ success: false, message: 'Pedido no encontrado' }, 404);
  if (venta.EstadoVenta === estado) {
    return c.json({ success: true, data: { EstadoVenta: estado }, message: 'Sin cambios' });
  }
  if (!canTransition(venta.EstadoVenta, estado)) {
    return c.json(
      { success: false, message: `No se puede pasar de ${venta.EstadoVenta} a ${estado}` },
      409
    );
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE Ventas SET EstadoVenta = ? WHERE VentaID = ?`).bind(estado, id),
      historyStatement(c.env.DB, id, 'Estado', `${venta.EstadoVenta} → ${estado}`, usuarioDe(c)),
    ]);

    // Avisar al cliente solo cuando el cambio le dice algo. Pasar de
    // 'Pendiente' a 'Confirmado' es movimiento interno; que su pedido esté
    // listo o vaya en camino, no.
    const aviso =
      estado === 'Listo' ? 'listo' : estado === 'Enviado' ? 'enviado' : estado === 'Entregado' ? 'entregado' : null;

    if (aviso) {
      // En segundo plano: la respuesta al panel no espera a WhatsApp.
      const envio = avisarAlCliente(c.env as any, aviso, venta);
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(envio);
    }

    return c.json({ success: true, data: { EstadoVenta: estado } });
  } catch (error: any) {
    console.error('ventas.estado', error?.message);
    return c.json({ success: false, message: 'No se pudo actualizar el estado' }, 500);
  }
});

/**
 * Estado de pago. SINPE se verifica a mano: nada lo marca pagado solo.
 */
ventasRouter.patch('/:id/pago', ...admin, async (c) => {
  const id = Number(c.req.param('id'));
  const { estadoPago, referencia } = await c.req.json().catch(() => ({}));

  if (!isPaymentStatus(estadoPago)) {
    return c.json({ success: false, message: 'Estado de pago no válido' }, 400);
  }

  const venta = await c.env.DB.prepare(
    `SELECT EstadoPago, MetodoPago, NumeroPedido, Telefono, Consulta FROM Ventas WHERE VentaID = ?`
  ).bind(id).first<{
    EstadoPago: string;
    MetodoPago: string;
    NumeroPedido: string | null;
    Telefono: string | null;
    Consulta: string | null;
  }>();

  if (!venta) return c.json({ success: false, message: 'Pedido no encontrado' }, 404);

  const usuario = usuarioDe(c);
  const verificado = estadoPago === 'Pagado';

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE Ventas
           SET EstadoPago = ?,
               PagoReferencia    = COALESCE(?, PagoReferencia),
               PagoVerificadoEn  = CASE WHEN ? THEN datetime('now','localtime') ELSE PagoVerificadoEn END,
               PagoVerificadoPor = CASE WHEN ? THEN ? ELSE PagoVerificadoPor END
         WHERE VentaID = ?
      `).bind(estadoPago, referencia ?? null, verificado ? 1 : 0, verificado ? 1 : 0, usuario, id),
      historyStatement(c.env.DB, id, 'Pago', `${venta.EstadoPago} → ${estadoPago}`, usuario),
    ]);

    // Confirmar el pago es lo que más tranquiliza a quien mandó un SINPE y se
    // quedó esperando. Solo al pasar a pagado, no en cada corrección.
    if (verificado && venta.EstadoPago !== 'Pagado') {
      const envio = avisarAlCliente(c.env as any, 'pago', venta);
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(envio);
    }

    return c.json({ success: true, data: { EstadoPago: estadoPago } });
  } catch (error: any) {
    console.error('ventas.pago', error?.message);
    return c.json({ success: false, message: 'No se pudo actualizar el pago' }, 500);
  }
});

/**
 * Cancela y devuelve existencias.
 *
 * `StockDevuelto` es la guarda: el UPDATE solo corre si sigue en 0, así que
 * cancelar dos veces no devuelve el inventario dos veces.
 */
ventasRouter.post('/:id/cancelar', ...admin, async (c) => {
  const id = Number(c.req.param('id'));
  const { motivo } = await c.req.json().catch(() => ({}));

  const venta = await c.env.DB.prepare(
    `SELECT EstadoVenta, StockDevuelto, NumeroPedido FROM Ventas WHERE VentaID = ?`
  ).bind(id).first<{ EstadoVenta: string; StockDevuelto: number; NumeroPedido: string | null }>();

  if (!venta) return c.json({ success: false, message: 'Pedido no encontrado' }, 404);
  if (venta.EstadoVenta === 'Cancelado') {
    return c.json({ success: false, message: 'El pedido ya estaba cancelado' }, 409);
  }
  if (venta.EstadoVenta === 'Entregado') {
    return c.json({ success: false, message: 'Un pedido entregado no se cancela' }, 409);
  }

  // Se lee el stock actual junto al detalle para poder anotar el antes y el
  // después de cada devolución en el historial.
  const { results: detalles } = await c.env.DB.prepare(
    `SELECT d.ProductoID, d.Cantidad, p.Stock
       FROM DetalleVenta d
       LEFT JOIN Productos p ON p.ProductoID = d.ProductoID
      WHERE d.VentaID = ?`
  ).bind(id).all<{ ProductoID: number; Cantidad: number; Stock: number }>();

  try {
    const devolver = venta.StockDevuelto === 0;
    const numero = venta.NumeroPedido ?? `#${id}`;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE Ventas SET EstadoVenta = 'Cancelado', StockDevuelto = 1 WHERE VentaID = ? AND StockDevuelto = 0`
      ).bind(id),
      ...(devolver
        ? detalles.flatMap((d) => {
            const anterior = Number(d.Stock) || 0;
            return [
              restoreStatement(c.env.DB, d.ProductoID, d.Cantidad),
              movementStatement(c.env.DB, {
                productoId: d.ProductoID,
                anterior,
                cambio: d.Cantidad,
                nuevo: anterior + d.Cantidad,
                motivo: 'Pedido cancelado',
                nota: `Pedido ${numero}`,
                ventaId: id,
                usuario: usuarioDe(c),
              }),
            ];
          })
        : []),
      historyStatement(
        c.env.DB,
        id,
        'Cancelado',
        motivo ? `Cancelado: ${motivo}` : 'Cancelado',
        usuarioDe(c)
      ),
    ]);

    // Que no se entere cuando pregunte: cancelar a mano avisa igual que la
    // cancelación automática por SINPE sin verificar. Solo correo: 'cancelado'
    // no tiene plantilla de WhatsApp aprobada.
    const envio = avisarPorCorreo(c.env as any, 'cancelado', id);
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(envio);

    return c.json({
      success: true,
      data: { EstadoVenta: 'Cancelado', existenciasDevueltas: devolver },
    });
  } catch (error: any) {
    console.error('ventas.cancelar', error?.message);
    return c.json({ success: false, message: 'No se pudo cancelar el pedido' }, 500);
  }
});

/** Marca el pedido como visto, para que deje de contar como nuevo. */
ventasRouter.patch('/:id/revisado', ...admin, async (c) => {
  const id = Number(c.req.param('id'));
  try {
    await c.env.DB.prepare(
      `UPDATE Ventas SET Revisado = 1, RevisadoEn = datetime('now','localtime')
        WHERE VentaID = ? AND Revisado = 0`
    ).bind(id).run();
    return c.json({ success: true, data: { Revisado: 1 } });
  } catch (error: any) {
    console.error('ventas.revisado', error?.message);
    return c.json({ success: false, message: 'No se pudo marcar como revisado' }, 500);
  }
});
