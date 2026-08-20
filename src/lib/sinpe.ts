/**
 * Conciliación de SINPE Móvil.
 *
 * Hoy verificar un pago es: abrir el banco, buscar la transferencia, volver
 * al panel, encontrar el pedido y marcarlo. Esto se queda con la parte
 * aburrida —buscar— y deja la decisión donde tiene que estar.
 *
 * NO marca pagado solo. Propone: «este SINPE de ₡45 000 calza con EP-000123».
 * Confirmar sigue siendo un toque de una persona, porque equivocarse acá
 * significa entregar un perfume que nadie pagó, y dos clientes pueden mandar
 * el mismo monto con minutos de diferencia.
 */

/** Un pedido candidato, con por qué se propuso. */
export type Candidato = {
  VentaID: number;
  NumeroPedido: string | null;
  Cliente: string;
  Telefono: string | null;
  Total: number;
  Fecha: string;
  /** Cuánta confianza hay: 'alta' cuando no hay dudas razonables. */
  confianza: 'alta' | 'media' | 'baja';
  motivo: string;
};

/**
 * Saca el monto de un mensaje de banco.
 *
 * Los bancos escriben los montos de muchas formas: «CRC 45,000.00»,
 * «¢45.000,00», «₡3 500». Se busca el número pegado a la marca de moneda y no
 * el más grande del mensaje: probando con avisos reales, el más grande resultó
 * ser el número de cuenta en un caso y el teléfono del remitente en otros dos.
 */
export function montoDelMensaje(texto: string): number | null {
  const limpio = String(texto || '');

  // Un número suelto no sirve: en estos mensajes conviven el monto, el número
  // de cuenta y el teléfono del remitente, y el más grande suele ser la
  // cuenta. Se busca el que va pegado a una marca de moneda o a la palabra
  // «monto», que es lo que distingue al importe de los demás.
  const NUMERO = String.raw`\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

  const anclas = [
    new RegExp(String.raw`(?:CRC|COL(?:ONES)?|¢|₡)\s*(${NUMERO})`, 'i'),
    new RegExp(String.raw`(${NUMERO})\s*(?:CRC|COL(?:ONES)?|¢|₡)`, 'i'),
    new RegExp(String.raw`monto\s*[:\s]\s*(${NUMERO})`, 'i'),
    new RegExp(String.raw`por\s+(${NUMERO})`, 'i'),
  ];

  for (const ancla of anclas) {
    const encontrado = limpio.match(ancla);
    if (encontrado) {
      const valor = aNumero(encontrado[1]);
      if (valor !== null) return valor;
    }
  }

  return null;
}

/** «45,000.00», «45.000,00» y «3 500» son el mismo monto escrito distinto. */
function aNumero(crudo: string): number | null {
  const decimales = crudo.match(/[.,]\d{1,2}$/);
  const entero = decimales ? crudo.slice(0, crudo.lastIndexOf(decimales[0])) : crudo;
  const valor = Number(entero.replace(/[.,\s]/g, ''));
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** Últimos 8 dígitos de cualquier teléfono que aparezca en el mensaje. */
export function telefonoDelMensaje(texto: string): string | null {
  const candidatos = [...String(texto || '').matchAll(/\b(?:\+?506[\s-]?)?([6-8]\d{3})[\s-]?(\d{4})\b/g)]
    .map((m) => `${m[1]}${m[2]}`);
  return candidatos.length ? candidatos[candidatos.length - 1] : null;
}

/**
 * Busca pedidos que calcen con el monto.
 *
 * Solo mira SINPE sin verificar: un pedido ya pagado o en efectivo no es
 * candidato. Se ordena del más reciente al más viejo porque el pago casi
 * siempre llega minutos después del pedido.
 */
export async function buscarCandidatos(
  db: D1Database,
  monto: number,
  telefono: string | null,
  horas = 72
): Promise<Candidato[]> {
  const { results } = await db
    .prepare(
      `SELECT VentaID, NumeroPedido, Cliente, Telefono, Total, Fecha
         FROM Ventas
        WHERE MetodoPago  = 'SINPE Móvil'
          AND EstadoPago  = 'Verificación requerida'
          AND EstadoVenta <> 'Cancelado'
          AND Total = ?
          AND Fecha >= datetime('now','localtime', ?)
        ORDER BY VentaID DESC`
    )
    .bind(monto, `-${horas} hours`)
    .all<Omit<Candidato, 'confianza' | 'motivo'>>();

  const coincideTelefono = (c: { Telefono: string | null }) =>
    Boolean(telefono && String(c.Telefono ?? '').replace(/\D/g, '').slice(-8) === telefono);

  return results.map((c) => {
    // Monto exacto + teléfono del remitente = no hay duda razonable.
    if (coincideTelefono(c)) {
      return { ...c, confianza: 'alta' as const, motivo: 'Monto y teléfono coinciden' };
    }
    // Un solo pedido esperando ese monto exacto: casi seguro, pero sin el
    // teléfono no se puede descartar del todo.
    if (results.length === 1) {
      return { ...c, confianza: 'alta' as const, motivo: 'Único pedido esperando ese monto' };
    }
    return {
      ...c,
      confianza: 'media' as const,
      motivo: `${results.length} pedidos esperan ese mismo monto`,
    };
  });
}
