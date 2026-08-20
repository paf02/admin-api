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

/**
 * Misma política que el panel: si falta el secreto se falla cerrado. Una
 * llave por defecto en un repositorio público deja que cualquiera se firme
 * una sesión y lea los pedidos de otra persona.
 */
const clave = (secreto?: string) => {
  if (!secreto) throw new Error('JWT_SECRET no está configurado en el Worker');
  return new TextEncoder().encode(secreto);
};

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
    return {
      clienteId: Number(payload.clienteId),
      correo: String(payload.correo),
      // Cuándo se firmó, en segundos UTC. Sirve para dejar fuera las sesiones
      // anteriores a un cambio de contraseña (Clientes.SesionesDesde).
      emitido: Number(payload.iat ?? 0),
    };
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

/** Comparación en tiempo constante: no filtra por dónde dejaron de coincidir. */
export function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Reglas de contraseña: largo mínimo y nada más.
 *
 * Exigir mayúsculas y símbolos empuja a la gente a «Perfume1!» y a anotarla
 * en un papel; el largo es lo que de verdad cuesta adivinar. El freno por
 * intentos hace el resto del trabajo.
 */
export const LARGO_MINIMO = 8;

export function revisarClave(clave: string, correo: string) {
  if (typeof clave !== 'string' || clave.length < LARGO_MINIMO) {
    return `La contraseña necesita al menos ${LARGO_MINIMO} caracteres`;
  }
  if (clave.length > 200) return 'Esa contraseña es demasiado larga';
  if (clave.trim().toLowerCase() === correo.toLowerCase()) {
    return 'La contraseña no puede ser tu propio correo';
  }
  return null;
}
