/**
 * Piezas compartidas de las cuentas de cliente.
 *
 * La sesión es un JWT propio, con un público distinto al del panel: un token
 * de cliente no sirve para entrar al panel ni al revés, aunque compartan el
 * mismo secreto.
 */
import { SignJWT, jwtVerify } from 'jose';

const PUBLICO = 'estelapura-cliente';
const EMISOR = 'estelapura-api';
const DIAS = 30;

const clave = (secreto?: string) =>
  new TextEncoder().encode(secreto || 'dev-secret-change-in-production');

export async function tokenCliente(clienteId: number, correo: string, secreto?: string) {
  return new SignJWT({ clienteId, correo })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${DIAS}d`)
    .setIssuer(EMISOR)
    .setAudience(PUBLICO)
    .sign(clave(secreto));
}

export async function leerTokenCliente(token: string, secreto?: string) {
  try {
    const { payload } = await jwtVerify(token, clave(secreto), {
      issuer: EMISOR,
      audience: PUBLICO,
    });
    return { clienteId: Number(payload.clienteId), correo: String(payload.correo) };
  } catch {
    return null;
  }
}

/** El correo es la identidad: siempre en minúsculas y sin espacios alrededor. */
export function normalizarCorreo(valor: unknown) {
  return String(valor ?? '').trim().toLowerCase();
}

export function correoValido(correo: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo) && correo.length <= 120;
}

/** Código de seis dígitos con el generador criptográfico, no con Math.random. */
export function nuevoCodigo() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

export async function hashCodigo(codigo: string, correo: string) {
  // El correo entra en el hash para que dos códigos iguales de personas
  // distintas no compartan huella
  const datos = new TextEncoder().encode(`${correo}:${codigo}`);
  const buf = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante: no filtra por dónde dejaron de coincidir. */
export function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}
