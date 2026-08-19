-- Intake de pedidos por WhatsApp.
--
-- Un mensaje de WhatsApp no es una venta: es una intención que hay que leer,
-- confirmar y recién entonces convertir en pedido. Por eso vive en su propia
-- tabla y no toca Ventas —el pedido real lo sigue creando el panel con la
-- misma ruta de siempre, con su validación de existencias y su descuento de
-- stock. Un borrador no aparta nada.

CREATE TABLE IF NOT EXISTS PedidosBorrador (
    BorradorID      INTEGER PRIMARY KEY AUTOINCREMENT,

    Canal           TEXT NOT NULL DEFAULT 'whatsapp',
    -- Número de quien escribe, en formato internacional, tal como lo manda Meta
    Telefono        TEXT NOT NULL,
    NombreContacto  TEXT,

    MensajeOriginal TEXT NOT NULL,
    Intencion       TEXT NOT NULL,          -- compra | consulta | saludo | otro
    -- Líneas detectadas, en JSON: producto, cantidad y precio del catálogo
    Lineas          TEXT NOT NULL DEFAULT '[]',
    Total           REAL NOT NULL DEFAULT 0,
    -- Palabras que el catálogo no reconoció; las resuelve una persona
    NoReconocido    TEXT,

    Estado          TEXT NOT NULL DEFAULT 'Nuevo',   -- Nuevo | Convertido | Descartado
    VentaID         INTEGER,                          -- pedido creado desde el borrador

    CreadoEn        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ActualizadoEn   TEXT,

    FOREIGN KEY (VentaID) REFERENCES Ventas(VentaID),
    CHECK (Estado IN ('Nuevo', 'Convertido', 'Descartado'))
);

CREATE INDEX IF NOT EXISTS idx_borrador_estado   ON PedidosBorrador(Estado);
CREATE INDEX IF NOT EXISTS idx_borrador_telefono ON PedidosBorrador(Telefono);

-- Meta reintenta un webhook cuando no recibe 200 a tiempo. Guardar el ID del
-- mensaje es lo que evita que un reintento genere un segundo borrador.
CREATE TABLE IF NOT EXISTS WhatsAppMensajes (
    MensajeID  TEXT PRIMARY KEY,
    Telefono   TEXT,
    Recibido   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    BorradorID INTEGER,

    FOREIGN KEY (BorradorID) REFERENCES PedidosBorrador(BorradorID)
);
