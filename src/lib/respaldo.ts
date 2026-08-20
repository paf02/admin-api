/**
 * Respaldo de la base.
 *
 * Cloudflare guarda 30 días de historia de D1 y con eso se puede volver atrás,
 * pero eso vive en la misma cuenta y en el mismo servicio que los datos: si se
 * pierde el acceso, se pierden los dos. Esto saca una copia propia, en un
 * bucket aparte, que se puede bajar y guardar donde uno quiera.
 *
 * Qué se copia: todo lo que no se puede volver a generar —pedidos, su detalle,
 * su historial, los movimientos de inventario— y el catálogo, que sí se podría
 * rehacer pero cuesta tiempo.
 *
 * Qué NO se copia, a propósito:
 * - Las contraseñas. Un respaldo que anda dando vueltas no debería llevarlas;
 *   los usuarios se vuelven a crear en dos minutos.
 * - Las suscripciones de avisos: son llaves de dispositivos, se regeneran solas
 *   cuando alguien vuelve a activar los avisos.
 * - Los intentos de login: ruido que se borra solo al día.
 */

export type RespaldoEnv = {
  DB: D1Database;
  RESPALDOS?: R2Bucket;
};

/** Tablas que entran, con la consulta exacta que las lee. */
const TABLAS: { nombre: string; sql: string }[] = [
  { nombre: 'Ventas', sql: 'SELECT * FROM Ventas ORDER BY VentaID' },
  { nombre: 'DetalleVenta', sql: 'SELECT * FROM DetalleVenta ORDER BY DetalleID' },
  { nombre: 'VentaHistorial', sql: 'SELECT * FROM VentaHistorial ORDER BY HistorialID' },
  { nombre: 'MovimientosInventario', sql: 'SELECT * FROM MovimientosInventario ORDER BY MovimientoID' },
  { nombre: 'Productos', sql: 'SELECT * FROM Productos ORDER BY ProductoID' },
  { nombre: 'Categorias', sql: 'SELECT * FROM Categorias ORDER BY CategoriaID' },
  { nombre: 'Marcas', sql: 'SELECT * FROM Marcas ORDER BY MarcaID' },
  { nombre: 'PedidosBorrador', sql: 'SELECT * FROM PedidosBorrador ORDER BY BorradorID' },
  // Sin PasswordHash: un respaldo no es lugar para eso
  { nombre: 'Users', sql: 'SELECT UserID, Username, FullName, Email, Role, Active, CreatedAt, LastLogin FROM Users ORDER BY UserID' },
  // Las cuentas de cliente son lo único que no se puede volver a armar desde
  // otro lado: quien se registró, su dirección y su lista de deseos. Igual que
  // el panel, sin PasswordHash.
  {
    nombre: 'Clientes',
    sql: `SELECT ClienteID, Correo, Nombre, Telefono, Provincia, Canton, Distrito,
                 DireccionExacta, Waze, CreadoEn, UltimoAcceso
            FROM Clientes ORDER BY ClienteID`,
  },
  { nombre: 'ClientesFavoritos', sql: 'SELECT * FROM ClientesFavoritos ORDER BY ClienteID' },
  // Quién pidió que le avisen cuando algo vuelva: es una venta esperando
  { nombre: 'AvisosStock', sql: 'SELECT * FROM AvisosStock ORDER BY AvisoID' },
  // Qué se le avisó a cada pedido, para no repetir un correo al restaurar
  { nombre: 'CorreosPedido', sql: 'SELECT * FROM CorreosPedido ORDER BY VentaID' },
];

export type Respaldo = {
  generadoEn: string;
  origen: string;
  filas: Record<string, number>;
  datos: Record<string, unknown[]>;
};

/** Lee todo y arma el objeto del respaldo. Una tabla que no existe se salta. */
export async function armarRespaldo(env: RespaldoEnv, origen = 'programado'): Promise<Respaldo> {
  const datos: Record<string, unknown[]> = {};
  const filas: Record<string, number> = {};

  for (const tabla of TABLAS) {
    try {
      const { results } = await env.DB.prepare(tabla.sql).all();
      datos[tabla.nombre] = results ?? [];
      filas[tabla.nombre] = results?.length ?? 0;
    } catch (error: any) {
      // Una tabla que todavía no existe no puede dejar sin respaldo al resto
      console.warn('respaldo.tabla', tabla.nombre, error?.message);
      filas[tabla.nombre] = -1;
    }
  }

  return {
    generadoEn: new Date().toISOString(),
    origen,
    filas,
    datos,
  };
}

const nombreDeArchivo = (fecha: Date) =>
  `respaldos/${fecha.toISOString().slice(0, 10)}-${fecha
    .toISOString()
    .slice(11, 16)
    .replace(':', '')}.json`;

export type ResultadoRespaldo = {
  ok: boolean;
  archivo?: string;
  bytes?: number;
  filas?: Record<string, number>;
  error?: string;
};

/**
 * Guarda el respaldo en R2 y deja solo los últimos 30.
 * Nunca lanza: un respaldo que falla se registra, no tumba nada.
 */
export async function guardarRespaldo(
  env: RespaldoEnv,
  origen = 'programado'
): Promise<ResultadoRespaldo> {
  if (!env.RESPALDOS) {
    console.error('respaldo.sin-bucket');
    return { ok: false, error: 'El bucket de respaldos no está configurado' };
  }

  try {
    const respaldo = await armarRespaldo(env, origen);
    const cuerpo = JSON.stringify(respaldo, null, 1);
    const archivo = nombreDeArchivo(new Date());

    await env.RESPALDOS.put(archivo, cuerpo, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        origen,
        pedidos: String(respaldo.filas.Ventas ?? 0),
        productos: String(respaldo.filas.Productos ?? 0),
      },
    });

    await podar(env.RESPALDOS);

    console.log('respaldo.ok', archivo, cuerpo.length, JSON.stringify(respaldo.filas));
    return { ok: true, archivo, bytes: cuerpo.length, filas: respaldo.filas };
  } catch (error: any) {
    console.error('respaldo.error', error?.message);
    return { ok: false, error: error?.message?.slice(0, 200) };
  }
}

const MAXIMO = 30;

/** Deja los 30 más recientes: suficiente historia sin acumular para siempre. */
async function podar(bucket: R2Bucket) {
  const lista = await bucket.list({ prefix: 'respaldos/' });
  if (lista.objects.length <= MAXIMO) return;

  const sobrantes = lista.objects
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, lista.objects.length - MAXIMO);

  for (const objeto of sobrantes) await bucket.delete(objeto.key);
  console.log('respaldo.podados', sobrantes.length);
}
