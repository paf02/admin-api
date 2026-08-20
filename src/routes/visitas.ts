import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { DB: D1Database };

export const visitasRouter = new Hono<{ Bindings: Bindings }>();

const admin = [authMiddleware, adminMiddleware] as const;

const EVENTOS = new Set(['vista', 'producto', 'carrito', 'checkout', 'pedido']);
const DISPOSITIVOS = new Set(['movil', 'escritorio']);

/**
 * Registro de visita.
 *
 * Público porque lo llama la tienda, y a propósito minimalista: entra el tipo
 * de evento, la ruta, el dominio de origen y si fue teléfono o computadora.
 * Nada de IP, cookies ni identificadores de persona; lo único que ata eventos
 * entre sí es un número al azar que vive mientras la pestaña esté abierta.
 *
 * Siempre responde 204, incluso ante basura: un contador no puede convertirse
 * en una forma de saber qué acepta el servidor.
 */
visitasRouter.post('/', async (c) => {
  try {
    const body: any = await c.req.json();
    const evento = String(body?.evento ?? '');
    if (!EVENTOS.has(evento)) return c.body(null, 204);

    const ruta = String(body?.ruta ?? '').slice(0, 120) || null;
    const sesion = String(body?.sesion ?? '').slice(0, 40) || null;
    const dispositivo = DISPOSITIVOS.has(body?.dispositivo) ? body.dispositivo : null;

    // Del referente solo el dominio: la dirección completa puede llevar datos
    let origen: string | null = null;
    const referente = String(body?.origen ?? '');
    if (referente) {
      try {
        origen = new URL(referente).hostname.slice(0, 80);
      } catch {
        origen = null;
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO Visitas (Evento, Ruta, Origen, Dispositivo, Sesion) VALUES (?, ?, ?, ?, ?)`
    ).bind(evento, ruta, origen, dispositivo, sesion).run();
  } catch {
    /* una visita perdida no es motivo para devolver un error a la tienda */
  }

  return c.body(null, 204);
});

/**
 * Resumen para el panel.
 *
 * Responde las dos preguntas que importan: cuánta gente entra, y dónde se cae
 * el que no compra.
 */
visitasRouter.get('/resumen', ...admin, async (c) => {
  const dias = Math.min(Math.max(Number(c.req.query('dias')) || 14, 1), 90);
  const desde = `-${dias} days`;

  try {
    const { results: porDia } = await c.env.DB.prepare(
      `SELECT Dia,
              COUNT(DISTINCT Sesion) AS Sesiones,
              COUNT(*) AS Vistas
         FROM Visitas
        WHERE Dia >= date('now', 'localtime', ?)
        GROUP BY Dia ORDER BY Dia`
    ).bind(desde).all();

    const embudo: any = await c.env.DB.prepare(
      `SELECT
         COUNT(DISTINCT Sesion) AS Sesiones,
         COUNT(DISTINCT CASE WHEN Evento = 'producto' THEN Sesion END) AS VieronProducto,
         COUNT(DISTINCT CASE WHEN Evento = 'carrito'  THEN Sesion END) AS Carrito,
         COUNT(DISTINCT CASE WHEN Evento = 'checkout' THEN Sesion END) AS Checkout,
         COUNT(DISTINCT CASE WHEN Evento = 'pedido'   THEN Sesion END) AS Pedido
       FROM Visitas WHERE Dia >= date('now', 'localtime', ?)`
    ).bind(desde).first();

    const { results: rutas } = await c.env.DB.prepare(
      `SELECT Ruta, COUNT(*) AS Vistas
         FROM Visitas
        WHERE Ruta IS NOT NULL AND Dia >= date('now', 'localtime', ?)
        GROUP BY Ruta ORDER BY Vistas DESC LIMIT 12`
    ).bind(desde).all();

    const { results: origenes } = await c.env.DB.prepare(
      `SELECT COALESCE(Origen, 'directo') AS Origen, COUNT(DISTINCT Sesion) AS Sesiones
         FROM Visitas
        WHERE Dia >= date('now', 'localtime', ?)
        GROUP BY Origen ORDER BY Sesiones DESC LIMIT 8`
    ).bind(desde).all();

    const { results: dispositivos } = await c.env.DB.prepare(
      `SELECT COALESCE(Dispositivo, 'sin dato') AS Dispositivo, COUNT(DISTINCT Sesion) AS Sesiones
         FROM Visitas
        WHERE Dia >= date('now', 'localtime', ?)
        GROUP BY Dispositivo ORDER BY Sesiones DESC`
    ).bind(desde).all();

    return c.json({
      success: true,
      data: { dias, porDia, embudo, rutas, origenes, dispositivos },
    });
  } catch (error: any) {
    console.error('visitas.resumen', error?.message);
    return c.json({ success: false, message: 'No se pudieron cargar las visitas' }, 500);
  }
});
