-- Cuentas de cliente con correo y contraseña.
--
-- Reemplaza el ingreso por código: enviar correos exige contratar un servicio
-- externo, y la tienda prefiere no depender de uno. La contraseña se guarda
-- con el mismo PBKDF2 con sal del panel, nunca en claro.

ALTER TABLE Clientes ADD COLUMN PasswordHash TEXT;

-- La tabla de códigos nunca llegó a usarse: se creó hoy y quedó en cero.
DROP TABLE IF EXISTS ClientesCodigos;
