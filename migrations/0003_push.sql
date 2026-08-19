-- Suscripciones de aviso para el panel.
--
-- Guarda lo mínimo que exige el estándar para poder mandarle un push a un
-- navegador: el endpoint del servicio y las dos claves con las que se cifra
-- el mensaje. Nada de modelo de teléfono, sistema operativo ni ubicación.
--
-- El endpoint es único: si el mismo dispositivo se vuelve a suscribir, se
-- actualiza la fila en vez de crear otra, así un pedido no genera dos avisos
-- al mismo aparato.

CREATE TABLE IF NOT EXISTS PushSuscripciones (
    SuscripcionID INTEGER PRIMARY KEY AUTOINCREMENT,

    Endpoint TEXT NOT NULL UNIQUE,
    P256dh   TEXT NOT NULL,
    Auth     TEXT NOT NULL,

    -- Quién la registró, para poder revocar por usuario. La etiqueta es
    -- opcional y la escribe la persona («iPhone», «laptop»).
    Usuario     TEXT,
    Dispositivo TEXT,

    CreadoEn    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UltimoEnvio TEXT,
    Fallos      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_usuario ON PushSuscripciones(Usuario);
