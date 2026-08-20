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

/**
 * Referencia del banco, si el aviso la trae.
 *
 * El BN la manda como «Referencia 2026081915183010572088162». Guardarla en el
 * pedido es lo que después permite cotejar contra el estado de cuenta sin
 * adivinar cuál transferencia fue cuál.
 */
export function referenciaDelMensaje(texto: string): string | null {
  const conEtiqueta = String(texto || '').match(/referencia\s*[:#]?\s*(\d{6,})/i);
  if (conEtiqueta) return conEtiqueta[1];

  // Sin la palabra «referencia», una tira larga de dígitos suele serlo; el
  // monto y el teléfono ya se leyeron aparte y son más cortos.
  const larga = String(texto || '').match(/\b(\d{15,})\b/);
  return larga ? larga[1] : null;
}

/**
 * Teléfono de quien envió, si el aviso lo trae.
 *
 * Ojo: varios bancos incluyen la cuenta que RECIBE, no la que envía. El BN
 * escribe «JD-87309445», que es el número de la propia tienda. Si eso se
 * tomara como el teléfono del cliente, «coincide el teléfono» nunca calzaría
 * —o peor, calzaría con quien no es—. Por eso el número propio se descarta.
 */
export function telefonoDelMensaje(texto: string, propio?: string | null): string | null {
  const mio = String(propio ?? '').replace(/\D/g, '').slice(-8);

  const candidatos = [...String(texto || '').matchAll(/\b(?:\+?506[\s-]?)?([6-8]\d{3})[\s-]?(\d{4})\b/g)]
    .map((m) => `${m[1]}${m[2]}`)
    .filter((n) => !mio || n !== mio);

  return candidatos.length ? candidatos[candidatos.length - 1] : null;
}

/**
 * Nombre de quien envió. Es el único dato del remitente que trae el aviso del
 * BN, así que sirve para desempatar cuando varios pedidos comparten monto.
 */
export function nombreDelMensaje(texto: string): string | null {
  const encontrado = String(texto || '').match(/\bde\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{4,60}?)\s*[.,]/);
  return encontrado ? encontrado[1].trim() : null;
}

/** Palabras de un nombre, sin conectores ni tildes, para comparar. */
const palabras = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 2 && !['de', 'la', 'del', 'los'].includes(p));

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
  nombre: string | null = null,
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

  const orden = { alta: 0, media: 1, baja: 2 };

  // El BN no manda el teléfono de quien envía, solo el nombre. Comparar por
  // nombre desempata cuando varios pedidos comparten monto: se exige que
  // coincidan dos palabras (nombre y apellido), porque solo «Luis» calzaría
  // con demasiada gente.
  const delRemitente = nombre ? palabras(nombre) : [];
  const coincideNombre = (c: { Cliente: string }) => {
    if (delRemitente.length < 2) return false;
    const suyas = palabras(c.Cliente || '');
    return suyas.filter((p) => delRemitente.includes(p)).length >= 2;
  };

  return results.map((c) => {
    // Monto exacto + teléfono del remitente = no hay duda razonable.
    if (coincideTelefono(c)) {
      return { ...c, confianza: 'alta' as const, motivo: 'Monto y teléfono coinciden' };
    }
    if (coincideNombre(c)) {
      return { ...c, confianza: 'alta' as const, motivo: 'Monto y nombre coinciden' };
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
  })
    // El más probable primero: con seis pedidos del mismo monto, el que además
    // calza por teléfono no debería quedar sepultado por ser más viejo.
    .sort((a, b) => orden[a.confianza] - orden[b.confianza]);
}
