/**
 * Aviso por correo de un cambio en el pedido.
 *
 * Se ocupa de todo lo que no es redactar: buscar el pedido, no repetir un
 * aviso ya enviado, dejar constancia en el historial y nunca dejar que un
 * fallo de correo estropee la operación que lo disparó.
 *
 * Nunca lanza. Un pedido que cambió de estado ya cambió de estado: que el
 * correo no salga es un problema del correo, no del pedido.
 */
import { correoConfigurado, enviarCorreo, type CorreoEnv } from './correo';
import { plantillaPedido, type EventoCorreo, type PedidoCorreo } from './correoPedido';

export type AvisoCorreoEnv = CorreoEnv & {
  DB?: D1Database;
  SITE_URL?: string;
};

type Fila = PedidoCorreo & { VentaID: number; Email: string | null };

const buscar = (db: D1Database, porNumero: string) =>
  db
    .prepare(
      `SELECT VentaID, NumeroPedido, Cliente, Email, Total, MetodoEntrega, Consulta
         FROM Ventas WHERE NumeroPedido = ?`
    )
    .bind(porNumero)
    .first<Fila>();

const buscarPorId = (db: D1Database, id: number) =>
  db
    .prepare(
      `SELECT VentaID, NumeroPedido, Cliente, Email, Total, MetodoEntrega, Consulta
         FROM Ventas WHERE VentaID = ?`
    )
    .bind(id)
    .first<Fila>();

/**
 * @param referencia número de pedido (`EP-000123`) o VentaID.
 */
export async function avisarPorCorreo(
  env: AvisoCorreoEnv,
  evento: EventoCorreo,
  referencia: string | number
): Promise<void> {
  try {
    if (!env.DB || !correoConfigurado(env)) return;

    const venta =
      typeof referencia === 'number'
        ? await buscarPorId(env.DB, referencia)
        : await buscar(env.DB, referencia);

    const destino = String(venta?.Email ?? '').trim();
    if (!venta || !destino) return; // pedido tomado por teléfono, sin correo

    // Se aparta el turno antes de enviar: si dos cosas disparan el mismo
    // aviso a la vez, solo una pasa de acá.
    const apartado = await env.DB.prepare(
      `INSERT INTO CorreosPedido (VentaID, Evento, Destino) VALUES (?, ?, ?)
       ON CONFLICT (VentaID, Evento) DO NOTHING`
    )
      .bind(venta.VentaID, evento, destino)
      .run();

    if (!apartado.meta?.changes) return; // ya se había avisado

    const sitio = (env.SITE_URL || 'https://estelapuracr.com').replace(/\/$/, '');
    const { asunto, html, texto } = plantillaPedido(evento, venta, sitio);
    const res = await enviarCorreo(env, destino, asunto, html, texto);

    if (!res.enviado) {
      // Se libera el turno para que un intento posterior pueda volver
      await env.DB.prepare(`DELETE FROM CorreosPedido WHERE VentaID = ? AND Evento = ?`)
        .bind(venta.VentaID, evento)
        .run();
      console.error('avisoCorreo.fallo', evento, venta.NumeroPedido, res.motivo);
      return;
    }

    // Queda a la vista en el historial del pedido, en el panel
    await env.DB.prepare(
      `INSERT INTO VentaHistorial (VentaID, Accion, Detalle, Usuario) VALUES (?, ?, ?, ?)`
    )
      .bind(venta.VentaID, 'Correo', `Aviso «${evento}» enviado a ${destino}`, 'sistema')
      .run();
  } catch (error: any) {
    console.error('avisoCorreo.error', evento, error?.message);
  }
}
