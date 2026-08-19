import { Hono } from 'hono';
import { LOW_STOCK_THRESHOLD } from '../lib/inventory';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  // IMAGES: R2Bucket; // Uncomment when R2 is enabled
};

export const productsRouter = new Hono<{ Bindings: Bindings }>();

// Public routes (GET) - no authentication required for PWA

// Get all products
productsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      p.*,
      c.Nombre as CategoriaNombre,
      m.Nombre as MarcaNombre
    FROM Productos p
    LEFT JOIN Categorias c ON p.CategoriaID = c.CategoriaID
    LEFT JOIN Marcas m ON p.MarcaID = m.MarcaID
    WHERE p.Estado = 1
    ORDER BY p.FechaRegistro DESC
  `).all();
  
  return c.json({ success: true, data: results });
});

// Get product by ID
productsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT 
      p.*,
      c.Nombre as CategoriaNombre,
      m.Nombre as MarcaNombre
    FROM Productos p
    LEFT JOIN Categorias c ON p.CategoriaID = c.CategoriaID
    LEFT JOIN Marcas m ON p.MarcaID = m.MarcaID
    WHERE p.ProductoID = ? AND p.Estado = 1
  `).bind(id).all();
  
  if (results.length === 0) {
    return c.json({ success: false, message: 'Producto no encontrado' }, 404);
  }
  
  return c.json({ success: true, data: results[0] });
});

// Protected routes - require authentication

// Create product (admin only)
productsRouter.post('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const { Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock } = body;

  const result = await c.env.DB.prepare(`
    INSERT INTO Productos (Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock, Estado)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock || 0).run();

  return c.json({
    success: true,
    message: 'Producto creado exitosamente',
    data: { ProductoID: result.meta.last_row_id }
  }, 201);
});

// Update product (admin only)
productsRouter.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock } = body;

  await c.env.DB.prepare(`
    UPDATE Productos
    SET Nombre = ?, CategoriaID = ?, MarcaID = ?,
        PrecioCompra = ?, PrecioVenta = ?, Stock = ?
    WHERE ProductoID = ?
  `).bind(Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock, id).run();

  return c.json({ success: true, message: 'Producto actualizado exitosamente' });
});

// Delete product (admin only - soft delete)
productsRouter.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');

  await c.env.DB.prepare(`
    UPDATE Productos SET Estado = 0 WHERE ProductoID = ?
  `).bind(id).run();

  return c.json({ success: true, message: 'Producto eliminado exitosamente' });
});

// Get low stock products
// Cuánto queda de qué es información del negocio, no de la vitrina
productsRouter.get('/stock/bajo', authMiddleware, adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      p.*,
      c.Nombre as CategoriaNombre,
      m.Nombre as MarcaNombre
    FROM Productos p
    LEFT JOIN Categorias c ON p.CategoriaID = c.CategoriaID
    LEFT JOIN Marcas m ON p.MarcaID = m.MarcaID
    WHERE p.Stock <= ${LOW_STOCK_THRESHOLD} AND p.Estado = 1
    ORDER BY p.Stock ASC
  `).all();
  
  return c.json({ success: true, data: results });
});
