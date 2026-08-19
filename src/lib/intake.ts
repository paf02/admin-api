/**
 * Lectura de un mensaje de WhatsApp para armar un borrador de pedido.
 *
 * Regla que manda sobre todo lo demás: **acá no se inventa nada**. Los
 * productos, los precios y las existencias salen del catálogo de la base; si
 * un pedazo del mensaje no se reconoce, queda anotado como no reconocido y lo
 * resuelve una persona. El resultado es un borrador para revisar, nunca una
 * venta: el pedido real lo sigue creando el panel.
 */

export type ProductoCatalogo = {
  ProductoID: number;
  Nombre: string;
  PrecioVenta: number;
  Stock: number;
  MarcaNombre?: string | null;
  CategoriaNombre?: string | null;
};

export type LineaBorrador = {
  productoId: number;
  nombre: string;
  cantidad: number;
  precio: number;
  subtotal: number;
  stock: number;
};

export type Borrador = {
  intencion: 'compra' | 'consulta' | 'saludo' | 'otro';
  lineas: LineaBorrador[];
  total: number;
  noReconocido: string[];
};

const sinTildes = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/* Palabras que no distinguen a un producto de otro. */
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'para', 'por', 'con', 'y', 'o', 'en',
  'perfume', 'perfumes', 'decant', 'decants', 'eau', 'parfum', 'toilette',
  'edp', 'edt', 'ml', 'hombre', 'mujer', 'man', 'woman', 'pour', 'femme',
]);

/*
 * Cortesías y muletillas. No son productos, así que no tienen por qué
 * ensuciar la lista de «no reconocido» que revisa una persona.
 */
const CORTESIA = new Set([
  'hola', 'holi', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'gracias',
  'favor', 'porfa', 'porfavor', 'saludos', 'disculpe', 'disculpa', 'perdon',
  'quisiera', 'quiero', 'ocupo', 'necesito', 'comprar', 'pedido', 'pedir',
  'cuanto', 'cuesta', 'vale', 'precio', 'precios', 'tienen', 'tenes', 'hay',
  'disponible', 'disponibles', 'stock', 'usted', 'ustedes', 'este', 'esta',
  'como', 'para', 'sobre', 'tambien', 'pero', 'muy', 'mucho', 'algo',
]);

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

const VERBOS_COMPRA =
  /\b(quiero|quisiera|dame|deme|mandame|mandeme|enviame|env[ií]enme|comprar|compro|pedir|pido|pedido|llevo|llevar|ocupo|necesito|separame|apartame)\b/;
const PALABRAS_CONSULTA =
  /\b(precio|precios|cuanto|cuánto|cuesta|vale|valen|tienen|tenes|ten[eé]s|hay|disponible|disponibles|stock|existencia)\b/;
const SALUDOS = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|holi)[\s!.,]*$/;

/** Palabras propias de cada producto, ya sin marca genérica ni relleno. */
function clavesDe(producto: ProductoCatalogo): string[] {
  const nombre = sinTildes(producto.Nombre).replace(/[^a-z0-9\s]/g, ' ');
  return nombre
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 && !VACIAS.has(palabra) && !/^\d+$/.test(palabra));
}

/** Tamaño en ml que menciona el producto (100 ml del sellado, 5 ml del decant). */
const mlDe = (texto: string) => {
  const match = /(\d+(?:[.,]\d+)?)\s*ml/i.exec(texto);
  return match ? Number(match[1].replace(',', '.')) : null;
};

/** Cantidad pedida junto al nombre: «2 yara», «yara x3», «dos eros». */
function cantidadCerca(mensaje: string, posicion: number): number {
  const antes = mensaje.slice(Math.max(0, posicion - 18), posicion);
  const despues = mensaje.slice(posicion, posicion + 24);

  const porX = /\bx\s?(\d{1,2})\b/.exec(despues);
  if (porX) return Math.min(20, Number(porX[1]));

  const digito = /(\d{1,2})\s*(?:unidades?|frascos?|pzas?\.?)?\s*$/.exec(antes);
  if (digito) return Math.min(20, Number(digito[1]));

  const palabra = /\b([a-z]+)\s*$/.exec(antes);
  if (palabra && NUMEROS[palabra[1]]) return NUMEROS[palabra[1]];

  return 1;
}

/**
 * Arma el borrador a partir del texto y del catálogo vigente.
 *
 * El producto gana por cantidad de palabras propias que aparecen en el
 * mensaje; el tamaño en ml desempata entre el frasco completo y su decant,
 * que comparten nombre.
 */
export function leerMensaje(texto: string, catalogo: ProductoCatalogo[]): Borrador {
  const mensaje = sinTildes(texto);
  const mlPedido = mlDe(mensaje);

  type Candidato = { producto: ProductoCatalogo; aciertos: number; posicion: number; ml: number | null };
  const candidatos: Candidato[] = [];

  for (const producto of catalogo) {
    const claves = clavesDe(producto);
    if (!claves.length) continue;

    let aciertos = 0;
    let posicion = -1;
    for (const clave of claves) {
      const encontrado = mensaje.indexOf(clave);
      if (encontrado === -1) continue;
      aciertos += 1;
      if (posicion === -1 || encontrado < posicion) posicion = encontrado;
    }

    if (aciertos > 0) {
      candidatos.push({ producto, aciertos, posicion, ml: mlDe(producto.Nombre) });
    }
  }

  // Se agrupan por nombre base para no ofrecer el sellado y su decant a la vez
  const porFragancia = new Map<string, Candidato[]>();
  for (const candidato of candidatos) {
    const base = clavesDe(candidato.producto).sort().join('-');
    const lista = porFragancia.get(base) || [];
    lista.push(candidato);
    porFragancia.set(base, lista);
  }

  const lineas: LineaBorrador[] = [];

  for (const grupo of porFragancia.values()) {
    // Mejor coincidencia del grupo: más palabras propias y, si el mensaje
    // pide un tamaño, el que coincide con ese tamaño.
    const elegido = grupo
      .slice()
      .sort((a, b) => {
        const coincideMl = (c: Candidato) => (mlPedido && c.ml === mlPedido ? 1 : 0);
        if (coincideMl(a) !== coincideMl(b)) return coincideMl(b) - coincideMl(a);
        if (a.aciertos !== b.aciertos) return b.aciertos - a.aciertos;
        return a.producto.PrecioVenta - b.producto.PrecioVenta;
      })[0];

    // Una sola palabra en común es demasiado poco salvo que sea inconfundible
    if (elegido.aciertos === 0) continue;

    const cantidad = cantidadCerca(mensaje, elegido.posicion);
    const precio = Number(elegido.producto.PrecioVenta) || 0;

    lineas.push({
      productoId: elegido.producto.ProductoID,
      nombre: elegido.producto.Nombre,
      cantidad,
      precio,
      subtotal: precio * cantidad,
      stock: Number(elegido.producto.Stock) || 0,
    });
  }

  const hayVerboCompra = VERBOS_COMPRA.test(mensaje);
  const hayConsulta = PALABRAS_CONSULTA.test(mensaje);

  const intencion: Borrador['intencion'] = lineas.length
    ? hayVerboCompra || !hayConsulta
      ? 'compra'
      : 'consulta'
    : SALUDOS.test(mensaje.trim())
      ? 'saludo'
      : hayConsulta || hayVerboCompra
        ? 'consulta'
        : 'otro';

  // Lo que el mensaje nombra y el catálogo no reconoce, para que se vea
  const reconocidas = new Set(
    lineas.flatMap((linea) => clavesDe({ ...linea, Nombre: linea.nombre } as ProductoCatalogo))
  );
  const noReconocido = mensaje
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (palabra) =>
        palabra.length > 3 &&
        !VACIAS.has(palabra) &&
        !CORTESIA.has(palabra) &&
        !NUMEROS[palabra] &&
        !reconocidas.has(palabra) &&
        !VERBOS_COMPRA.test(palabra) &&
        !PALABRAS_CONSULTA.test(palabra)
    );

  return {
    intencion,
    lineas,
    total: lineas.reduce((suma, linea) => suma + linea.subtotal, 0),
    noReconocido: [...new Set(noReconocido)].slice(0, 8),
  };
}

const colones = (monto: number) => `₡${Math.round(monto).toLocaleString('es-CR')}`;

/**
 * Respuesta automática.
 *
 * Confirma lo entendido y deja claro que **falta que una persona confirme**:
 * el bot no promete existencias, ni tiempos, ni cierra la venta.
 */
export function respuestaPara(borrador: Borrador, nombre?: string | null): string {
  const saludo = nombre ? `¡Hola, ${nombre.split(' ')[0]}!` : '¡Hola!';

  if (borrador.intencion === 'saludo' || (!borrador.lineas.length && borrador.intencion === 'otro')) {
    return `${saludo} Gracias por escribir a Estela Pura. Contanos qué fragancia buscás —o el tamaño de decant— y te ayudamos. También podés ver el catálogo completo en estelapuracr.com`;
  }

  if (!borrador.lineas.length) {
    return `${saludo} Con gusto te ayudamos. No logré identificar el producto en tu mensaje; escribinos el nombre de la fragancia (por ejemplo «Yara 5 ml») y lo confirmamos enseguida.`;
  }

  const detalle = borrador.lineas
    .map((linea) => `• ${linea.cantidad} × ${linea.nombre} — ${colones(linea.precio)} c/u`)
    .join('\n');

  const encabezado =
    borrador.intencion === 'compra'
      ? `${saludo} Anoté esto de tu mensaje:`
      : `${saludo} Estos son los precios de lo que consultás:`;

  const cierre =
    borrador.intencion === 'compra'
      ? 'En un momento te confirmamos disponibilidad y coordinamos entrega y pago. Si querés cambiar algo, escribilo por acá.'
      : '¿Querés que te lo aparte? Decinos y lo dejamos listo.';

  return `${encabezado}\n\n${detalle}\n\nTotal: ${colones(borrador.total)}\n\n${cierre}`;
}
