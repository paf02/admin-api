import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

type Bindings = { FOTOS: R2Bucket };

export const fotosRouter = new Hono<{ Bindings: Bindings }>();

const admin = [authMiddleware, adminMiddleware] as const;

/** Formatos que un teléfono produce y un navegador muestra. */
const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 6 MB: una foto de teléfono sin editar entra de sobra. */
const MAX_BYTES = 6 * 1024 * 1024;

const limpiar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * Sube la foto de un producto.
 *
 * Hasta ahora las fotos vivían en el repositorio de la tienda, así que
 * publicar un perfume nuevo exigía editar código y desplegar. Con esto la
 * foto se sube desde el panel —o desde el teléfono, que es donde está la
 * cámara— y el producto queda publicado en el momento.
 */
fotosRouter.post('/', ...admin, async (c) => {
  try {
    const form = await c.req.formData();
    const archivo = form.get('foto');

    if (!(archivo instanceof File)) {
      return c.json({ success: false, message: 'No llegó ninguna imagen.' }, 400);
    }

    const extension = TIPOS[archivo.type];
    if (!extension) {
      return c.json(
        { success: false, message: 'La imagen debe ser JPG, PNG o WebP.' },
        415
      );
    }

    if (archivo.size > MAX_BYTES) {
      return c.json(
        { success: false, message: 'La imagen pesa más de 6 MB. Probá con una más liviana.' },
        413
      );
    }

    // El nombre lleva el del producto para poder reconocerlo en el bucket, y
    // un sufijo aleatorio para que volver a subir no pise la anterior ni
    // quede servida una versión vieja desde la caché.
    const nombre = limpiar(String(form.get('nombre') ?? '') || 'producto');
    const sufijo = crypto.randomUUID().slice(0, 8);
    const clave = `${nombre}-${sufijo}.${extension}`;

    await c.env.FOTOS.put(clave, archivo.stream(), {
      httpMetadata: {
        contentType: archivo.type,
        // Inmutable: la clave cambia con cada subida, así que nunca hay que
        // invalidar nada.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // Absoluta, no relativa: la tienda corre en otro dominio y esta URL se
    // guarda tal cual en `ImagenURL`, de donde sale el `src` de la imagen.
    const url = new URL(`/api/fotos/${clave}`, c.req.url).toString();

    return c.json({ success: true, data: { clave, url } }, 201);
  } catch (error: any) {
    console.error('fotos.subir', error?.message);
    return c.json({ success: false, message: 'No se pudo subir la imagen.' }, 500);
  }
});

/**
 * Entrega la foto. Es pública a propósito: la muestra la tienda a cualquiera
 * que vea el catálogo, igual que cualquier imagen de producto.
 */
fotosRouter.get('/:clave', async (c) => {
  const clave = c.req.param('clave');

  const objeto = await c.env.FOTOS.get(clave);
  if (!objeto) return c.text('No encontrada', 404);

  const headers = new Headers();
  objeto.writeHttpMetadata(headers);
  headers.set('etag', objeto.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(objeto.body, { headers });
});
