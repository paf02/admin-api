import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { DB: D1Database };

export const reportesRouter = new Hono<{ Bindings: Bindings }>();

/** Números del negocio: solo con sesión de administrador. */
const admin = [authMiddleware, adminMiddleware] as const;

/**
 * Ganancia real, no solo lo facturado.
 *
 * Cada línea vendida guarda el precio de compra del momento, así que la
 * ganancia sale de restar eso a lo cobrado —no de un margen supuesto ni del
 * costo actual del producto, que pudo cambiar después de la venta.
 *
 * Dos cosas que este reporte no mezcla:
 * - Los pedidos cancelados quedan afuera: no son venta.
 * - El envío cobrado se muestra aparte. Es dinero que entra y sale hacia quien
 *   transporta; sumarlo a la ganancia la inflaría.
 *
 * Y una que avisa: si alguna línea se vendió sin costo registrado, la ganancia
 * queda sobrestimada y el reporte lo dice en vez de disimularlo.
 */
reportesRouter.get('/ganancias', ...admin, async (c) => {
  const desde = c.req.query('desde') || '';
  const hasta = c.req.query('hasta') || '';
  const soloEntregados = c.req.query('soloEntregados') === '1';

  const filtros: string[] = [`v.EstadoVenta <> 'Cancelado'`];
  const binds: unknown[] = [];

  if (soloEntregados) filtros.push(`v.EstadoVenta = 'Entregado'`);
  if (desde) {
    filtros.push(`date(v.Fecha) >= date(?)`);
    binds.push(desde);
  }
  if (hasta) {
    filtros.push(`date(v.Fecha) <= date(?)`);
    binds.push(hasta);
  }

  const donde = filtros.join(' AND ');

  try {
    const resumen: any = await c.env.DB.prepare(
      `SELECT
         COUNT(DISTINCT v.VentaID)                          AS Pedidos,
         COALESCE(SUM(d.Cantidad), 0)                       AS Unidades,
         COALESCE(SUM(d.SubTotal), 0)                       AS Ingresos,
         COALESCE(SUM(d.PrecioCompra * d.Cantidad), 0)      AS Costo,
         SUM(CASE WHEN COALESCE(d.PrecioCompra, 0) = 0 THEN 1 ELSE 0 END) AS LineasSinCosto
       FROM DetalleVenta d
       JOIN Ventas v ON v.VentaID = d.VentaID
       WHERE ${donde}`
    ).bind(...binds).first();

    const envios: any = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(v.CostoEnvio), 0) AS Envios
         FROM Ventas v WHERE ${donde}`
    ).bind(...binds).first();

    const { results: porMes } = await c.env.DB.prepare(
      `SELECT
         strftime('%Y-%m', v.Fecha)                    AS Mes,
         COUNT(DISTINCT v.VentaID)                     AS Pedidos,
         COALESCE(SUM(d.SubTotal), 0)                  AS Ingresos,
         COALESCE(SUM(d.PrecioCompra * d.Cantidad), 0) AS Costo
       FROM DetalleVenta d
       JOIN Ventas v ON v.VentaID = d.VentaID
       WHERE ${donde}
       GROUP BY Mes
       ORDER BY Mes DESC
       LIMIT 12`
    ).bind(...binds).all();

    const { results: porProducto } = await c.env.DB.prepare(
      `SELECT
         d.ProductoID,
         COALESCE(p.Nombre, d.NombreProducto)          AS Nombre,
         COALESCE(SUM(d.Cantidad), 0)                  AS Unidades,
         COALESCE(SUM(d.SubTotal), 0)                  AS Ingresos,
         COALESCE(SUM(d.PrecioCompra * d.Cantidad), 0) AS Costo
       FROM DetalleVenta d
       JOIN Ventas v ON v.VentaID = d.VentaID
       LEFT JOIN Productos p ON p.ProductoID = d.ProductoID
       WHERE ${donde}
       GROUP BY d.ProductoID
       ORDER BY (COALESCE(SUM(d.SubTotal), 0) - COALESCE(SUM(d.PrecioCompra * d.Cantidad), 0)) DESC
       LIMIT 20`
    ).bind(...binds).all();

    const conGanancia = (fila: any) => {
      const ingresos = Number(fila.Ingresos) || 0;
      const costo = Number(fila.Costo) || 0;
      const ganancia = ingresos - costo;
      return {
        ...fila,
        Ingresos: ingresos,
        Costo: costo,
        Ganancia: ganancia,
        // Margen sobre lo vendido; sin ventas no hay margen que mostrar
        Margen: ingresos > 0 ? Number(((ganancia / ingresos) * 100).toFixed(1)) : null,
      };
    };

    return c.json({
      success: true,
      data: {
        resumen: {
          ...conGanancia(resumen || {}),
          Pedidos: Number(resumen?.Pedidos) || 0,
          Unidades: Number(resumen?.Unidades) || 0,
          LineasSinCosto: Number(resumen?.LineasSinCosto) || 0,
          EnviosCobrados: Number(envios?.Envios) || 0,
        },
        porMes: (porMes as any[]).map(conGanancia).reverse(),
        porProducto: (porProducto as any[]).map(conGanancia),
      },
    });
  } catch (error: any) {
    console.error('reportes.ganancias', error?.message);
    return c.json({ success: false, message: 'No se pudo calcular la ganancia' }, 500);
  }
});
