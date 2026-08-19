import { Hono } from 'hono';
import {
  hashPassword,
  verifyPasswordDetallado,
  generateToken,
  verifyToken,
} from '../utils/crypto';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
};

export const authRouter = new Hono<{ Bindings: Bindings }>();

/*
 * Freno a los intentos de adivinar la contraseña.
 *
 * Cinco fallos seguidos del mismo usuario —o quince desde la misma IP— cierran
 * la puerta por quince minutos. Es suficiente para que probar a ciegas deje de
 * ser viable y lo bastante holgado para que a nadie le estorbe escribir mal su
 * contraseña un par de veces.
 */
const VENTANA_MINUTOS = 15;
const TOPE_USUARIO = 5;
const TOPE_IP = 15;

const ipDe = (c: any) =>
  c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'desconocida';

async function estaBloqueado(db: D1Database, usuario: string, ip: string) {
  const fila: any = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN Usuario = ? THEN 1 ELSE 0 END) AS PorUsuario,
         SUM(CASE WHEN IP = ?      THEN 1 ELSE 0 END) AS PorIP
       FROM IntentosLogin
       WHERE Exito = 0 AND Fecha > datetime('now', 'localtime', ?)`
    )
    .bind(usuario, ip, `-${VENTANA_MINUTOS} minutes`)
    .first();

  return (Number(fila?.PorUsuario) || 0) >= TOPE_USUARIO || (Number(fila?.PorIP) || 0) >= TOPE_IP;
}

async function anotarIntento(db: D1Database, usuario: string, ip: string, exito: boolean) {
  await db.batch([
    db.prepare(`INSERT INTO IntentosLogin (Usuario, IP, Exito) VALUES (?, ?, ?)`)
      .bind(usuario, ip, exito ? 1 : 0),
    // La tabla no crece para siempre: lo de ayer ya no sirve para decidir
    db.prepare(`DELETE FROM IntentosLogin WHERE Fecha < datetime('now', 'localtime', '-1 day')`),
  ]);
}

// Login endpoint
authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ success: false, message: 'Usuario y contraseña requeridos' }, 400);
  }
  
  const ip = ipDe(c);

  try {
    if (await estaBloqueado(c.env.DB, username, ip)) {
      console.warn('auth.bloqueado', username, ip);
      return c.json(
        {
          success: false,
          message: `Demasiados intentos fallidos. Probá de nuevo en ${VENTANA_MINUTOS} minutos.`,
        },
        429
      );
    }

    // Get user from database
    const user = await c.env.DB.prepare(`
      SELECT UserID, Username, PasswordHash, FullName, Role, Active
      FROM Users
      WHERE Username = ? AND Active = 1
    `).bind(username).first();
    
    if (!user) {
      await anotarIntento(c.env.DB, username, ip, false);
      return c.json({ success: false, message: 'Usuario o contraseña incorrectos' }, 401);
    }
    
    // Verify password
    const { valido, necesitaActualizar } = await verifyPasswordDetallado(
      password,
      user.PasswordHash as string
    );

    if (!valido) {
      await anotarIntento(c.env.DB, username, ip, false);
      return c.json({ success: false, message: 'Usuario o contraseña incorrectos' }, 401);
    }

    await anotarIntento(c.env.DB, username, ip, true);

    // Contraseña correcta guardada con el formato viejo: se reescribe al nuevo
    // sin pedirle nada a la persona.
    if (necesitaActualizar) {
      try {
        await c.env.DB.prepare(`UPDATE Users SET PasswordHash = ? WHERE UserID = ?`)
          .bind(await hashPassword(password), user.UserID)
          .run();
      } catch (error: any) {
        console.error('auth.rehash', error?.message);
      }
    }
    
    // Update last login
    await c.env.DB.prepare(`
      UPDATE Users SET LastLogin = datetime('now', 'localtime') WHERE UserID = ?
    `).bind(user.UserID).run();
    
    // Generate JWT token with role
    const token = await generateToken(
      user.UserID as number,
      user.Username as string,
      user.Role as string,
      c.env.JWT_SECRET
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
  const payload = await verifyToken(token, c.env.JWT_SECRET);

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

/**
 * Cambio de contraseña.
 *
 * Pide la actual aunque haya sesión: un token robado no debería alcanzar para
 * quedarse con la cuenta. La nueva se guarda ya con el formato fuerte.
 */
authRouter.post('/cambiar-clave', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null;

  if (!payload) {
    return c.json({ success: false, message: 'Sesión no válida' }, 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Cuerpo inválido' }, 400);
  }

  const actual = String(body?.actual ?? '');
  const nueva = String(body?.nueva ?? '');

  if (nueva.length < 10) {
    return c.json(
      { success: false, message: 'La contraseña nueva debe tener al menos 10 caracteres' },
      400
    );
  }
  if (nueva === actual) {
    return c.json({ success: false, message: 'La contraseña nueva es igual a la actual' }, 400);
  }

  try {
    const user: any = await c.env.DB.prepare(
      `SELECT UserID, PasswordHash FROM Users WHERE UserID = ? AND Active = 1`
    ).bind(payload.userId).first();

    if (!user) return c.json({ success: false, message: 'Usuario no encontrado' }, 401);

    const { valido } = await verifyPasswordDetallado(actual, user.PasswordHash);
    if (!valido) {
      return c.json({ success: false, message: 'La contraseña actual no coincide' }, 401);
    }

    await c.env.DB.prepare(`UPDATE Users SET PasswordHash = ? WHERE UserID = ?`)
      .bind(await hashPassword(nueva), user.UserID)
      .run();

    console.log('auth.clave-cambiada', payload.username);
    return c.json({ success: true, message: 'Contraseña actualizada' });
  } catch (error: any) {
    console.error('auth.cambiar-clave', error?.message);
    return c.json({ success: false, message: 'No se pudo cambiar la contraseña' }, 500);
  }
});

// Logout endpoint (client-side mainly, server just confirms)
authRouter.post('/logout', async (c) => {
  return c.json({ success: true, message: 'Sesión cerrada exitosamente' });
});
