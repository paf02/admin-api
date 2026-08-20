/**
 * Envío de correo transaccional.
 *
 * Un Worker no puede mandar correo por su cuenta, así que se apoya en Resend.
 * Todo lo que cambia entre una cuenta y otra —la clave y el remitente— vive en
 * la configuración: acá no hay nada escrito a mano.
 *
 * Si la clave no está puesta, no se rompe nada: se devuelve `enviado: false`
 * con el motivo, y quien llama decide qué contarle a la persona. En desarrollo
 * eso deja el código en el registro para poder probar el flujo completo sin
 * mandar un solo correo de verdad.
 */

export type Env = {
  RESEND_API_KEY?: string;
  CORREO_REMITENTE?: string;
  CORREO_MODO_PRUEBA?: string;
};

export type Resultado = { enviado: boolean; motivo?: string; id?: string };

const REMITENTE_POR_DEFECTO = 'Estela Pura <pedidos@estelapuracr.com>';

export async function enviarCorreo(
  env: Env,
  destino: string,
  asunto: string,
  html: string,
  texto: string
): Promise<Resultado> {
  if (env.CORREO_MODO_PRUEBA === '1') {
    console.log('correo.prueba', destino, asunto, texto);
    return { enviado: true, motivo: 'modo prueba' };
  }

  if (!env.RESEND_API_KEY) {
    console.warn('correo.sin-configurar', destino, asunto);
    return { enviado: false, motivo: 'sin configurar' };
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.CORREO_REMITENTE || REMITENTE_POR_DEFECTO,
        to: [destino],
        subject: asunto,
        html,
        text: texto,
      }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      console.error('correo.fallo', r.status, detalle.slice(0, 300));
      return { enviado: false, motivo: `respuesta ${r.status}` };
    }

    const data: any = await r.json();
    return { enviado: true, id: data?.id };
  } catch (e: any) {
    console.error('correo.error', e?.message);
    return { enviado: false, motivo: 'error de red' };
  }
}

/** Correo del código de ingreso. Texto corto: se lee en la notificación. */
export function plantillaCodigo(codigo: string, minutos: number) {
  const texto =
    `Tu código para entrar a Estela Pura es ${codigo}.\n\n` +
    `Vence en ${minutos} minutos y sirve una sola vez.\n\n` +
    `Si no lo pediste, podés ignorar este mensaje: sin el código nadie entra a tu cuenta.`;

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2d">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px">
    <p style="margin:0 0 24px;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8a7a5c">Estela Pura</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">Tu código para entrar</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3c4657">Escribilo en la página para ver tus pedidos y tu lista de deseos.</p>
    <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:.28em;background:#fff;border:1px solid #e8e0d2;padding:18px 12px;text-align:center">${codigo}</p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280">Vence en ${minutos} minutos y sirve una sola vez.</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">Si no lo pediste, ignorá este mensaje: sin el código nadie entra a tu cuenta.</p>
  </div>
</body></html>`;

  return { asunto: `${codigo} es tu código de Estela Pura`, html, texto };
}
