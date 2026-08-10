import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { DB: D1Database; };

export const dashboardRouter = new Hono<{ Bindings: Bindings }>();

// Get dashboard stats (admin only)
dashboardRouter.get('/stats', authMiddleware, adminMiddleware, async (c) => {
  // Total products
  const totalProducts = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM Productos WHERE Estado = 1
  `).first();
  
  // Today's sales
  const todaySales = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as cantidad,
      COALESCE(SUM(Total), 0) as total
    FROM Ventas 
    WHERE DATE(Fecha) = DATE('now')
  `).first();
  
  // Monthly profit estimate (sales - cost)
  const monthlyProfit = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(dv.SubTotal - (dv.PrecioCompra * dv.Cantidad)), 0) as ganancia
    FROM DetalleVenta dv
    JOIN Ventas v ON dv.VentaID = v.VentaID
    WHERE strftime('%Y-%m', v.Fecha) = strftime('%Y-%m', 'now')
  `).first();
  
  // Low stock count
  const lowStock = await c.env.DB.prepare(`
    SELECT COUNT(*) as total 
    FROM Productos 
    WHERE Stock <= 5 AND Estado = 1
  `).first();
  
  // Low stock products
  const { results: lowStockProducts } = await c.env.DB.prepare(`
    SELECT 
      p.ProductoID,
      p.Nombre,
      p.Stock,
      c.Nombre as Categoria,
      m.Nombre as Marca
    FROM Productos p
    LEFT JOIN Categorias c ON p.CategoriaID = c.CategoriaID
    LEFT JOIN Marcas m ON p.MarcaID = m.MarcaID
    WHERE p.Stock <= 5 AND p.Estado = 1
    ORDER BY p.Stock ASC
  `).all();
  
  return c.json({
    success: true,
    data: {
      totalProductos: totalProducts.total,
      ventasHoy: {
        cantidad: todaySales.cantidad,
        total: todaySales.total
      },
      gananciaMes: monthlyProfit.ganancia,
      stockBajo: lowStock.total,
      productosStockBajo: lowStockProducts
    }
  });
});

// Get monthly sales chart data
dashboardRouter.get('/ventas-mensuales', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      strftime('%Y-%m', Fecha) as mes,
      SUM(Total) as total,
      COUNT(*) as cantidad
    FROM Ventas
    WHERE Fecha >= date('now', '-6 months')
    GROUP BY strftime('%Y-%m', Fecha)
    ORDER BY mes ASC
  `).all();
  
  return c.json({ success: true, data: results });
});

// Get recent sales
dashboardRouter.get('/ventas-recientes', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM Ventas 
    ORDER BY Fecha DESC 
    LIMIT 10
  `).all();
  
  return c.json({ success: true, data: results });
});

// Get best selling products
dashboardRouter.get('/productos-populares', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      p.ProductoID,
      p.Nombre,
      SUM(dv.Cantidad) as TotalVendido,
      SUM(dv.SubTotal) as TotalIngresos,
      c.Nombre as Categoria,
      m.Nombre as Marca
    FROM DetalleVenta dv
    JOIN Productos p ON dv.ProductoID = p.ProductoID
    LEFT JOIN Categorias c ON p.CategoriaID = c.CategoriaID
    LEFT JOIN Marcas m ON p.MarcaID = m.MarcaID
    JOIN Ventas v ON dv.VentaID = v.VentaID
    WHERE v.Fecha >= date('now', '-30 days')
    GROUP BY p.ProductoID
    ORDER BY TotalVendido DESC
    LIMIT 10
  `).all();
  
  return c.json({ success: true, data: results });
});
