/**
 * Existencias.
 *
 * El stock sigue viviendo en Productos.Stock. Acá está el cómo se toca:
 * siempre con guarda para que no baje de cero, y siempre dejando el
 * movimiento anotado.
 *
 * Cada tamaño de decant es su propia fila en Productos, así que mover el de
 * 5 ml no puede tocar el de 2 ml ni el de 10 ml: son productos distintos, no
 * variantes de una misma fila.
 */

/** Debajo o igual de esto, el producto aparece como bajo. Un solo lugar. */
export const LOW_STOCK_THRESHOLD = 3;

export const REASONS = [
  'Reabastecimiento',
  'Producto dañado',
  'Corrección de inventario',
  'Uso personal',
  'Venta',
  'Pedido cancelado',
  'Otro',
] as const;

export type Reason = (typeof REASONS)[number];

export const isReason = (value: unknown): value is Reason =>
  REASONS.includes(value as Reason);

/**
 * Baja existencias sin permitir negativos.
 *
 * La guarda `Stock >= ?` va en el propio UPDATE, no en un SELECT previo: entre
 * un SELECT y un UPDATE caben dos pedidos simultáneos, dentro de un UPDATE no.
 * Quien llama debe revisar `meta.changes`: 0 significa que no alcanzaba.
 */
export const deductStatement = (db: D1Database, productoId: number, cantidad: number) =>
  db
    .prepare(
      `UPDATE Productos
          SET Stock = Stock - ?,
              StockActualizadoEn = datetime('now','localtime')
        WHERE ProductoID = ? AND Stock >= ?`
    )
    .bind(cantidad, productoId, cantidad);

export const restoreStatement = (db: D1Database, productoId: number, cantidad: number) =>
  db
    .prepare(
      `UPDATE Productos
          SET Stock = Stock + ?,
              StockActualizadoEn = datetime('now','localtime')
        WHERE ProductoID = ?`
    )
    .bind(cantidad, productoId);

export const movementStatement = (
  db: D1Database,
  m: {
    productoId: number;
    anterior: number;
    cambio: number;
    nuevo: number;
    motivo: string;
    nota?: string | null;
    ventaId?: number | null;
    usuario?: string | null;
  }
) =>
  db
    .prepare(
      `INSERT INTO MovimientosInventario
         (ProductoID, StockAnterior, Cambio, StockNuevo, Motivo, Nota, VentaID, Usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      m.productoId,
      m.anterior,
      m.cambio,
      m.nuevo,
      m.motivo,
      m.nota ?? null,
      m.ventaId ?? null,
      m.usuario ?? null
    );

/**
 * Tipo, género, concentración y tamaño no son columnas: se derivan de la
 * categoría ('Decants Hombre') y del nombre ('… — Decant 5ml', 'EDT 100ml').
 *
 * Se derivan en el servidor para que la lista, los filtros y el orden usen el
 * mismo criterio; si cada pantalla lo dedujera por su cuenta, terminarían
 * discrepando.
 */
export const DERIVED_COLUMNS = `
  CASE WHEN cat.Nombre LIKE 'Decants%' THEN 'Decant' ELSE 'Perfume sellado' END AS Tipo,
  CASE
    WHEN cat.Nombre LIKE '%Hombre%' THEN 'Hombre'
    WHEN cat.Nombre LIKE '%Mujer%'  THEN 'Mujer'
    ELSE NULL
  END AS Genero,
  CASE
    WHEN p.Nombre LIKE '%Decant 2ml%'  THEN '2 ml'
    WHEN p.Nombre LIKE '%Decant 5ml%'  THEN '5 ml'
    WHEN p.Nombre LIKE '%Decant 10ml%' THEN '10 ml'
    WHEN p.Nombre LIKE '%100ml%'       THEN '100 ml'
    WHEN p.Nombre LIKE '%50ml%'        THEN '50 ml'
    ELSE NULL
  END AS Tamano,
  CASE
    WHEN p.Nombre LIKE '%EDP%'    THEN 'EDP'
    WHEN p.Nombre LIKE '%EDT%'    THEN 'EDT'
    WHEN p.Nombre LIKE '%Parfum%' THEN 'Parfum'
    ELSE NULL
  END AS Concentracion,
  CASE
    WHEN p.Stock = 0 THEN 'Agotado'
    WHEN p.Stock <= ${LOW_STOCK_THRESHOLD} THEN 'Bajo'
    ELSE 'Disponible'
  END AS EstadoStock
`;
