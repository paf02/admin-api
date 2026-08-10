import { Hono } from 'hono';
import { verifyPassword, generateToken, verifyToken } from '../utils/crypto';

type Bindings = {
  DB: D1Database;
};

export const authRouter = new Hono<{ Bindings: Bindings }>();

// Login endpoint
authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ success: false, message: 'Usuario y contraseña requeridos' }, 400);
  }
  
  try {
    // Get user from database
    const user = await c.env.DB.prepare(`
      SELECT UserID, Username, PasswordHash, FullName, Role, Active
      FROM Users
      WHERE Username = ? AND Active = 1
    `).bind(username).first();
    
    if (!user) {
      return c.json({ success: false, message: 'Usuario o contraseña incorrectos' }, 401);
    }
    
    // Verify password
    const isValid = await verifyPassword(password, user.PasswordHash as string);
    
    if (!isValid) {
      return c.json({ success: false, message: 'Usuario o contraseña incorrectos' }, 401);
    }
    
    // Update last login
    await c.env.DB.prepare(`
      UPDATE Users SET LastLogin = datetime('now', 'localtime') WHERE UserID = ?
    `).bind(user.UserID).run();
    
    // Generate JWT token with role
    const token = await generateToken(
      user.UserID as number,
      user.Username as string,
      user.Role as string
    );

    return c.json({
      success: true,
      data: {
        token,
        user: {
          userId: user.UserID,
          username: user.Username,
          fullName: user.FullName,
          role: user.Role
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, message: 'Error al iniciar sesión' }, 500);
  }
});

// Verify token endpoint
authRouter.get('/verify', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, message: 'Token no proporcionado' }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ success: false, message: 'Token inválido o expirado' }, 401);
  }

  // Get fresh user data
  const user = await c.env.DB.prepare(`
    SELECT UserID, Username, FullName, Role
    FROM Users
    WHERE UserID = ? AND Active = 1
  `).bind(payload.userId).first();

  if (!user) {
    return c.json({ success: false, message: 'Usuario no encontrado' }, 401);
  }

  return c.json({
    success: true,
    data: {
      user: {
        userId: user.UserID,
        username: user.Username,
        fullName: user.FullName,
        role: user.Role
      }
    }
  });
});

// Logout endpoint (client-side mainly, server just confirms)
authRouter.post('/logout', async (c) => {
  return c.json({ success: true, message: 'Sesión cerrada exitosamente' });
});
