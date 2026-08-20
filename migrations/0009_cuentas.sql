-- Cuentas de cliente: entrar con un código que llega al correo.
--
-- No se guarda ninguna contraseña. La identidad que se verifica es el correo,
-- y es también la llave con la que se encuentran los pedidos: un pedido es
-- «tuyo» si lo hiciste con ese correo. Por eso Ventas no cambia.

CREATE TABLE IF NOT EXISTS Clientes (
  ClienteID       INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Siempre en minúsculas y sin espacios: es la llave de identidad
  Correo          TEXT NOT NULL UNIQUE,
  Nombre          TEXT,
  Telefono        TEXT,
  -- Datos de entrega para que el próximo checkout venga lleno
  Provincia       TEXT,
  Canton          TEXT,
  Distrito        TEXT,
  DireccionExacta TEXT,
  Waze            TEXT,
  CreadoEn        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UltimoAcceso    TEXT
);

-- Códigos de un solo uso. Se guarda el hash, nunca el código: si alguien
-- llegara a leer la tabla, no puede entrar a ninguna cuenta con eso.
CREATE TABLE IF NOT EXISTS ClientesCodigos (
  CodigoID   INTEGER PRIMARY KEY AUTOINCREMENT,
  Correo     TEXT    NOT NULL,
  CodigoHash TEXT    NOT NULL,
  Expira     TEXT    NOT NULL,
  Intentos   INTEGER NOT NULL DEFAULT 0,
  Usado      INTEGER NOT NULL DEFAULT 0,
  IP         TEXT,
  CreadoEn   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_codigos_correo ON ClientesCodigos (Correo, Expira);

-- Lista de deseos del lado del servidor, para que siga al cliente entre
-- teléfono y computadora. Misma forma que la que ya se guarda en el navegador.
CREATE TABLE IF NOT EXISTS ClientesFavoritos (
  ClienteID  INTEGER NOT NULL,
  Tipo       TEXT    NOT NULL CHECK (Tipo IN ('perfume', 'decant')),
  Referencia TEXT    NOT NULL,
  AgregadoEn TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (ClienteID, Tipo, Referencia),
  FOREIGN KEY (ClienteID) REFERENCES Clientes (ClienteID)
);
