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

type Bindings = { DB: D1Database };

export const ventasRouter = new Hono<{ Bindings: Bindings }>();

/** Solo el panel puede leer pedidos: llevan nombre, teléfono y dirección. */
const admin = [authMiddleware, adminMiddleware] as const;

const usuarioDe = (c: any) => c.get('user')?.username ?? null;

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

  // Ambos métodos de entrega cotizan al coordinar, así que no se acepta un
  // monto arbitrario: o viene por confirmar, o es un número >= 0.
  const envioPorConfirmar = body.EnvioPorConfirmar ? 1 : 0;
  const costoEnvio = envioPorConfirmar ? 0 : Math.max(0, Number(body.CostoEnvio) || 0);
  const total = subtotal + costoEnvio;

  try {
    const insert = await c.env.DB.prepare(`
      INSERT INTO Ventas (
        Cliente, Telefono, Email,
        Provincia, Canton, Distrito, DireccionExacta, Waze,
        MetodoEntrega, CostoEnvio, EnvioPorConfirmar,
        MetodoPago, EstadoPago,
        EstadoVenta, Observacion, Total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
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
      total
    ).run();

    const ventaId = Number(insert.meta.last_row_id);
    const numero = orderNumberFrom(ventaId);

    // Detalle, descuento de stock, número y bitácora en un solo batch: si algo
    // falla, no queda un pedido a medias con stock ya descontado.
    const statements = [
      c.env.DB.prepare(`UPDATE Ventas SET NumeroPedido = ? WHERE VentaID = ?`).bind(numero, ventaId),
      ...detalles.flatMap((d) => [
        c.env.DB.prepare(
          `INSERT INTO DetalleVenta (VentaID, ProductoID, Cantidad, PrecioCompra, Precio, SubTotal, NombreProducto)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(ventaId, d.id, d.cantidad, d.compra, d.precio, d.sub, d.nombre),
        c.env.DB.prepare(
          `UPDATE Productos SET Stock = Stock - ? WHERE ProductoID = ? AND Stock >= ?`
        ).bind(d.cantidad, d.id, d.cantidad),
      ]),
      historyStatement(c.env.DB, ventaId, 'Creado', `Pedido ${numero} recibido`, null),
    ];

    await c.env.DB.batch(statements);

    await publish(
      buildOrderCreated({
        orderNumber: numero,
        customerName: cliente,
        total,
        paymentMethod: metodoPago,
        itemCount: detalles.reduce((n, d) => n + d.cantidad, 0),
      })
    );

    return c.json(
      { success: true, message: 'Pedido registrado', data: { VentaID: ventaId, NumeroPedido: numero, Total: total } },
      201
    );
  } catch (error: any) {
    console.error('ventas.create', error?.message);
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

  const venta = await c.env.DB.prepare(`SELECT EstadoVenta FROM Ventas WHERE VentaID = ?`)
    .bind(id)
    .first<{ EstadoVenta: string }>();

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
    `SELECT EstadoPago, MetodoPago FROM Ventas WHERE VentaID = ?`
  ).bind(id).first<{ EstadoPago: string; MetodoPago: string }>();

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
    `SELECT EstadoVenta, StockDevuelto FROM Ventas WHERE VentaID = ?`
  ).bind(id).first<{ EstadoVenta: string; StockDevuelto: number }>();

  if (!venta) return c.json({ success: false, message: 'Pedido no encontrado' }, 404);
  if (venta.EstadoVenta === 'Cancelado') {
    return c.json({ success: false, message: 'El pedido ya estaba cancelado' }, 409);
  }
  if (venta.EstadoVenta === 'Entregado') {
    return c.json({ success: false, message: 'Un pedido entregado no se cancela' }, 409);
  }

  const { results: detalles } = await c.env.DB.prepare(
    `SELECT ProductoID, Cantidad FROM DetalleVenta WHERE VentaID = ?`
  ).bind(id).all<{ ProductoID: number; Cantidad: number }>();

  try {
    const devolver = venta.StockDevuelto === 0;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE Ventas SET EstadoVenta = 'Cancelado', StockDevuelto = 1 WHERE VentaID = ? AND StockDevuelto = 0`
      ).bind(id),
      ...(devolver
        ? detalles.map((d) =>
            c.env.DB.prepare(`UPDATE Productos SET Stock = Stock + ? WHERE ProductoID = ?`)
              .bind(d.Cantidad, d.ProductoID)
          )
        : []),
      historyStatement(
        c.env.DB,
        id,
        'Cancelado',
        motivo ? `Cancelado: ${motivo}` : 'Cancelado',
        usuarioDe(c)
      ),
    ]);

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
