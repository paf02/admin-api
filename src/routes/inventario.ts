import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import {
  DERIVED_COLUMNS,
  LOW_STOCK_THRESHOLD,
  isReason,
  movementStatement,
} from '../lib/inventory';

type Bindings = { DB: D1Database };

export const inventarioRouter = new Hono<{ Bindings: Bindings }>();

/** Ver y mover existencias es operación interna: todo pasa por admin. */
const admin = [authMiddleware, adminMiddleware] as const;

const usuarioDe = (c: any) => c.get('user')?.username ?? null;

const ORDER_BY: Record<string, string> = {
  'stock-asc': 'p.Stock ASC, p.Nombre ASC',
  'stock-desc': 'p.Stock DESC, p.Nombre ASC',
  nombre: 'p.Nombre ASC',
  actualizado: 'COALESCE(p.StockActualizadoEn, p.FechaRegistro) DESC',
};

/**
 * Listado de existencias.
 *
 * Tipo, género, tamaño y concentración se derivan en SQL (ver DERIVED_COLUMNS)
 * para que filtrar y ordenar usen exactamente el mismo criterio que muestra la
 * pantalla.
 */
inventarioRouter.get('/', ...admin, async (c) => {
  const { q, tipo, genero, estadoStock, marca, orden } = c.req.query();

  const where = ['p.Estado = 1'];
  const binds: unknown[] = [];

  if (q) {
    where.push('(p.Nombre LIKE ? OR m.Nombre LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (marca) {
    where.push('m.MarcaID = ?');
    binds.push(marca);
  }
  if (tipo === 'Decant') where.push("cat.Nombre LIKE 'Decants%'");
  if (tipo === 'Perfume sellado') where.push("cat.Nombre NOT LIKE 'Decants%'");
  if (genero === 'Hombre') where.push("cat.Nombre LIKE '%Hombre%'");
  if (genero === 'Mujer') where.push("cat.Nombre LIKE '%Mujer%'");

  if (estadoStock === 'Agotado') where.push('p.Stock = 0');
  if (estadoStock === 'Bajo') where.push(`p.Stock > 0 AND p.Stock <= ${LOW_STOCK_THRESHOLD}`);
  if (estadoStock === 'Disponible') where.push(`p.Stock > ${LOW_STOCK_THRESHOLD}`);

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT
        p.ProductoID, p.Nombre, p.Stock, p.PrecioVenta, p.PrecioCompra,
        p.ImagenURL, p.FechaRegistro, p.StockActualizadoEn,
        m.Nombre AS MarcaNombre, m.MarcaID,
        cat.Nombre AS CategoriaNombre,
        ${DERIVED_COLUMNS}
      FROM Productos p
      LEFT JOIN Marcas     m   ON p.MarcaID = m.MarcaID
      LEFT JOIN Categorias cat ON p.CategoriaID = cat.CategoriaID
      WHERE ${where.join(' AND ')}
      ORDER BY ${ORDER_BY[orden as string] ?? ORDER_BY['stock-asc']}
    `).bind(...binds).all();

    return c.json({ success: true, data: results, umbralBajo: LOW_STOCK_THRESHOLD });
  } catch (error: any) {
    console.error('inventario.list', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el inventario' }, 500);
  }
});

/** Tarjetas del panel. */
inventarioRouter.get('/resumen', ...admin, async (c) => {
  try {
    const row = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN Stock = 0 THEN 1 ELSE 0 END) AS Agotados,
        SUM(CASE WHEN Stock > 0 AND Stock <= ${LOW_STOCK_THRESHOLD} THEN 1 ELSE 0 END) AS Bajos,
        COUNT(*) AS Activos,
        COALESCE(SUM(Stock), 0) AS Unidades
      FROM Productos WHERE Estado = 1
    `).first();

    const ajustes = await c.env.DB.prepare(`
      SELECT COUNT(*) AS AjustesHoy FROM MovimientosInventario
       WHERE date(Fecha) = date('now','localtime') AND VentaID IS NULL
    `).first();

    return c.json({
      success: true,
      data: { ...row, ...ajustes, umbralBajo: LOW_STOCK_THRESHOLD },
    });
  } catch (error: any) {
    console.error('inventario.resumen', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el resumen' }, 500);
  }
});

/** Historial global de movimientos. */
inventarioRouter.get('/movimientos', ...admin, async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 100, 300);
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT mv.*, p.Nombre AS ProductoNombre, v.NumeroPedido
        FROM MovimientosInventario mv
        LEFT JOIN Productos p ON p.ProductoID = mv.ProductoID
        LEFT JOIN Ventas    v ON v.VentaID = mv.VentaID
       ORDER BY mv.MovimientoID DESC
       LIMIT ?
    `).bind(limit).all();
    return c.json({ success: true, data: results });
  } catch (error: any) {
    console.error('inventario.movimientos', error?.message);
    return c.json({ success: false, message: 'No se pudo cargar el historial' }, 500);
  }
});

/** Ficha operativa de un producto: existencias, movimientos y pedidos recientes. */
inventarioRouter.get('/:id', ...admin, async (c) => {
  const id = c.req.param('id');

  const producto = await c.env.DB.prepare(`
    SELECT
      p.*, m.Nombre AS MarcaNombre, cat.Nombre AS CategoriaNombre,
      ${DERIVED_COLUMNS}
    FROM Productos p
    LEFT JOIN Marcas     m   ON p.MarcaID = m.MarcaID
    LEFT JOIN Categorias cat ON p.CategoriaID = cat.CategoriaID
    WHERE p.ProductoID = ?
  `).bind(id).first();

  if (!producto) return c.json({ success: false, message: 'Producto no encontrado' }, 404);

  const { results: movimientos } = await c.env.DB.prepare(`
    SELECT mv.*, v.NumeroPedido
      FROM MovimientosInventario mv
      LEFT JOIN Ventas v ON v.VentaID = mv.VentaID
     WHERE mv.ProductoID = ?
     ORDER BY mv.MovimientoID DESC
     LIMIT 50
  `).bind(id).all();

  const { results: pedidos } = await c.env.DB.prepare(`
    SELECT v.VentaID, v.NumeroPedido, v.Fecha, v.Cliente, v.EstadoVenta, d.Cantidad
      FROM DetalleVenta d
      JOIN Ventas v ON v.VentaID = d.VentaID
     WHERE d.ProductoID = ?
     ORDER BY v.VentaID DESC
     LIMIT 10
  `).bind(id).all();

  return c.json({ success: true, data: { ...producto, movimientos, pedidos } });
});

/**
 * Ajuste manual.
 *
 * Tres operaciones sobre la misma ruta: agregar, quitar y fijar. El valor
 * final se calcula y se aplica en un UPDATE con guarda, no leyendo el stock
 * primero y escribiéndolo después, para que un ajuste y una venta simultánea
 * no se pisen.
 *
 * Nunca deja el stock negativo: quitar más de lo que hay se rechaza con el
 * número disponible, en vez de dejarlo en cero en silencio.
 */
inventarioRouter.patch('/:id/stock', ...admin, async (c) => {
  const id = Number(c.req.param('id'));
  const { operacion, cantidad, motivo, nota } = await c.req.json().catch(() => ({} as any));

  const n = Math.floor(Number(cantidad));
  if (!Number.isFinite(n) || n < 0) {
    return c.json({ success: false, message: 'Cantidad inválida' }, 400);
  }
  if (!['agregar', 'quitar', 'fijar'].includes(operacion)) {
    return c.json({ success: false, message: 'Operación inválida' }, 400);
  }
  if (motivo && !isReason(motivo)) {
    return c.json({ success: false, message: 'Motivo no reconocido' }, 400);
  }

  const producto = await c.env.DB.prepare(
    `SELECT Nombre, Stock FROM Productos WHERE ProductoID = ?`
  ).bind(id).first<{ Nombre: string; Stock: number }>();

  if (!producto) return c.json({ success: false, message: 'Producto no encontrado' }, 404);

  const anterior = Number(producto.Stock) || 0;
  const nuevo = operacion === 'agregar' ? anterior + n : operacion === 'quitar' ? anterior - n : n;

  if (nuevo < 0) {
    return c.json(
      { success: false, message: `Solo hay ${anterior} en existencia; no se pueden quitar ${n}.` },
      409
    );
  }
  if (nuevo === anterior) {
    return c.json({ success: true, data: { Stock: anterior }, message: 'Sin cambios' });
  }

  try {
    // La condición `Stock = ?` es el seguro contra escrituras simultáneas: si
    // alguien movió el stock entre la lectura y esta escritura, no aplica.
    const res = await c.env.DB.prepare(
      `UPDATE Productos
          SET Stock = ?, StockActualizadoEn = datetime('now','localtime')
        WHERE ProductoID = ? AND Stock = ?`
    ).bind(nuevo, id, anterior).run();

    if (res.meta.changes !== 1) {
      return c.json(
        { success: false, message: 'Las existencias cambiaron mientras editabas. Volvé a intentar.' },
        409
      );
    }

    await movementStatement(c.env.DB, {
      productoId: id,
      anterior,
      cambio: nuevo - anterior,
      nuevo,
      motivo: motivo || 'Corrección de inventario',
      nota: nota || null,
      usuario: usuarioDe(c),
    }).run();

    return c.json({ success: true, data: { Stock: nuevo, StockAnterior: anterior } });
  } catch (error: any) {
    console.error('inventario.ajuste', error?.message);
    return c.json({ success: false, message: 'No se pudo actualizar las existencias' }, 500);
  }
});
