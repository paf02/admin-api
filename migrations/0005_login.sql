-- Intentos de inicio de sesión.
--
-- Sin esto, alguien puede probar contraseñas a mano o con un script hasta
-- acertar: nada se lo impide y nada queda anotado. Cada intento se registra y
-- se bloquea temporalmente al usuario o la IP que falla muchas veces seguidas.
--
-- No se guarda la contraseña probada. Solo quién, desde dónde y si acertó.

CREATE TABLE IF NOT EXISTS IntentosLogin (
    IntentoID INTEGER PRIMARY KEY AUTOINCREMENT,
    Usuario   TEXT,
    IP        TEXT,
    Exito     INTEGER NOT NULL DEFAULT 0,
    Fecha     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_intentos_fecha   ON IntentosLogin(Fecha);
CREATE INDEX IF NOT EXISTS idx_intentos_usuario ON IntentosLogin(Usuario, Fecha);
CREATE INDEX IF NOT EXISTS idx_intentos_ip      ON IntentosLogin(IP, Fecha);
