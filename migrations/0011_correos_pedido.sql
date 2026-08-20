-- Correos ya enviados de cada pedido.
--
-- Sirve para dos cosas: que un mismo aviso no salga dos veces si alguien
-- mueve el estado adelante y atrás, y que en el panel se pueda ver qué se le
-- dijo al cliente y cuándo.
CREATE TABLE IF NOT EXISTS CorreosPedido (
  VentaID   INTEGER NOT NULL,
  Evento    TEXT    NOT NULL,
  Destino   TEXT,
  EnviadoEn TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (VentaID, Evento),
  FOREIGN KEY (VentaID) REFERENCES Ventas (VentaID)
);
