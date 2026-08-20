/**
 * Fichas olfativas de las fragancias que la tienda vende o puede llegar a
 * vender, para no escribirlas a mano en cada alta.
 *
 * De dónde salen: son las pirámides publicadas de cada perfume, las mismas que
 * ya estaban cargadas a mano en la tienda (`src/data/productNotes.js`) y que
 * cualquiera puede cotejar en Fragrantica. **Nada acá está inventado.** Un
 * perfume del que no se tenga la pirámide verificada no se agrega a esta
 * lista: es preferible escribirla a mano una vez que publicar notas falsas en
 * la ficha de producto.
 *
 * Cómo se usa: es un punto de partida. Al elegir una fragancia en el panel,
 * los campos quedan llenos y **editables**; lo que se publica es lo que quedó
 * en el formulario, no esto.
 *
 * Cómo se agrega una: copiar un bloque, poner marca y nombre tal como se
 * venden, y llenar la pirámide de la concentración exacta (el EDT y el EDP de
 * un mismo perfume no huelen igual ni comparten notas).
 */
export type Ficha = {
  marca: string;
  nombre: string;
  concentracion?: string;
  genero: 'hombre' | 'mujer';
  familia: string;
  anio?: number;
  salida: string[];
  corazon: string[];
  fondo: string[];
};

export const FRAGANCIAS: Ficha[] = [
  // ── Lattafa ──────────────────────────────────────────────────────────
  {
    marca: 'Lattafa', nombre: 'Khamrah', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental especiado', anio: 2022,
    salida: ['Canela', 'Dátil', 'Bergamota', 'Nuez moscada'],
    corazon: ['Praliné', 'Haba tonka', 'Azahar'],
    fondo: ['Vainilla', 'Benjuí', 'Mirra', 'Ámbar', 'Almizcle'],
  },
  {
    marca: 'Lattafa', nombre: 'Khamrah Qahwa', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental gourmand', anio: 2023,
    salida: ['Café', 'Canela', 'Nuez moscada'],
    corazon: ['Dátil', 'Praliné', 'Azahar'],
    fondo: ['Vainilla', 'Haba tonka', 'Benjuí', 'Almizcle'],
  },
  {
    marca: 'Lattafa', nombre: 'Asad', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2022,
    salida: ['Pimienta negra', 'Piña', 'Bergamota'],
    corazon: ['Café', 'Violeta', 'Lavanda'],
    fondo: ['Vainilla', 'Cedro', 'Ámbar', 'Pachulí'],
  },
  {
    marca: 'Lattafa', nombre: 'Yara', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral gourmand', anio: 2020,
    salida: ['Orquídea', 'Heliotropo'],
    corazon: ['Notas gourmand', 'Almizcle'],
    fondo: ['Sándalo', 'Vainilla', 'Haba tonka'],
  },
  {
    marca: 'Lattafa', nombre: 'Yara Moi', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral frutal', anio: 2023,
    salida: ['Frutas rojas', 'Mandarina'],
    corazon: ['Jazmín', 'Orquídea'],
    fondo: ['Vainilla', 'Almizcle', 'Sándalo'],
  },
  {
    marca: 'Lattafa', nombre: 'Fakhar', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2021,
    salida: ['Bergamota', 'Manzana', 'Cardamomo'],
    corazon: ['Lavanda', 'Jazmín', 'Geranio'],
    fondo: ['Ámbar', 'Pachulí', 'Almizcle', 'Vainilla'],
  },
  {
    marca: 'Lattafa', nombre: 'Raghba', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental amaderado', anio: 2014,
    salida: ['Vainilla', 'Azúcar'],
    corazon: ['Notas amaderadas', 'Incienso'],
    fondo: ['Oud', 'Sándalo', 'Almizcle', 'Ámbar'],
  },
  {
    marca: 'Lattafa', nombre: "Bade'e Al Oud Oud for Glory", concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2022,
    salida: ['Azafrán', 'Nuez moscada'],
    corazon: ['Agarwood (oud)', 'Pachulí'],
    fondo: ['Almizcle', 'Haba tonka', 'Olíbano'],
  },
  {
    marca: 'Lattafa', nombre: 'Ana Abiyedh Rouge', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral amaderado', anio: 2019,
    salida: ['Bergamota', 'Cardamomo'],
    corazon: ['Rosa', 'Jazmín', 'Azafrán'],
    fondo: ['Sándalo', 'Ámbar', 'Almizcle'],
  },
  {
    marca: 'Lattafa', nombre: 'Ansaam Gold', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral dulce', anio: 2022,
    salida: ['Frutas', 'Bergamota'],
    corazon: ['Flores blancas', 'Vainilla'],
    fondo: ['Ámbar', 'Almizcle', 'Maderas'],
  },

  // ── Armaf ────────────────────────────────────────────────────────────
  {
    marca: 'Armaf', nombre: 'Club de Nuit Intense Man', concentracion: 'EDT', genero: 'hombre',
    familia: 'Chipre frutal', anio: 2015,
    salida: ['Piña', 'Grosella negra', 'Manzana', 'Bergamota', 'Limón', 'Rosa'],
    corazon: ['Abedul', 'Jazmín', 'Pachulí'],
    fondo: ['Almizcle', 'Ámbar gris', 'Vainilla'],
  },
  {
    // Se vende como unisex; la tienda solo tiene hombre y mujer, así que el
    // género acá es una sugerencia y el formulario lo deja cambiar.
    marca: 'Armaf', nombre: 'Club de Nuit Untold', concentracion: 'EDP', genero: 'mujer',
    familia: 'Ambarado floral', anio: 2021,
    salida: ['Azafrán', 'Jazmín'],
    corazon: ['Ambroxan', 'Resina de abeto'],
    fondo: ['Cedro', 'Ámbar gris'],
  },
  {
    marca: 'Armaf', nombre: 'Club de Nuit Sillage', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2018,
    salida: ['Bergamota', 'Pomelo', 'Cardamomo'],
    corazon: ['Lavanda', 'Cedro', 'Vetiver'],
    fondo: ['Ámbar', 'Almizcle', 'Pachulí'],
  },

  // ── Versace ──────────────────────────────────────────────────────────
  {
    marca: 'Versace', nombre: 'Eros', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado oriental', anio: 2012,
    salida: ['Menta', 'Manzana verde', 'Limón de Italia'],
    corazon: ['Haba tonka', 'Ambroxan', 'Geranio', 'Vainilla'],
    fondo: ['Cedro del Atlas', 'Cedro de Virginia', 'Vetiver', 'Musgo de roble'],
  },
  {
    marca: 'Versace', nombre: 'Eros Flame', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2018,
    salida: ['Limón', 'Pimienta negra', 'Mandarina', 'Chinotto', 'Romero'],
    corazon: ['Geranio', 'Rosa', 'Pimienta'],
    fondo: ['Vainilla', 'Haba tonka', 'Sándalo', 'Cedro', 'Pachulí', 'Olíbano'],
  },
  {
    marca: 'Versace', nombre: 'Dylan Blue', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2016,
    salida: ['Bergamota', 'Pomelo', 'Hoja de higo', 'Notas acuáticas'],
    corazon: ['Hoja de violeta', 'Papiro', 'Pachulí', 'Pimienta negra', 'Ambroxan'],
    fondo: ['Almizcle', 'Haba tonka', 'Incienso', 'Azafrán'],
  },
  {
    marca: 'Versace', nombre: 'Bright Crystal', concentracion: 'EDT', genero: 'mujer',
    familia: 'Floral frutal', anio: 2006,
    salida: ['Granada', 'Yuzu', 'Notas heladas'],
    corazon: ['Peonía', 'Magnolia', 'Loto'],
    fondo: ['Ámbar vegetal', 'Almizcle', 'Caoba'],
  },
  {
    marca: 'Versace', nombre: 'Eros Pour Femme', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral amaderado', anio: 2013,
    salida: ['Limón de Sicilia', 'Bergamota de Calabria', 'Granada'],
    corazon: ['Jazmín sambac', 'Jazmín', 'Flor de limón'],
    fondo: ['Sándalo', 'Ambrox', 'Almizcle'],
  },
  {
    marca: 'Versace', nombre: 'Crystal Noir', concentracion: 'EDT', genero: 'mujer',
    familia: 'Oriental floral', anio: 2004,
    salida: ['Pimienta', 'Cardamomo', 'Jengibre'],
    corazon: ['Gardenia', 'Coco', 'Peonía'],
    fondo: ['Sándalo', 'Ámbar', 'Almizcle'],
  },

  // ── Jean Paul Gaultier ───────────────────────────────────────────────
  {
    marca: 'Jean Paul Gaultier', nombre: 'Le Male', concentracion: 'EDT', genero: 'hombre',
    familia: 'Fougère oriental', anio: 1995,
    salida: ['Menta', 'Lavanda', 'Bergamota', 'Cardamomo'],
    corazon: ['Canela', 'Comino', 'Azahar'],
    fondo: ['Vainilla', 'Haba tonka', 'Sándalo', 'Ámbar', 'Cedro'],
  },
  {
    marca: 'Jean Paul Gaultier', nombre: 'Le Male Le Parfum', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental amaderado', anio: 2020,
    salida: ['Cardamomo'],
    corazon: ['Lavanda'],
    fondo: ['Vainilla', 'Notas amaderadas'],
  },
  {
    marca: 'Jean Paul Gaultier', nombre: 'Ultra Male', concentracion: 'EDT', genero: 'hombre',
    familia: 'Oriental fougère', anio: 2015,
    salida: ['Pera', 'Lavanda', 'Bergamota', 'Menta'],
    corazon: ['Canela', 'Comino', 'Alcaravea'],
    fondo: ['Vainilla', 'Haba tonka', 'Ámbar', 'Pachulí', 'Cedro'],
  },
  {
    marca: 'Jean Paul Gaultier', nombre: 'Scandal Pour Homme', concentracion: 'EDT', genero: 'hombre',
    familia: 'Aromático gourmand', anio: 2021,
    salida: ['Mandarina', 'Salvia'],
    corazon: ['Haba tonka', 'Notas amaderadas'],
    fondo: ['Vetiver', 'Caramelo'],
  },
  {
    marca: 'Jean Paul Gaultier', nombre: 'Classique', concentracion: 'EDT', genero: 'mujer',
    familia: 'Floral oriental', anio: 1993,
    salida: ['Azahar', 'Anís estrellado', 'Rosa', 'Mandarina', 'Pera'],
    corazon: ['Ylang-ylang', 'Jengibre', 'Orquídea', 'Iris'],
    fondo: ['Vainilla', 'Sándalo', 'Ámbar', 'Almizcle', 'Haba tonka'],
  },
  {
    marca: 'Jean Paul Gaultier', nombre: 'Scandal', concentracion: 'EDP', genero: 'mujer',
    familia: 'Chipre gourmand', anio: 2017,
    salida: ['Miel', 'Naranja sanguina', 'Mandarina'],
    corazon: ['Gardenia', 'Azahar', 'Miel'],
    fondo: ['Pachulí', 'Cera de abeja', 'Regaliz', 'Caramelo'],
  },

  // ── Dolce & Gabbana ──────────────────────────────────────────────────
  {
    marca: 'Dolce & Gabbana', nombre: 'The One for Men', concentracion: 'EDT', genero: 'hombre',
    familia: 'Oriental especiado', anio: 2008,
    salida: ['Tabaco', 'Cilantro', 'Albahaca', 'Pomelo'],
    corazon: ['Cardamomo', 'Jengibre', 'Azahar'],
    fondo: ['Ámbar', 'Cedro', 'Tabaco'],
  },
  {
    marca: 'Dolce & Gabbana', nombre: 'Light Blue Pour Homme', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado acuático', anio: 2007,
    salida: ['Pomelo', 'Bergamota', 'Mandarina', 'Enebro'],
    corazon: ['Palo de rosa', 'Pimienta', 'Romero'],
    fondo: ['Incienso', 'Almizcle', 'Musgo de roble'],
  },
  {
    marca: 'Dolce & Gabbana', nombre: 'K by Dolce & Gabbana', concentracion: 'EDT', genero: 'hombre',
    familia: 'Aromático fougère', anio: 2019,
    salida: ['Naranja sanguina', 'Limón de Sicilia', 'Enebro'],
    corazon: ['Pimienta de Jamaica', 'Geranio', 'Lavanda', 'Salvia sclarea'],
    fondo: ['Cedro', 'Vetiver', 'Pachulí'],
  },
  {
    marca: 'Dolce & Gabbana', nombre: 'Light Blue', concentracion: 'EDT', genero: 'mujer',
    familia: 'Floral frutal', anio: 2001,
    salida: ['Limón de Sicilia', 'Manzana', 'Cedro', 'Campanilla'],
    corazon: ['Bambú', 'Jazmín', 'Rosa blanca'],
    fondo: ['Cedro', 'Ámbar', 'Almizcle'],
  },
  {
    marca: 'Dolce & Gabbana', nombre: 'The Only One', concentracion: 'EDP', genero: 'mujer',
    familia: 'Oriental floral', anio: 2018,
    salida: ['Violeta', 'Bergamota'],
    corazon: ['Café', 'Iris'],
    fondo: ['Vainilla', 'Pachulí'],
  },

  // ── Carolina Herrera ─────────────────────────────────────────────────
  {
    marca: 'Carolina Herrera', nombre: 'Bad Boy', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2019,
    salida: ['Bergamota', 'Pimienta negra', 'Pimienta blanca'],
    corazon: ['Salvia', 'Cedro'],
    fondo: ['Haba tonka', 'Cacao', 'Amberwood'],
  },
  {
    marca: 'Carolina Herrera', nombre: '212 VIP Men', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2011,
    salida: ['Lima', 'Maracuyá', 'Menta'],
    corazon: ['Pimienta', 'Jengibre', 'Vodka'],
    fondo: ['Ámbar', 'Almizcle', 'Maderas negras'],
  },
  {
    marca: 'Carolina Herrera', nombre: 'Good Girl', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral oriental', anio: 2016,
    salida: ['Almendra', 'Café', 'Limón', 'Bergamota'],
    corazon: ['Nardo', 'Jazmín sambac', 'Azahar', 'Rosa'],
    fondo: ['Haba tonka', 'Cacao', 'Vainilla', 'Praliné', 'Sándalo', 'Canela', 'Almizcle'],
  },

  // ── Azzaro ───────────────────────────────────────────────────────────
  {
    marca: 'Azzaro', nombre: 'The Most Wanted', concentracion: 'EDP Intense', genero: 'hombre',
    familia: 'Ambarado especiado', anio: 2021,
    salida: ['Jengibre', 'Cardamomo'],
    corazon: ['Toffee', 'Amberwood'],
    fondo: ['Vetiver', 'Notas amaderadas'],
  },
  {
    marca: 'Azzaro', nombre: 'Wanted', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2016,
    salida: ['Limón', 'Jengibre', 'Cardamomo', 'Lavanda', 'Menta'],
    corazon: ['Enebro', 'Vetiver', 'Cardamomo'],
    fondo: ['Haba tonka', 'Amberwood', 'Vetiver de Haití'],
  },
  {
    marca: 'Azzaro', nombre: 'Wanted by Night', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental especiado', anio: 2018,
    salida: ['Canela', 'Manzana roja', 'Cardamomo', 'Limón'],
    corazon: ['Tabaco', 'Ron', 'Cedro'],
    fondo: ['Vainilla', 'Haba tonka', 'Pachulí', 'Ámbar'],
  },
  {
    marca: 'Azzaro', nombre: 'Chrome', concentracion: 'EDT', genero: 'hombre',
    familia: 'Cítrico aromático', anio: 1996,
    salida: ['Piña', 'Limón', 'Bergamota', 'Palo de rosa', 'Neroli'],
    corazon: ['Jazmín', 'Cilantro', 'Musgo de roble', 'Ciclamen'],
    fondo: ['Almizcle', 'Sándalo', 'Haba tonka', 'Cedro'],
  },

  // ── Rabanne ──────────────────────────────────────────────────────────
  {
    marca: 'Rabanne', nombre: 'Invictus', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado fresco', anio: 2013,
    salida: ['Pomelo', 'Acorde marino'],
    corazon: ['Hoja de laurel', 'Jazmín'],
    fondo: ['Madera de guayaco', 'Pachulí', 'Musgo de roble', 'Ámbar gris'],
  },
  {
    marca: 'Rabanne', nombre: '1 Million', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2008,
    salida: ['Mandarina roja', 'Pomelo', 'Menta'],
    corazon: ['Canela', 'Rosa', 'Especias'],
    fondo: ['Cuero', 'Ámbar', 'Pachulí', 'Madera de la India'],
  },
  {
    marca: 'Rabanne', nombre: 'Lady Million', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral amaderado', anio: 2010,
    salida: ['Frambuesa', 'Neroli', 'Naranja amarga'],
    corazon: ['Jazmín', 'Gardenia', 'Azahar'],
    fondo: ['Miel', 'Pachulí', 'Ámbar'],
  },
  {
    marca: 'Rabanne', nombre: 'Olympéa', concentracion: 'EDP', genero: 'mujer',
    familia: 'Ambarado floral', anio: 2015,
    salida: ['Mandarina verde', 'Jazmín acuático'],
    corazon: ['Vainilla salada', 'Flor de jengibre'],
    fondo: ['Sándalo', 'Cashmeran', 'Ámbar gris'],
  },

  // ── Emporio Armani / Giorgio Armani ──────────────────────────────────
  {
    marca: 'Emporio Armani', nombre: 'Stronger With You', concentracion: 'EDT', genero: 'hombre',
    familia: 'Oriental fougère', anio: 2017,
    salida: ['Pimienta rosa', 'Violeta', 'Cardamomo', 'Melón', 'Mandarina'],
    corazon: ['Lavanda', 'Salvia', 'Piña', 'Castaña', 'Canela', 'Geranio'],
    fondo: ['Vainilla', 'Ámbar', 'Ante', 'Toffee', 'Cedro'],
  },
  {
    marca: 'Emporio Armani', nombre: 'Stronger With You Intensely', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental gourmand', anio: 2019,
    salida: ['Rosa', 'Jengibre', 'Cardamomo', 'Pimienta rosa'],
    corazon: ['Lavanda', 'Salvia', 'Canela', 'Nuez moscada'],
    fondo: ['Vainilla', 'Haba tonka', 'Ámbar', 'Toffee', 'Cedro'],
  },
  {
    marca: 'Giorgio Armani', nombre: 'Acqua di Giò Profondo', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado acuático', anio: 2020,
    salida: ['Acorde marino', 'Bergamota', 'Mandarina verde', 'Aquozone'],
    corazon: ['Romero', 'Lavanda', 'Ciprés', 'Mástic'],
    fondo: ['Pachulí', 'Almizcle', 'Ámbar mineral'],
  },
  {
    marca: 'Giorgio Armani', nombre: 'Armani Code', concentracion: 'EDT', genero: 'hombre',
    familia: 'Oriental amaderado', anio: 2004,
    salida: ['Bergamota', 'Limón'],
    corazon: ['Azahar', 'Anís estrellado', 'Aceite de oliva'],
    fondo: ['Haba tonka', 'Cuero', 'Ámbar', 'Madera de guayaco'],
  },

  // ── Valentino ────────────────────────────────────────────────────────
  {
    marca: 'Valentino', nombre: 'Born in Roma Uomo', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2019,
    salida: ['Hoja de violeta', 'Jengibre'],
    corazon: ['Lavanda', 'Vetiver'],
    fondo: ['Notas amaderadas', 'Vainilla'],
  },
  {
    marca: 'Valentino', nombre: 'Born in Roma Donna', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral amaderado', anio: 2019,
    salida: ['Grosella negra'],
    corazon: ['Jazmín'],
    fondo: ['Vainilla bourbon', 'Notas amaderadas'],
  },

  // ── Givenchy ─────────────────────────────────────────────────────────
  {
    marca: 'Givenchy', nombre: 'Gentleman', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 2018,
    salida: ['Pera', 'Cardamomo'],
    corazon: ['Iris', 'Lavanda'],
    fondo: ['Pachulí', 'Vainilla negra', 'Cuero'],
  },
  {
    marca: 'Givenchy', nombre: "L'Interdit", concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral amaderado', anio: 2018,
    salida: ['Azahar', 'Pera', 'Bergamota'],
    corazon: ['Nardo', 'Jazmín', 'Azahar'],
    fondo: ['Vetiver', 'Pachulí', 'Vainilla', 'Ambroxan'],
  },

  // ── Otros que la tienda podría sumar ─────────────────────────────────
  {
    marca: 'Dior', nombre: 'Sauvage', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2015,
    salida: ['Bergamota de Calabria', 'Pimienta'],
    corazon: ['Pimienta de Sichuan', 'Lavanda', 'Pimienta rosa', 'Vetiver', 'Pachulí', 'Geranio', 'Elemí'],
    fondo: ['Ambroxan', 'Cedro', 'Lábdano'],
  },
  {
    marca: 'Chanel', nombre: 'Bleu de Chanel', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2014,
    salida: ['Pomelo', 'Limón', 'Menta', 'Pimienta rosa'],
    corazon: ['Jengibre', 'Nuez moscada', 'Jazmín', 'Melón'],
    fondo: ['Incienso', 'Ámbar', 'Cedro', 'Sándalo', 'Pachulí', 'Vetiver'],
  },
  {
    marca: 'Yves Saint Laurent', nombre: 'Y', concentracion: 'EDP', genero: 'hombre',
    familia: 'Amaderado aromático', anio: 2018,
    salida: ['Manzana', 'Jengibre', 'Bergamota'],
    corazon: ['Salvia', 'Geranio', 'Junípero'],
    fondo: ['Haba tonka', 'Cedro', 'Ámbar gris', 'Vetiver'],
  },
  {
    marca: 'Yves Saint Laurent', nombre: 'Libre', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral lavanda', anio: 2019,
    salida: ['Mandarina', 'Grosella negra', 'Lavanda', 'Petitgrain'],
    corazon: ['Lavanda', 'Azahar', 'Jazmín'],
    fondo: ['Vainilla de Madagascar', 'Almizcle', 'Cedro', 'Ambargris'],
  },
  {
    marca: 'Hugo Boss', nombre: 'Boss Bottled', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado especiado', anio: 1998,
    salida: ['Manzana', 'Ciruela', 'Limón', 'Bergamota'],
    corazon: ['Geranio', 'Canela', 'Caoba', 'Clavo'],
    fondo: ['Vainilla', 'Sándalo', 'Cedro', 'Vetiver', 'Olivo'],
  },
  {
    marca: 'Montblanc', nombre: 'Legend', concentracion: 'EDT', genero: 'hombre',
    familia: 'Fougère', anio: 2011,
    salida: ['Lavanda', 'Bergamota', 'Piña', 'Verbena'],
    corazon: ['Manzana', 'Rosa', 'Jazmín', 'Dianthus'],
    fondo: ['Haba tonka', 'Sándalo', 'Musgo de roble'],
  },
  {
    marca: 'Prada', nombre: 'Luna Rossa Carbon', concentracion: 'EDT', genero: 'hombre',
    familia: 'Aromático amaderado', anio: 2017,
    salida: ['Bergamota', 'Lavanda', 'Pimienta'],
    corazon: ['Notas metálicas', 'Salvia'],
    fondo: ['Pachulí', 'Ambroxan', 'Cedro'],
  },
  {
    marca: 'Nautica', nombre: 'Voyage', concentracion: 'EDT', genero: 'hombre',
    familia: 'Amaderado acuático', anio: 2006,
    salida: ['Manzana', 'Hojas verdes'],
    corazon: ['Loto', 'Mimosa'],
    fondo: ['Musgo', 'Ámbar gris', 'Cedro'],
  },
  {
    marca: 'Maison Alhambra', nombre: 'Jean Lowe Ombre', concentracion: 'EDP', genero: 'hombre',
    familia: 'Oriental amaderado', anio: 2022,
    salida: ['Cardamomo'],
    corazon: ['Lavanda'],
    fondo: ['Vainilla', 'Notas amaderadas'],
  },
  {
    marca: 'Ariana Grande', nombre: 'Cloud', concentracion: 'EDP', genero: 'mujer',
    familia: 'Floral gourmand', anio: 2018,
    salida: ['Lavanda', 'Pera', 'Bergamota'],
    corazon: ['Coco', 'Praliné', 'Orquídea vainilla'],
    fondo: ['Almizcle', 'Maderas', 'Almizcle blanco'],
  },
];

/** Quita tildes y baja a minúsculas, para que «Gio» encuentre «Giò». */
const plano = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Busca por marca o por nombre, palabra por palabra.
 *
 * Se busca por todas las palabras y en cualquier orden porque nadie escribe
 * el nombre completo: «club nuit», «nuit intense» y «armaf club» tienen que
 * llegar todas al mismo perfume.
 */
export function buscarFichas(consulta: string, limite = 8): Ficha[] {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];

  const puntuadas = FRAGANCIAS.map((f) => {
    const nombre = plano(f.nombre);
    const completo = `${plano(f.marca)} ${nombre}`;

    if (!palabras.every((p) => completo.includes(p))) return null;

    // Ordena por lo más parecido a lo que se escribió: primero lo que empieza
    // igual, después lo que solo lo contiene.
    const inicio = nombre.startsWith(palabras[0]) || plano(f.marca).startsWith(palabras[0]);
    return { ficha: f, puntos: (inicio ? 100 : 0) - completo.length };
  }).filter(Boolean) as { ficha: Ficha; puntos: number }[];

  return puntuadas
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, limite)
    .map((p) => p.ficha);
}
