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
import { expireUnverifiedSinpe } from './lib/expireOrders';
import { respaldosRouter } from './routes/respaldos';
import { reportesRouter } from './routes/reportes';
import { visitasRouter } from './routes/visitas';
import { avisosRouter } from './routes/avisos';
import { guardarRespaldo } from './lib/respaldo';

/** Cron del respaldo diario; el resto de crons solo corren la caducidad. */
const RESPALDO_CRON = '0 7 * * *';

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
app.route('/api/respaldos', respaldosRouter);
app.route('/api/reportes', reportesRouter);
app.route('/api/visitas', visitasRouter);
app.route('/api/avisos', avisosRouter);

/**
 * El Worker atiende peticiones y, una vez al día, saca el respaldo.
 *
 * `scheduled` corre por el cron configurado en wrangler.toml. Si el respaldo
 * falla queda en el log y se vuelve a intentar al día siguiente: nada de esto
 * afecta a la tienda ni al panel.
 */
export default {
  fetch: app.fetch,
  async scheduled(evento: ScheduledEvent, env: any, ctx: ExecutionContext) {
    // El respaldo es diario; su cron es el de las 07:00 UTC.
    if (evento.cron === RESPALDO_CRON) {
      ctx.waitUntil(guardarRespaldo(env, 'programado'));
    }

    // La caducidad corre cada hora: las existencias de un SINPE abandonado
    // deben volver a la tienda sin esperar al respaldo del día siguiente.
    ctx.waitUntil(
      expireUnverifiedSinpe(env.DB)
        .then((r) => {
          if (r.revisados > 0) console.log('expire.sinpe', JSON.stringify(r));
        })
        // Nunca se relanza: que falle la caducidad no puede tumbar el respaldo
        // ni marcar el Worker como caído.
        .catch((error: any) => console.error('expire.sinpe.error', error?.message))
    );
  },
};
