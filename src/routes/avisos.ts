import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { DB: D1Database };

export const avisosRouter = new Hono<{ Bindings: Bindings }>();

const admin = [authMiddleware, adminMiddleware] as const;

/**
 * «Avisame cuando llegue».
 *
 * Pública porque la usa quien está viendo un producto agotado. Guarda un
 * número de WhatsApp y nada más, y solo si el producto existe y de verdad está
 * sin existencias: no sirve como formulario para juntar teléfonos.
 */
avisosRouter.post('/', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const productoId = Number(body?.productoId);
  const telefono = String(body?.telefono ?? '').replace(/[\s-]/g, '');

  if (!Number.isFinite(productoId)) {
    return c.json({ success: false, message: 'Producto inválido' }, 400);
  }
  if (!/^(?:\+?506)?[2-8]\d{7}$/.test(telefono)) {
    return c.json({ success: false, message: 'Escribí un número de 8 dígitos' }, 400);
  }

  try {
    const producto: any = await c.env.DB.prepare(
      `SELECT ProductoID, Stock, Estado FROM Productos WHERE ProductoID = ?`
    ).bind(productoId).first();

    if (!producto || !producto.Estado) {
      return c.json({ success: false, message: 'Ese producto ya no está disponible' }, 404);
    }
    if (Number(producto.Stock) > 0) {
      return c.json({ success: false, message: 'Ese producto ya tiene existencias' }, 409);
    }

    await c.env.DB.prepare(
      `INSERT INTO AvisosStock (ProductoID, Telefono) VALUES (?, ?)
       ON CONFLICT(ProductoID, Telefono) DO UPDATE SET Avisado = 0`
    ).bind(productoId, telefono).run();

    return c.json({ success: true, message: 'Listo, te avisamos apenas vuelva' });
  } catch (error: any) {
    console.error('avisos.crear', error?.message);
    return c.json({ success: false, message: 'No se pudo anotar el aviso' }, 500);
  }
});

/** Quién espera qué. Con el stock actual al lado, para saber a quién escribirle. */
avisosRouter.get('/', ...admin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         a.ProductoID,
         p.Nombre,
         p.Stock,
         COUNT(*) AS Esperando,
         SUM(CASE WHEN a.Avisado = 0 THEN 1 ELSE 0 END) AS SinAvisar,
         MAX(a.CreadoEn) AS Ultimo,
         group_concat(CASE WHEN a.Avisado = 0 THEN a.Telefono END) AS Telefonos
       FROM AvisosStock a
       LEFT JOIN Productos p ON p.ProductoID = a.ProductoID
       GROUP BY a.ProductoID
       ORDER BY SinAvisar DESC, Ultimo DESC`
    ).all();

    return c.json({
      success: true,
      data: (results as any[]).map((fila) => ({
        ...fila,
        Telefonos: String(fila.Telefonos || '').split(',').filter(Boolean),
      })),
    });
  } catch (error: any) {
    console.error('avisos.listar', error?.message);
    return c.json({ success: false, message: 'No se pudieron cargar los avisos' }, 500);
  }
});

/** Marca como avisada a la gente de un producto, una vez que se le escribió. */
avisosRouter.patch('/:productoId', ...admin, async (c) => {
  try {
    await c.env.DB.prepare(
      `UPDATE AvisosStock
          SET Avisado = 1, AvisadoEn = datetime('now','localtime')
        WHERE ProductoID = ? AND Avisado = 0`
    ).bind(c.req.param('productoId')).run();

    return c.json({ success: true, message: 'Marcados como avisados' });
  } catch (error: any) {
    console.error('avisos.marcar', error?.message);
    return c.json({ success: false, message: 'No se pudo marcar' }, 500);
  }
});
