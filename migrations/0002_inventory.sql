-- Movimientos de inventario.
--
-- El stock vive donde siempre: Productos.Stock. Acá no se guarda una segunda
-- versión de las existencias, solo el rastro de cómo llegaron a ser lo que
-- son, para poder responder «¿por qué hay 3 y no 5?».
--
-- Cada tamaño de decant es su propia fila en Productos, así que un
-- movimiento ya queda atado al tamaño exacto sin columna de variante.

CREATE TABLE IF NOT EXISTS MovimientosInventario (
    MovimientoID INTEGER PRIMARY KEY AUTOINCREMENT,
    ProductoID   INTEGER NOT NULL,

    -- Las tres cantidades se guardan explícitas: si alguien corrige el stock
    -- por fuera del panel, el historial sigue mostrando qué vio el sistema.
    StockAnterior INTEGER NOT NULL,
    Cambio        INTEGER NOT NULL,
    StockNuevo    INTEGER NOT NULL,

    Motivo   TEXT NOT NULL,
    Nota     TEXT,
    VentaID  INTEGER,
    Usuario  TEXT,
    Fecha    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (ProductoID) REFERENCES Productos(ProductoID),
    FOREIGN KEY (VentaID)    REFERENCES Ventas(VentaID),

    CHECK (StockAnterior >= 0),
    CHECK (StockNuevo >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mov_producto ON MovimientosInventario(ProductoID);
CREATE INDEX IF NOT EXISTS idx_mov_fecha    ON MovimientosInventario(Fecha);
CREATE INDEX IF NOT EXISTS idx_mov_venta    ON MovimientosInventario(VentaID);

-- FechaRegistro es cuándo se creó el producto; esto es cuándo se movió el
-- stock por última vez, que es lo que hace falta para ordenar por «recién
-- actualizado» y para saber si un número está viejo.
ALTER TABLE Productos ADD COLUMN StockActualizadoEn TEXT;

CREATE INDEX IF NOT EXISTS idx_productos_stock ON Productos(Stock);
