import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { DB: D1Database; };

export const ventasRouter = new Hono<{ Bindings: Bindings }>();

// Get all sales (admin only)
ventasRouter.get('/', authMiddleware, adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM Ventas
    ORDER BY Fecha DESC
    LIMIT 100
  `).all();

  return c.json({ success: true, data: results });
});

// Get sale by ID with details
ventasRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const sale = await c.env.DB.prepare(`
    SELECT * FROM Ventas WHERE VentaID = ?
  `).bind(id).first();
  
  if (!sale) {
    return c.json({ success: false, message: 'Venta no encontrada' }, 404);
  }
  
  const { results: details } = await c.env.DB.prepare(`
    SELECT 
      dv.*,
      p.Nombre as ProductoNombre
    FROM DetalleVenta dv
    LEFT JOIN Productos p ON dv.ProductoID = p.ProductoID
    WHERE dv.VentaID = ?
  `).bind(id).all();
  
  return c.json({ 
    success: true, 
    data: { ...sale, detalles: details }
  });
});

// Create new sale (public - for PWA customers)
ventasRouter.post('/', async (c) => {
  const body = await c.req.json();
  const { Cliente, Telefono, MetodoPago, Observacion, Total, productos } = body;
  
  try {
    // Insert sale
    const saleResult = await c.env.DB.prepare(`
      INSERT INTO Ventas (Cliente, Telefono, MetodoPago, Observacion, Total, EstadoVenta)
      VALUES (?, ?, ?, ?, ?, 'Pendiente')
    `).bind(Cliente, Telefono || null, MetodoPago, Observacion || null, Total).run();
    
    const ventaID = saleResult.meta.last_row_id;
    
    // Insert sale details and update stock
    for (const item of productos) {
      await c.env.DB.prepare(`
        INSERT INTO DetalleVenta (VentaID, ProductoID, Cantidad, PrecioCompra, Precio, SubTotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        ventaID, 
        item.ProductoID, 
        item.Cantidad, 
        item.PrecioCompra,
        item.Precio, 
        item.SubTotal
      ).run();
      
      // Update stock
      await c.env.DB.prepare(`
        UPDATE Productos 
        SET Stock = Stock - ? 
        WHERE ProductoID = ?
      `).bind(item.Cantidad, item.ProductoID).run();
    }
    
    return c.json({ 
      success: true, 
      message: 'Venta registrada exitosamente',
      data: { VentaID: ventaID }
    }, 201);
  } catch (error) {
    return c.json({ 
      success: false, 
      message: 'Error al registrar la venta',
      error: error.message 
    }, 500);
  }
});
