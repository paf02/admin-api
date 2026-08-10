import { Hono } from 'hono';

type Bindings = { DB: D1Database; };

export const categoriasRouter = new Hono<{ Bindings: Bindings }>();

// Get all categories
categoriasRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      c.*,
      COUNT(p.ProductoID) as ProductosAsociados
    FROM Categorias c
    LEFT JOIN Productos p ON c.CategoriaID = p.CategoriaID AND p.Estado = 1
    WHERE c.Estado = 1
    GROUP BY c.CategoriaID
    ORDER BY c.Nombre
  `).all();
  
  return c.json({ success: true, data: results });
});

// Create category
categoriasRouter.post('/', async (c) => {
  const { Nombre } = await c.req.json();
  
  const result = await c.env.DB.prepare(`
    INSERT INTO Categorias (Nombre, Estado) VALUES (?, 1)
  `).bind(Nombre).run();
  
  return c.json({ 
    success: true, 
    message: 'Categoría creada exitosamente',
    data: { CategoriaID: result.meta.last_row_id }
  }, 201);
});

// Update category
categoriasRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const { Nombre } = await c.req.json();
  
  await c.env.DB.prepare(`
    UPDATE Categorias SET Nombre = ? WHERE CategoriaID = ?
  `).bind(Nombre, id).run();
  
  return c.json({ success: true, message: 'Categoría actualizada exitosamente' });
});

// Delete category
categoriasRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(`
    UPDATE Categorias SET Estado = 0 WHERE CategoriaID = ?
  `).bind(id).run();
  
  return c.json({ success: true, message: 'Categoría eliminada exitosamente' });
});
