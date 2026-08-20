/**
 * Correos de seguimiento del pedido.
 *
 * Qué se dice en cada momento y cómo se ve. El «cuándo» lo decide
 * `notifyCustomer.ts`, que es el único que sabe qué le importa al cliente.
 *
 * Reglas que se respetan acá:
 *   · nada de lo que no esté en el pedido: ni fechas de entrega inventadas
 *     ni promesas de tiempo;
 *   · el enlace de seguimiento va siempre que exista, porque es lo que le
 *     permite ver su pedido sin escribirle a nadie;
 *   · versión en texto plano además del HTML, para quien lee sin imágenes.
 */

export type EventoCorreo = 'creado' | 'pago' | 'listo' | 'enviado' | 'entregado' | 'cancelado';

export type PedidoCorreo = {
  NumeroPedido: string | null;
  Cliente?: string | null;
  Total?: number | null;
  MetodoEntrega?: string | null;
  Consulta?: string | null;
};

const ASUNTO: Record<EventoCorreo, (n: string) => string> = {
  creado: (n) => `Recibimos tu pedido ${n}`,
  pago: (n) => `Confirmamos el pago de tu pedido ${n}`,
  listo: (n) => `Tu pedido ${n} está listo`,
  enviado: (n) => `Tu pedido ${n} va en camino`,
  entregado: (n) => `Tu pedido ${n} fue entregado`,
  cancelado: (n) => `Tu pedido ${n} fue cancelado`,
};

const TITULO: Record<EventoCorreo, string> = {
  creado: 'Recibimos tu pedido',
  pago: 'Pago confirmado',
  listo: 'Tu pedido está listo',
  enviado: 'Tu pedido va en camino',
  entregado: 'Pedido entregado',
  cancelado: 'Pedido cancelado',
};

const CUERPO: Record<EventoCorreo, string> = {
  creado:
    'Ya lo tenemos anotado. Te escribimos de nuevo en cuanto haya novedades, y mientras tanto podés ver en qué va desde el enlace de abajo.',
  pago: 'Recibimos tu pago y lo verificamos. Seguimos con la preparación de tu pedido.',
  listo: 'Ya está preparado. Te contactamos para coordinar la entrega.',
  enviado: 'Salió para su destino.',
  entregado: 'Quedó entregado. Gracias por comprar en Estela Pura.',
  cancelado:
    'Este pedido quedó cancelado. Si creés que fue un error, respondé este correo o escribinos por WhatsApp.',
};

const colones = (monto?: number | null) =>
  typeof monto === 'number' ? `₡${Math.round(monto).toLocaleString('es-CR')}` : null;

export function plantillaPedido(evento: EventoCorreo, pedido: PedidoCorreo, sitio: string) {
  const numero = pedido.NumeroPedido || '';
  const nombre = String(pedido.Cliente || '').trim().split(/\s+/)[0];
  const enlace = pedido.Consulta ? `${sitio}/pedido/${numero}?c=${pedido.Consulta}` : null;
  const total = colones(pedido.Total);

  const saludo = nombre ? `Hola, ${nombre}.` : 'Hola.';

  const datos = [
    ['Pedido', numero],
    total ? ['Total', total] : null,
    pedido.MetodoEntrega ? ['Entrega', pedido.MetodoEntrega] : null,
  ].filter(Boolean) as string[][];

  const texto = [
    saludo,
    '',
    `${TITULO[evento]}. ${CUERPO[evento]}`,
    '',
    ...datos.map(([k, v]) => `${k}: ${v}`),
    enlace ? `\nSeguí tu pedido: ${enlace}` : '',
    '',
    `Recibís este correo porque hiciste el pedido ${numero} en Estela Pura.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const filas = datos
    .map(
      ([k, v]) => `<tr>
        <td style="padding:6px 0;font-size:13px;color:#6b7280">${k}</td>
        <td style="padding:6px 0;font-size:14px;color:#0f1b2d;text-align:right">${v}</td>
      </tr>`
    )
    .join('');

  const boton = enlace
    ? `<p style="margin:28px 0 0">
         <a href="${enlace}" style="display:inline-block;background:#0f1b2d;color:#fff;text-decoration:none;padding:13px 26px;font-size:14px">Ver mi pedido</a>
       </p>
       <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;word-break:break-all">${enlace}</p>`
    : '';

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2d">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="margin:0 0 28px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#8a7a5c">Estela Pura</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:600">${TITULO[evento]}</h1>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.65;color:#3c4657">${saludo}</p>
    <p style="margin:0;font-size:15px;line-height:1.65;color:#3c4657">${CUERPO[evento]}</p>
    ${filas ? `<table style="width:100%;margin:26px 0 0;border-top:1px solid #e8e0d2;border-collapse:collapse">${filas}</table>` : ''}
    ${boton}
    <p style="margin:34px 0 0;padding-top:18px;border-top:1px solid #e8e0d2;font-size:12px;line-height:1.6;color:#9ca3af">
      Recibís este correo porque hiciste el pedido ${numero} en Estela Pura.
    </p>
  </div>
</body></html>`;

  return { asunto: ASUNTO[evento](numero), html, texto };
}
