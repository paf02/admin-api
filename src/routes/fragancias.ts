import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { buscarFichas } from '../data/fragancias';

type Bindings = { DB: D1Database };

export const fraganciasRouter = new Hono<{ Bindings: Bindings }>();

const admin = [authMiddleware, adminMiddleware] as const;

/** Los únicos tamaños de decant. No se aceptan otros. */
const TAMANOS = [2, 5, 10] as const;

/** Categorías fijas del catálogo. */
const CATEGORIA = {
  hombre: { sellado: 1, decant: 3 },
  mujer: { sellado: 2, decant: 4 },
};

const texto = (valor: unknown) => String(valor ?? '').trim();
const numero = (valor: unknown) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Lista de notas para guardar: se normaliza a «a, b, c». */
const notas = (valor: unknown) =>
  Array.isArray(valor)
    ? valor.map((n) => String(n).trim()).filter(Boolean).join(', ') || null
    : texto(valor) || null;

/**
 * Sugerencias mientras se escribe el nombre.
 *
 * Devuelve la ficha olfativa —familia, año y la pirámide— para que el
 * formulario se llene solo. La respuesta dice además si esa fragancia ya está
 * en el catálogo: sirve para no publicarla dos veces con el nombre escrito
 * distinto, que es como se rompe la agrupación de los decants.
 */
fraganciasRouter.get('/buscar', ...admin, async (c) => {
  const q = texto(c.req.query('q'));
  if (q.length < 2) return c.json({ success: true, data: [] });

  const fichas = buscarFichas(q);
  if (!fichas.length) return c.json({ success: true, data: [] });

  // Una sola consulta para todas las sugerencias: son ocho como máximo.
  const nombres = fichas.map((f) => `${f.marca} ${f.nombre}`.toLowerCase());
  const existentes = await c.env.DB.prepare(
    `SELECT lower(Nombre) AS nombre FROM Productos
      WHERE ${nombres.map(() => `lower(Nombre) LIKE ?`).join(' OR ')}`
  )
    .bind(...nombres.map((n) => `${n}%`))
    .all<{ nombre: string }>();

  const yaEsta = (ficha: (typeof fichas)[number]) =>
    existentes.results.some((r) =>
      r.nombre.startsWith(`${ficha.marca} ${ficha.nombre}`.toLowerCase())
    );

  return c.json({
    success: true,
    data: fichas.map((f) => ({ ...f, enCatalogo: yaEsta(f) })),
  });
});

/**
 * Alta de una fragancia completa.
 *
 * Un perfume en la tienda no es una fila: es la botella sellada más sus tres
 * decants, cada uno con su propio precio y sus propias existencias. Hacerlo a
 * mano son cuatro altas donde es fácil equivocarse en la categoría o escribir
 * distinto el nombre, y con el nombre mal escrito el decant deja de asociarse
 * con su botella.
 *
 * Acá se arma todo de una vez y con el mismo nombre base, que es lo que
 * después usa `groupDecants` para relacionarlos.
 */
fraganciasRouter.post('/', ...admin, async (c) => {
  const body = await c.req.json().catch(() => ({} as any));

  const nombre = texto(body.nombre);
  const marca = texto(body.marca);
  const genero = texto(body.genero).toLowerCase() as keyof typeof CATEGORIA;

  if (!nombre) return c.json({ success: false, message: 'Falta el nombre' }, 400);
  if (!marca) return c.json({ success: false, message: 'Falta la marca' }, 400);
  if (!CATEGORIA[genero]) {
    return c.json({ success: false, message: 'El género debe ser hombre o mujer' }, 400);
  }

  const precioVenta = numero(body.precioVenta);
  const precioCompra = numero(body.precioCompra) ?? 0;
  const stock = Math.floor(numero(body.stock) ?? 0);

  if (!precioVenta) {
    return c.json({ success: false, message: 'Falta el precio de venta' }, 400);
  }

  try {
    // La marca se reutiliza si ya existe: escribir «Lattafa» dos veces no debe
    // crear dos marcas y partir el filtro del catálogo en dos.
    let marcaId = (
      await c.env.DB.prepare(`SELECT MarcaID FROM Marcas WHERE lower(Nombre) = lower(?)`)
        .bind(marca)
        .first<{ MarcaID: number }>()
    )?.MarcaID;

    if (!marcaId) {
      const creada = await c.env.DB.prepare(
        `INSERT INTO Marcas (Nombre, Estado) VALUES (?, 1)`
      ).bind(marca).run();
      marcaId = Number(creada.meta.last_row_id);
    }

    // Nombre completo tal como lo espera el catálogo: «Marca Nombre 100ml».
    const tamano = texto(body.tamano);
    const concentracion = texto(body.concentracion);
    const base = [marca, nombre, concentracion, tamano ? `${tamano}ml` : '']
      .filter(Boolean)
      .join(' ');

    const yaExiste = await c.env.DB.prepare(
      `SELECT ProductoID FROM Productos WHERE lower(Nombre) = lower(?)`
    ).bind(base).first();

    if (yaExiste) {
      return c.json(
        { success: false, message: `Ya existe un producto llamado «${base}».` },
        409
      );
    }

    const cat = CATEGORIA[genero];
    const familia = texto(body.familia) || null;
    const salida = notas(body.notasSalida);
    const corazon = notas(body.notasCorazon);
    const fondo = notas(body.notasFondo);
    const imagen = texto(body.imagenUrl) || null;

    const sellado = await c.env.DB.prepare(
      `INSERT INTO Productos
         (Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock, Estado,
          ImagenURL, Familia, NotasSalida, NotasCorazon, NotasFondo)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    )
      .bind(base, cat.sellado, marcaId, precioCompra, precioVenta, stock, imagen, familia, salida, corazon, fondo)
      .run();

    const selladoId = Number(sellado.meta.last_row_id);

    // Decants: solo los que tengan precio. Una fragancia puede venderse sin
    // decants, o sin el de 10 ml, y forzar los tres crearía productos a ₡0.
    const creados: { size: number; id: number }[] = [];

    for (const size of TAMANOS) {
      const precio = numero(body.decants?.[String(size)]);
      if (!precio) continue;

      // El costo del decant se prorratea por volumen sobre 100 ml, igual que
      // en la carga inicial del catálogo.
      const compra = precioCompra ? Math.round((precioCompra / 100) * size * 100) / 100 : 0;

      const decant = await c.env.DB.prepare(
        `INSERT INTO Productos
           (Nombre, CategoriaID, MarcaID, PrecioCompra, PrecioVenta, Stock, Estado, ImagenURL)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
        .bind(
          `${base} — Decant ${size}ml`,
          cat.decant,
          marcaId,
          compra,
          precio,
          Math.floor(numero(body.decantStock?.[String(size)]) ?? stock),
          imagen
        )
        .run();

      creados.push({ size, id: Number(decant.meta.last_row_id) });
    }

    return c.json(
      {
        success: true,
        message: `«${base}» quedó publicado con ${creados.length} decant${creados.length === 1 ? '' : 's'}.`,
        data: { selladoId, decants: creados, nombre: base },
      },
      201
    );
  } catch (error: any) {
    console.error('fragancias.crear', error?.message);
    return c.json({ success: false, message: 'No se pudo crear la fragancia' }, 500);
  }
});
