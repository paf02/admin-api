import { Hono } from 'hono';

type Bindings = { DB: D1Database; };

export const marcasRouter = new Hono<{ Bindings: Bindings }>();

// Get all brands
marcasRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      m.*,
      COUNT(p.ProductoID) as ProductosAsociados
    FROM Marcas m
    LEFT JOIN Productos p ON m.MarcaID = p.MarcaID AND p.Estado = 1
    WHERE m.Estado = 1
    GROUP BY m.MarcaID
    ORDER BY m.Nombre
  `).all();
  
  return c.json({ success: true, data: results });
});

// Create brand
marcasRouter.post('/', async (c) => {
  const { Nombre } = await c.req.json();
  
  const result = await c.env.DB.prepare(`
    INSERT INTO Marcas (Nombre, Estado) VALUES (?, 1)
  `).bind(Nombre).run();
  
  return c.json({ 
    success: true, 
    message: 'Marca creada exitosamente',
    data: { MarcaID: result.meta.last_row_id }
  }, 201);
});

// Update brand
marcasRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const { Nombre } = await c.req.json();
  
  await c.env.DB.prepare(`
    UPDATE Marcas SET Nombre = ? WHERE MarcaID = ?
  `).bind(Nombre, id).run();
  
  return c.json({ success: true, message: 'Marca actualizada exitosamente' });
});

// Delete brand
marcasRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(`
    UPDATE Marcas SET Estado = 0 WHERE MarcaID = ?
  `).bind(id).run();
  
  return c.json({ success: true, message: 'Marca eliminada exitosamente' });
});
