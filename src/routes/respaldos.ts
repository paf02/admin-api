import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { guardarRespaldo, armarRespaldo, type RespaldoEnv } from '../lib/respaldo';

type Bindings = RespaldoEnv;

export const respaldosRouter = new Hono<{ Bindings: Bindings }>();

/** Los respaldos llevan datos de clientes: solo con sesión de administrador. */
const admin = [authMiddleware, adminMiddleware] as const;

/** Qué respaldos hay guardados. */
respaldosRouter.get('/', ...admin, async (c) => {
  if (!c.env.RESPALDOS) {
    return c.json({ success: false, message: 'El bucket de respaldos no está configurado' }, 503);
  }

  try {
    // Sin `include` R2 no devuelve los metadatos y la lista sale sin origen
    const lista = await c.env.RESPALDOS.list({
      prefix: 'respaldos/',
      include: ['customMetadata'],
    });
    const data = lista.objects
      .map((objeto) => ({
        archivo: objeto.key,
        nombre: objeto.key.replace('respaldos/', ''),
        bytes: objeto.size,
        fecha: objeto.uploaded,
        origen: objeto.customMetadata?.origen ?? null,
        pedidos: Number(objeto.customMetadata?.pedidos ?? 0),
      }))
      .sort((a, b) => b.archivo.localeCompare(a.archivo));

    return c.json({ success: true, data });
  } catch (error: any) {
    console.error('respaldos.list', error?.message);
    return c.json({ success: false, message: 'No se pudo leer la lista de respaldos' }, 500);
  }
});

/** Crea uno en el momento, sin esperar al de la madrugada. */
respaldosRouter.post('/', ...admin, async (c) => {
  const resultado = await guardarRespaldo(c.env, `manual:${c.get('user')?.username ?? '?'}`);

  if (!resultado.ok) {
    return c.json({ success: false, message: resultado.error || 'No se pudo crear el respaldo' }, 500);
  }

  return c.json({
    success: true,
    message: 'Respaldo creado',
    data: { archivo: resultado.archivo, bytes: resultado.bytes, filas: resultado.filas },
  });
});

/**
 * Descarga directa de la base, sin pasar por el bucket.
 *
 * Es el camino que importa cuando algo se rompió: da el archivo en la mano,
 * al día, aunque el respaldo programado haya fallado.
 */
respaldosRouter.get('/ahora', ...admin, async (c) => {
  try {
    const respaldo = await armarRespaldo(c.env, `descarga:${c.get('user')?.username ?? '?'}`);
    const nombre = `estelapura-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(JSON.stringify(respaldo, null, 1), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombre}"`,
      },
    });
  } catch (error: any) {
    console.error('respaldos.ahora', error?.message);
    return c.json({ success: false, message: 'No se pudo generar el respaldo' }, 500);
  }
});

/** Baja uno de los guardados. */
respaldosRouter.get('/:nombre', ...admin, async (c) => {
  if (!c.env.RESPALDOS) {
    return c.json({ success: false, message: 'El bucket de respaldos no está configurado' }, 503);
  }

  const nombre = c.req.param('nombre');
  // Solo nombres de archivo: nada de rutas hacia otras partes del bucket
  if (!/^[\w.-]+\.json$/.test(nombre)) {
    return c.json({ success: false, message: 'Nombre inválido' }, 400);
  }

  const objeto = await c.env.RESPALDOS.get(`respaldos/${nombre}`);
  if (!objeto) return c.json({ success: false, message: 'Respaldo no encontrado' }, 404);

  return new Response(objeto.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
});
