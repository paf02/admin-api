-- Correo verificado y recuperación de contraseña.
--
-- Hasta hoy, registrarse pedía un correo y una contraseña y nada comprobaba
-- que el buzón fuera de quien lo escribía. Como un pedido es «tuyo» si lo
-- hiciste con ese correo (Ventas.Email), eso alcanzaba para ver el historial
-- de otra persona —y su clave de consulta, que abre el detalle del pedido sin
-- sesión—. Desde acá, la cuenta no ve nada que venga de Ventas hasta que
-- alguien abra el enlace que llega a esa dirección.

-- Arranca en 0 también para las cuentas que ya existen: son justamente las
-- que nadie comprobó. Cada una recibe su enlace la próxima vez que entre.
ALTER TABLE Clientes ADD COLUMN Verificado INTEGER NOT NULL DEFAULT 0;

-- Desde cuándo vale una sesión, en segundos desde la época (UTC).
--
-- Es epoch y no el texto 'localtime' del resto de la base a propósito: se
-- compara contra el `iat` del JWT, que es UTC, y restarle seis horas a una de
-- las dos partes deja pasar tokens que deberían estar muertos.
--
-- Cambiar la contraseña lo mueve a «ahora» y con eso caen las sesiones
-- firmadas antes: quien restablece su clave suele hacerlo porque alguien más
-- la sabe.
ALTER TABLE Clientes ADD COLUMN SesionesDesde INTEGER;

-- Tokens de un solo uso: confirmar el correo y elegir contraseña nueva.
--
-- Se guarda el hash, nunca el token. Quien llegue a leer esta tabla no puede
-- entrar a ninguna cuenta con lo que ve, que es la misma regla que tenía la
-- tabla de códigos que esto reemplaza.
CREATE TABLE IF NOT EXISTS ClientesTokens (
  TokenID   INTEGER PRIMARY KEY AUTOINCREMENT,
  Correo    TEXT    NOT NULL,
  Tipo      TEXT    NOT NULL CHECK (Tipo IN ('verificacion', 'clave')),
  TokenHash TEXT    NOT NULL,
  Expira    TEXT    NOT NULL,
  Usado     INTEGER NOT NULL DEFAULT 0,
  IP        TEXT,
  CreadoEn  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tokens_hash   ON ClientesTokens (TokenHash);
CREATE INDEX IF NOT EXISTS idx_tokens_correo ON ClientesTokens (Correo, Tipo, Usado);
