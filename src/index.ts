import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth';
import { productsRouter } from './routes/productos';
import { categoriasRouter } from './routes/categorias';
import { marcasRouter } from './routes/marcas';
import { ventasRouter } from './routes/ventas';
import { dashboardRouter } from './routes/dashboard';

type Bindings = {
  DB: D1Database;
  // IMAGES: R2Bucket; // Uncomment when R2 is enabled
  ALLOWED_ORIGINS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware
app.use('/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/', (c) => {
  return c.json({ message: 'PuraTech Store API', version: '1.0.0' });
});

// API Routes
app.route('/api/auth', authRouter);
app.route('/api/productos', productsRouter);
app.route('/api/categorias', categoriasRouter);
app.route('/api/marcas', marcasRouter);
app.route('/api/ventas', ventasRouter);
app.route('/api/dashboard', dashboardRouter);

export default app;
