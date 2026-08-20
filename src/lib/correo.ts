/**
 * Envío de correo.
 *
 * Un Worker no puede entregar correo por su cuenta —no habla SMTP con el
 * mundo—, así que se apoya en un servicio. Hoy Resend, pero lo único que sabe
 * el resto del código es esta función: cambiar de proveedor es reescribir este
 * archivo y nada más.
 *
 * Sin clave configurada no se rompe nada: devuelve `enviado: false` con el
 * motivo, y quien llama decide qué hacer. En desarrollo, `CORREO_MODO_PRUEBA`
 * deja el mensaje en el registro para poder probar sin mandar nada de verdad.
 */

export type CorreoEnv = {
  RESEND_API_KEY?: string;
  CORREO_REMITENTE?: string;
  CORREO_MODO_PRUEBA?: string;
};

export type Resultado = { enviado: boolean; motivo?: string; id?: string };

const REMITENTE_POR_DEFECTO = 'Estela Pura <pedidos@estelapuracr.com>';

export const correoConfigurado = (env: CorreoEnv) =>
  Boolean(env.RESEND_API_KEY || env.CORREO_MODO_PRUEBA === '1');

export async function enviarCorreo(
  env: CorreoEnv,
  destino: string,
  asunto: string,
  html: string,
  texto: string
): Promise<Resultado> {
  if (env.CORREO_MODO_PRUEBA === '1') {
    console.log('correo.prueba', destino, '|', asunto, '|', texto.replace(/\n+/g, ' ').slice(0, 300));
    return { enviado: true, motivo: 'modo prueba' };
  }

  if (!env.RESEND_API_KEY) return { enviado: false, motivo: 'sin configurar' };

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
