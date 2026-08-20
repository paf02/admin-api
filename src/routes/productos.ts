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

/**
 * Editar un producto ya publicado.
 *
 * Solo toca lo que venga en el cuerpo, para poder cambiar únicamente el
 * precio sin tener que reenviar el resto y arriesgarse a borrarlo.
 *
 * Las existencias quedan fuera a propósito: se ajustan en su propia pantalla,
 * que registra el movimiento y su motivo. Cambiarlas por acá dejaría el
 * inventario cuadrado pero sin explicación de por qué cambió.
 */
productsRouter.patch('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({} as any));

  const actual = await c.env.DB.prepare(
    `SELECT ProductoID, Nombre, CategoriaID FROM Productos WHERE ProductoID = ?`
  )
    .bind(id)
    .first<{ ProductoID: number; Nombre: string; CategoriaID: number }>();

  if (!actual) return c.json({ success: false, message: 'No existe ese producto' }, 404);

  const campos: string[] = [];
  const valores: unknown[] = [];

  const texto = (v: unknown) => String(v ?? '').trim();
  const poner = (columna: string, valor: unknown) => {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  };

  // El nombre se maneja aparte: renombrar la botella obliga a renombrar sus
  // decants (más abajo), porque la tienda los agrupa por el nombre base.
  const nombre = texto(body.nombre);
  const renombra = nombre && nombre !== actual.Nombre;

  if (renombra) {
    const chocado = await c.env.DB.prepare(
      `SELECT ProductoID FROM Productos WHERE lower(Nombre) = lower(?) AND ProductoID <> ?`
    )
      .bind(nombre, id)
      .first();

    if (chocado) {
      return c.json({ success: false, message: `Ya hay otro producto llamado «${nombre}».` }, 409);
    }
    poner('Nombre', nombre);
  }

  if (body.precioVenta !== undefined) {
    const precio = Number(body.precioVenta);
    if (!Number.isFinite(precio) || precio <= 0) {
      return c.json({ success: false, message: 'El precio de venta no es válido' }, 400);
    }
    poner('PrecioVenta', precio);
  }

  if (body.precioCompra !== undefined) {
    const costo = Number(body.precioCompra);
    if (!Number.isFinite(costo) || costo < 0) {
      return c.json({ success: false, message: 'El costo no es válido' }, 400);
    }
    poner('PrecioCompra', costo);
  }

  if (body.imagenUrl !== undefined) poner('ImagenURL', texto(body.imagenUrl) || null);
  if (body.familia !== undefined) poner('Familia', texto(body.familia) || null);
  if (body.notasSalida !== undefined) poner('NotasSalida', texto(body.notasSalida) || null);
  if (body.notasCorazon !== undefined) poner('NotasCorazon', texto(body.notasCorazon) || null);
  if (body.notasFondo !== undefined) poner('NotasFondo', texto(body.notasFondo) || null);

  // Estado 0 lo saca de la tienda sin borrarlo: los pedidos viejos siguen
  // mostrando qué se vendió.
  if (body.activo !== undefined) poner('Estado', body.activo ? 1 : 0);

  if (!campos.length) return c.json({ success: false, message: 'No hay nada que cambiar' }, 400);

  try {
    const sentencias = [
      c.env.DB.prepare(`UPDATE Productos SET ${campos.join(', ')} WHERE ProductoID = ?`).bind(
        ...valores,
        id
      ),
    ];

    // Si se renombró una botella sellada, sus decants tienen que seguirla: el
    // decant se llama «<nombre de la botella> — Decant Nml», y si el nombre
    // base deja de coincidir, la tienda los muestra como fragancias sueltas.
    if (renombra) {
      sentencias.push(
        c.env.DB.prepare(
          `UPDATE Productos
              SET Nombre = ? || substr(Nombre, ?)
            WHERE Nombre LIKE ? || ' — Decant%'`
        ).bind(nombre, actual.Nombre.length + 1, actual.Nombre)
      );
    }

    // La imagen también: los decants muestran la foto de su botella.
    if (body.imagenUrl !== undefined) {
      sentencias.push(
        c.env.DB.prepare(
          `UPDATE Productos SET ImagenURL = ? WHERE Nombre LIKE ? || ' — Decant%'`
        ).bind(texto(body.imagenUrl) || null, renombra ? nombre : actual.Nombre)
      );
    }

    await c.env.DB.batch(sentencias);

    return c.json({ success: true, message: 'Producto actualizado' });
  } catch (error: any) {
    console.error('productos.editar', error?.message);
    return c.json({ success: false, message: 'No se pudo guardar el cambio' }, 500);
  }
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
