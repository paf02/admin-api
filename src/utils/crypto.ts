import { SignJWT, jwtVerify } from 'jose';

// Secret key for JWT signing (in production, store in wrangler secrets)
const JWT_SECRET = 'puratech-store-secret-key-change-in-production-2024';

/**
 * Hash password using SHA-256
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

/**
 * Generate JWT token with proper signing
 */
export async function generateToken(userId: number, username: string, role: string = 'user'): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);

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
export async function verifyToken(token: string): Promise<{ userId: number; username: string; role: string } | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);

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
