-- Order management schema.
--
-- Ventas came from the tech-store schema: it could hold a name, a phone, a
-- total, and a free-text note. Everything the storefront already computes for
-- an order — email, address, delivery, payment state — was being flattened
-- into Observacion, so the admin side had nothing structured to read.
--
-- Status values are NOT invented here. They are exactly the ones the
-- storefront already uses in estelapuracr-pwa/src/lib/orders.js
-- (ORDER_STATUS / PAYMENT_STATUS) and config/store.js (PAYMENT_METHODS),
-- so both sides speak the same vocabulary.
--
-- Ventas is rebuilt rather than altered because SQLite cannot drop the old
-- CHECK (EstadoVenta IN ('Pendiente','Entregado')), which would reject five
-- of the seven statuses. Safe to rebuild: the table holds no rows.

DROP TABLE IF EXISTS Ventas;

CREATE TABLE Ventas (
    VentaID           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- EP-000123. Derived from VentaID, stored so it stays searchable and
    -- survives any future change to how the number is formatted.
    NumeroPedido      TEXT UNIQUE,
    Fecha             TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),

    -- Cliente
    Cliente           TEXT NOT NULL,
    Telefono          TEXT,
    Email             TEXT,

    -- Entrega
    Provincia         TEXT,
    Canton            TEXT,
    Distrito          TEXT,
    DireccionExacta   TEXT,
    Waze              TEXT,
    MetodoEntrega     TEXT,
    CostoEnvio        REAL    NOT NULL DEFAULT 0,
    -- Ambos métodos de entrega cotizan al coordinar, así que el costo puede
    -- quedar sin definir sin inventar un monto.
    EnvioPorConfirmar INTEGER NOT NULL DEFAULT 0,

    -- Pago
    MetodoPago        TEXT NOT NULL,
    EstadoPago        TEXT NOT NULL DEFAULT 'Pendiente de pago',
    PagoReferencia    TEXT,
    PagoVerificadoEn  TEXT,
    PagoVerificadoPor TEXT,

    -- Pedido
    EstadoVenta       TEXT    NOT NULL DEFAULT 'Pendiente',
    Observacion       TEXT,
    Descuento         REAL    NOT NULL DEFAULT 0,
    Total             REAL    NOT NULL,

    -- Operación
    Revisado          INTEGER NOT NULL DEFAULT 0,
    RevisadoEn        TEXT,
    -- El stock se descuenta una sola vez, al crear el pedido. Esta bandera
    -- evita devolverlo dos veces si se cancela un pedido ya cancelado.
    StockDevuelto     INTEGER NOT NULL DEFAULT 0,

    CHECK (EstadoVenta IN ('Pendiente','Confirmado','Preparando','Listo','Enviado','Entregado','Cancelado')),
    CHECK (EstadoPago  IN ('Pendiente de pago','Verificación requerida','Pagado','Fallido','Reembolsado')),
    CHECK (MetodoPago  IN ('SINPE Móvil','Efectivo contra entrega')),
    CHECK (Total >= 0),
    CHECK (CostoEnvio >= 0),
    CHECK (Descuento >= 0)
);

-- Nombre del producto al momento de la compra: si después se renombra o se
-- desactiva un producto, el pedido sigue leyéndose igual que cuando se hizo.
ALTER TABLE DetalleVenta ADD COLUMN NombreProducto TEXT;

-- Bitácora del pedido. Una fila por acción, nunca se edita ni se borra.
CREATE TABLE IF NOT EXISTS VentaHistorial (
    HistorialID INTEGER PRIMARY KEY AUTOINCREMENT,
    VentaID     INTEGER NOT NULL,
    Accion      TEXT NOT NULL,
    Detalle     TEXT,
    Usuario     TEXT,
    Fecha       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (VentaID) REFERENCES Ventas(VentaID)
);

CREATE INDEX IF NOT EXISTS idx_ventas_fecha        ON Ventas(Fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_estado       ON Ventas(EstadoVenta);
CREATE INDEX IF NOT EXISTS idx_ventas_estadopago   ON Ventas(EstadoPago);
CREATE INDEX IF NOT EXISTS idx_ventas_numero       ON Ventas(NumeroPedido);
CREATE INDEX IF NOT EXISTS idx_ventas_telefono     ON Ventas(Telefono);
CREATE INDEX IF NOT EXISTS idx_historial_venta     ON VentaHistorial(VentaID);
