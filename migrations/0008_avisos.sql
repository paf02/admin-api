-- Quién está esperando que algo vuelva.
--
-- Un producto agotado es una venta perdida y, además, una señal que se pierde:
-- nadie sabe cuánta gente lo quería. Acá queda anotado quién pidió que le
-- avisen, para reponer con criterio y para tener a quién escribirle cuando
-- llegue.
--
-- Solo se guarda el número de WhatsApp que la persona escribe para eso. Nada
-- más: ni nombre, ni correo, ni de dónde venía.

CREATE TABLE IF NOT EXISTS AvisosStock (
    AvisoID    INTEGER PRIMARY KEY AUTOINCREMENT,
    ProductoID INTEGER NOT NULL,
    Telefono   TEXT NOT NULL,
    CreadoEn   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    Avisado    INTEGER NOT NULL DEFAULT 0,
    AvisadoEn  TEXT,

    FOREIGN KEY (ProductoID) REFERENCES Productos(ProductoID),
    -- La misma persona no se anota dos veces al mismo producto
    UNIQUE (ProductoID, Telefono)
);

CREATE INDEX IF NOT EXISTS idx_avisos_producto ON AvisosStock(ProductoID, Avisado);
