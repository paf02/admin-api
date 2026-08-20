/**
 * Tokens de un solo uso para las cuentas de cliente.
 *
 * Confirmar un correo y recuperar una contraseña son la misma prueba: quien
 * abre el enlace que llegó a esa dirección es el dueño de esa dirección. Por
 * eso es un solo mecanismo con dos tipos y dos vencimientos.
 *
 * Lo que se guarda es el SHA-256 del token, nunca el token: si alguien llega
 * a leer la tabla, no puede usar nada de lo que ve.
 */

export type TipoToken = 'verificacion' | 'clave';

/**
 * Cuánto vive cada uno.
 *
 * El de contraseña dura poco porque es el que abre la cuenta; el de
 * verificación aguanta un día, que es lo que tarda alguien en abrir el correo
 * de una tienda.
 */
const HORAS: Record<TipoToken, number> = {
  verificacion: 24,
  clave: 1,
};

/** Días que se conserva un token vencido antes de borrarlo. */
const DIAS_DE_GRACIA = 7;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** SHA-256 en hexadecimal: es lo que se guarda y lo que se busca. */
async function huella(token: string): Promise<string> {
  const datos = new TextEncoder().encode(token);
  const buffer = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Emite un token y devuelve el texto plano, que solo existe en esta llamada y
 * en el correo que sale enseguida.
 *
 * Emitir uno anula los anteriores del mismo correo y tipo: pedir el enlace
 * dos veces no puede dejar dos llaves vivas.
 */
export async function crearToken(
  db: D1Database,
  correo: string,
  tipo: TipoToken,
  ip?: string | null
): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));

  await db.batch([
    db
      .prepare(`UPDATE ClientesTokens SET Usado = 1 WHERE Correo = ? AND Tipo = ? AND Usado = 0`)
      .bind(correo, tipo),
    db
      .prepare(
        `INSERT INTO ClientesTokens (Correo, Tipo, TokenHash, Expira, IP)
         VALUES (?, ?, ?, datetime('now', 'localtime', ?), ?)`
      )
      .bind(correo, tipo, await huella(token), `+${HORAS[tipo]} hours`, ip ?? null),
  ]);

  return token;
}

/**
 * Lee a quién pertenece el token sin gastarlo.
 *
 * Hace falta antes de cambiar una contraseña: las reglas de la clave nueva
 * dependen del correo, y no se puede quemar el enlace para después decirle a
 * la persona que su contraseña era muy corta. Quien decide de verdad sigue
 * siendo `consumirToken`, que es el que marca la fila.
 */
export async function mirarToken(
  db: D1Database,
  tipo: TipoToken,
  token: string
): Promise<string | null> {
  if (!token || token.length > 200) return null;

  const fila: any = await db
    .prepare(
      `SELECT Correo FROM ClientesTokens
        WHERE TokenHash = ? AND Tipo = ? AND Usado = 0
          AND Expira > datetime('now', 'localtime')`
    )
    .bind(await huella(token), tipo)
    .first();

  return fila?.Correo ? String(fila.Correo) : null;
}

/**
 * Gasta el token y devuelve el correo al que pertenece, o `null` si no sirve
 * —no existe, ya se usó, venció o es de otro tipo—.
 *
 * Se marca usado en el mismo UPDATE que lo busca: dos peticiones a la vez con
 * el mismo enlace no pueden pasar las dos, porque la segunda no encuentra
 * ninguna fila con `Usado = 0`.
 */
export async function consumirToken(
  db: D1Database,
  tipo: TipoToken,
  token: string
): Promise<string | null> {
  if (!token || token.length > 200) return null;

  const fila: any = await db
    .prepare(
      `UPDATE ClientesTokens
          SET Usado = 1
        WHERE TokenHash = ?
          AND Tipo = ?
          AND Usado = 0
          AND Expira > datetime('now', 'localtime')
        RETURNING Correo`
    )
    .bind(await huella(token), tipo)
    .first();

  return fila?.Correo ? String(fila.Correo) : null;
}

/**
 * Borra los que ya no le sirven a nadie. Lo llama el cron que corre cada
 * hora; no hace falta que corra siempre ni que termine.
 */
export async function limpiarTokens(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM ClientesTokens WHERE Expira < datetime('now', 'localtime', ?)`)
    .bind(`-${DIAS_DE_GRACIA} days`)
    .run();
}
