import { SignJWT, jwtVerify } from 'jose';

/**
 * La llave de firma llega por `wrangler secret put JWT_SECRET`, nunca en el
 * código: este repositorio es público, y una llave versionada permite a
 * cualquiera firmarse un token de administrador y leer los pedidos de los
 * clientes (nombre, teléfono, dirección).
 *
 * Si falta el secreto se falla cerrado: preferimos que nadie entre a que
 * todos entren con una llave conocida.
 */
function secretKey(secret?: string): Uint8Array {
  if (!secret) {
    throw new Error('JWT_SECRET no está configurado en el Worker');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Contraseñas.
 *
 * Antes se guardaba un SHA-256 pelado: una función pensada para ser rápida,
 * sin sal, de modo que una tabla filtrada se revierte con un diccionario en
 * segundos y dos usuarios con la misma contraseña quedan con el mismo hash.
 * Ahora se usa PBKDF2 con sal propia por usuario y muchas iteraciones, que es
 * lento a propósito: cada intento de adivinar cuesta.
 *
 * Formato guardado:  pbkdf2$<iteraciones>$<sal base64>$<hash base64>
 *
 * Los hashes viejos (64 caracteres hexadecimales) se siguen aceptando para no
 * dejar a nadie afuera, y en cuanto la persona entra bien se reescriben al
 * formato nuevo. Nadie tiene que cambiar su contraseña por esto.
 */

/*
 * 100 000 iteraciones: el máximo que admite WebCrypto en Workers. Con más,
 * `deriveBits` lanza en producción aunque funcione perfecto en local, y el
 * login empieza a rechazar contraseñas correctas sin decir por qué.
 */
const ITERACIONES = 100_000;

const aBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const deBase64 = (texto: string) =>
  Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

/** Comparación en tiempo constante: no revela dónde difieren. */
function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derivar(password: string, sal: Uint8Array, iteraciones: number) {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
    clave,
    256
  );

  return new Uint8Array(bits);
}

/** Hash nuevo, con sal aleatoria. */
export async function hashPassword(password: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(password, sal, ITERACIONES);
  return `pbkdf2$${ITERACIONES}$${aBase64(sal)}$${aBase64(hash)}`;
}

/** SHA-256 hexadecimal: el formato viejo, solo para poder verificarlo. */
async function hashHeredado(password: string): Promise<string> {
  const datos = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type ResultadoVerificacion = {
  valido: boolean;
  /** true cuando el hash guardado es del formato viejo y conviene reescribirlo. */
  necesitaActualizar: boolean;
};

/** Verifica contra cualquiera de los dos formatos. */
export async function verifyPasswordDetallado(
  password: string,
  hashGuardado: string
): Promise<ResultadoVerificacion> {
  if (hashGuardado?.startsWith('pbkdf2$')) {
    const [, iteraciones, sal, hash] = hashGuardado.split('$');
    try {
      const calculado = await derivar(password, deBase64(sal), Number(iteraciones));
      return { valido: iguales(calculado, deBase64(hash)), necesitaActualizar: false };
    } catch (error: any) {
      // Se registra: un hash ilegible o un límite de la plataforma no puede
      // quedar como «contraseña incorrecta» sin rastro, que fue justo lo que
      // hizo perder una tarde.
      console.error('auth.pbkdf2', error?.message);
      return { valido: false, necesitaActualizar: false };
    }
  }

  // Formato viejo: SHA-256 hexadecimal
  const calculado = await hashHeredado(password);
  const codificar = (t: string) => new TextEncoder().encode(t);
  const valido = iguales(codificar(calculado), codificar(hashGuardado || ''));
  return { valido, necesitaActualizar: valido };
}

/** Compatibilidad con quien solo necesita el sí o el no. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await verifyPasswordDetallado(password, hash)).valido;
}

/**
 * Generate JWT token with proper signing
 */
export async function generateToken(userId: number, username: string, role: string = 'user', jwtSecret?: string): Promise<string> {
  const secret = secretKey(jwtSecret);

  const token = await new SignJWT({
    userId,
    username,
    role
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .setIssuer('puratech-store-api')
    .setAudience('puratech-store')
    .sign(secret);

  return token;
}

/**
 * Verify and decode JWT token
 */
export async function verifyToken(token: string, jwtSecret?: string): Promise<{ userId: number; username: string; role: string } | null> {
  try {
    const secret = secretKey(jwtSecret);

    const { payload } = await jwtVerify(token, secret, {
      issuer: 'puratech-store-api',
      audience: 'puratech-store',
    });

    return {
      userId: payload.userId as number,
      username: payload.username as string,
      role: payload.role as string,
    };
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
