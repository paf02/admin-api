/**
 * Correos de la cuenta: confirmar el correo y elegir contraseña nueva.
 *
 * Mismas reglas que los correos de pedido: HTML y texto plano, nada que no
 * sea cierto, y el enlace también escrito a la vista para quien no puede
 * tocar el botón.
 *
 * Nunca se manda una contraseña, ni temporal. Una contraseña en un correo
 * queda en claro en el buzón, en el historial del proveedor de envío y en
 * cualquier reenvío; un enlace de un solo uso que vence, no.
 */
import { correoConfigurado, enviarCorreo, type CorreoEnv, type Resultado } from './correo';
import type { TipoToken } from './tokensCuenta';

export type CorreoCuentaEnv = CorreoEnv & { SITE_URL?: string };

const TEXTOS: Record<TipoToken, {
  asunto: string;
  titulo: string;
  cuerpo: string;
  boton: string;
  ruta: string;
  fine: string;
}> = {
  verificacion: {
    asunto: 'Confirmá tu correo',
    titulo: 'Confirmá tu correo',
    cuerpo:
      'Creaste tu cuenta en Estela Pura. Confirmá que esta dirección es tuya y vas a poder ver tus pedidos desde la tienda.',
    boton: 'Confirmar mi correo',
    ruta: '/cuenta/verificar',
    fine:
      'El enlace vence en 24 horas. Si no fuiste vos, ignorá este mensaje: sin confirmar, esa cuenta no ve ningún pedido.',
  },
  clave: {
    asunto: 'Cambiar tu contraseña',
    titulo: 'Elegí una contraseña nueva',
    cuerpo:
      'Pediste volver a entrar a tu cuenta de Estela Pura. Elegí tu contraseña nueva desde acá.',
    boton: 'Elegir contraseña nueva',
    ruta: '/cuenta/nueva-clave',
    fine:
      'El enlace vence en 1 hora y sirve una sola vez. Si no lo pediste, no hace falta que hagas nada: tu contraseña sigue siendo la misma.',
  },
};

export function plantillaCuenta(tipo: TipoToken, token: string, sitio: string) {
  const t = TEXTOS[tipo];
  const enlace = `${sitio}${t.ruta}?t=${encodeURIComponent(token)}`;

  const texto = [
    'Hola.',
    '',
    `${t.titulo}. ${t.cuerpo}`,
    '',
    enlace,
    '',
    t.fine,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2d">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="margin:0 0 28px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#8a7a5c">Estela Pura</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:600">${t.titulo}</h1>
    <p style="margin:0;font-size:15px;line-height:1.65;color:#3c4657">${t.cuerpo}</p>
    <p style="margin:28px 0 0">
      <a href="${enlace}" style="display:inline-block;background:#0f1b2d;color:#fff;text-decoration:none;padding:13px 26px;font-size:14px">${t.boton}</a>
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;word-break:break-all">${enlace}</p>
    <p style="margin:34px 0 0;padding-top:18px;border-top:1px solid #e8e0d2;font-size:12px;line-height:1.6;color:#9ca3af">
      ${t.fine}
    </p>
  </div>
</body></html>`;

  return { asunto: t.asunto, html, texto };
}

/**
 * Manda el correo. Nunca lanza: quien llama decide qué hacer con
 * `enviado: false`, igual que en los avisos de pedido.
 */
export async function enviarCorreoCuenta(
  env: CorreoCuentaEnv,
  destino: string,
  tipo: TipoToken,
  token: string
): Promise<Resultado> {
  if (!correoConfigurado(env)) return { enviado: false, motivo: 'sin configurar' };

  const sitio = (env.SITE_URL || 'https://estelapuracr.com').replace(/\/$/, '');
  const { asunto, html, texto } = plantillaCuenta(tipo, token, sitio);

  try {
    return await enviarCorreo(env, destino, asunto, html, texto);
  } catch (error: any) {
    console.error('correoCuenta.error', error?.message);
    return { enviado: false, motivo: 'error' };
  }
}
