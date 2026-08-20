-- Clave de seguimiento del pedido.
--
-- El cliente sigue su pedido con un enlace: /pedido/EP-000001?c=<clave>. Va
-- una clave por pedido y no el teléfono, porque los números de pedido son
-- correlativos: con solo el número, cualquiera podría ir probando EP-000002,
-- EP-000003 y leer pedidos ajenos. Una clave aleatoria no se adivina.
ALTER TABLE Ventas ADD COLUMN Consulta TEXT;

CREATE INDEX IF NOT EXISTS idx_ventas_consulta ON Ventas(Consulta);
