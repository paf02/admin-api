-- Visitas al sitio.
--
-- La pregunta que hoy no se puede contestar es «¿nadie entra, o entran y no
-- compran?». Para eso alcanza con contar, y contar no requiere saber quién es
-- nadie: acá no hay IP, ni cookie, ni identificador de persona.
--
-- `Sesion` es un número al azar que vive en la pestaña y se borra al cerrarla.
-- Sirve para no contar diez veces a quien mira diez productos, y no permite
-- reconocer a nadie ni seguirlo entre visitas.

CREATE TABLE IF NOT EXISTS Visitas (
    VisitaID   INTEGER PRIMARY KEY AUTOINCREMENT,
    Fecha      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    Dia        TEXT NOT NULL DEFAULT (date('now', 'localtime')),

    -- 'vista' | 'producto' | 'carrito' | 'checkout' | 'pedido'
    Evento     TEXT NOT NULL,
    Ruta       TEXT,
    -- De dónde llegó: solo el dominio, nunca la dirección completa
    Origen     TEXT,
    Dispositivo TEXT,
    Sesion     TEXT
);

CREATE INDEX IF NOT EXISTS idx_visitas_dia    ON Visitas(Dia);
CREATE INDEX IF NOT EXISTS idx_visitas_evento ON Visitas(Evento, Dia);
CREATE INDEX IF NOT EXISTS idx_visitas_sesion ON Visitas(Sesion);
