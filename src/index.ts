import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth';
import { productsRouter } from './routes/productos';
import { categoriasRouter } from './routes/categorias';
import { marcasRouter } from './routes/marcas';
import { ventasRouter } from './routes/ventas';
import { dashboardRouter } from './routes/dashboard';
import { inventarioRouter } from './routes/inventario';
import { pushRouter } from './routes/push';
import { whatsappRouter } from './routes/whatsapp';

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
  // PATCH es obligatorio: el panel cambia estados de pedido, verifica pagos y
  // ajusta existencias con PATCH. Sin él, el navegador bloquea la petición en
  // el preflight y la pantalla solo ve «sin conexión».
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
app.route('/api/inventario', inventarioRouter);
app.route('/api/push', pushRouter);
app.route('/api/whatsapp', whatsappRouter);

export default app;
