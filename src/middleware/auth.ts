import { Context, Next } from 'hono';
import { verifyToken, extractToken } from '../utils/crypto';

/**
 * Authentication middleware
 * Verifies JWT token and attaches user info to context
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractToken(authHeader);

  if (!token) {
    return c.json({ success: false, message: 'No token provided' }, 401);
  }

  const user = await verifyToken(token);

  if (!user) {
    return c.json({ success: false, message: 'Invalid or expired token' }, 401);
  }

  // Attach user info to context
  c.set('user', user);

  await next();
}

/**
 * Admin-only middleware
 * Requires user to have admin role
 */
export async function adminMiddleware(c: Context, next: Next) {
  const user = c.get('user');

  if (!user || user.role !== 'admin') {
    return c.json({ success: false, message: 'Admin access required' }, 403);
  }

  await next();
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't reject if missing
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractToken(authHeader);

  if (token) {
    const user = await verifyToken(token);
    if (user) {
      c.set('user', user);
    }
  }

  await next();
}
