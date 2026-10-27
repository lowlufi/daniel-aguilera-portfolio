import type { ModeloBase } from './fisica-tipos';

/*
 * «Escuadrón Dui»: the story. Every cutscene is plain data (a `Guion`), played
 * by <Cinematica>. A script is a list of beats; each beat is one painted scene
 * (see escenas.ts) with a camera move and a few lines of dialog.
 *
 * The plot:
 *  - Prólogo: an autumn evening in San Antonio. The three old pilots have the
 *    pantry full of fish for the winter. Margarita, fed up with the noise of
 *    their planes, leaves her gate open for the mice of the Imperio Ratón «so
 *    they take the noisy ones away». That night the mice empty the pantry: the
 *    Emperor wants the fish to trade it for all the cheese in Chile. At dawn
 *    the friends find the tracks, dust off their planes and take off.
 *  - Chapters on each new map (the sea, Valparaíso, the storm, back home).
 *  - A little epilogue after each boss beaten for the first time.
 */

/** Who speaks: the three pilots, the villains, the narrator; 'piloto' is whoever the player picked. */
export type Hablante = 'dui' | 'lulu' | 'almendrita' | 'piloto' | 'margarita' | 'raton' | 'emperador' | 'narrador';

/** The painted scenes (escenas.ts). */
export type EscenaId =
  | 'atardecer' | 'despensa' | 'vecina' | 'robo' | 'amanecer' | 'hangar' | 'despegue'
  | 'mar' | 'naufragio' | 'valparaiso' | 'tormenta' | 'caida' | 'granqueso' | 'nodriza' | 'paz';

/** Camera: centre (x, y) on the 256×144 scene and zoom (1 = whole scene). */
export type Camara = [x: number, y: number, zoom: number];

export type Linea = { quien: Hablante; texto: string };

export type Beat = {
  escena: EscenaId;
  /** Camera at the start and at the end of the beat (it eases between them). */
  desde?: Camara;
  hasta?: Camara;
  /** A big chapter title over the scene when the beat opens. */
  titulo?: string;
  /** A menu sound when the beat opens. */
  sonido?: 'paso' | 'despegar' | 'aceptar' | 'volver';
  lineas: Linea[];
};

export type Guion = { id: GuionId; nombre: string; beats: Beat[] };

export type GuionId =
  | 'prologo'
  | 'cap-oceano' | 'cap-valparaiso' | 'cap-tormenta' | 'cap-valle'
  | 'fin-margarita' | 'fin-duelo' | 'fin-portaaviones' | 'fin-dirigible' | 'fin-zepelin' | 'fin-nodriza';

/** Display names and colours for the dialog box. */
export const HABLANTES: Record<Exclude<Hablante, 'piloto'>, { nombre: string; color: string }> = {
  dui: { nombre: 'Dui', color: '#ffb066' },
  lulu: { nombre: 'Lulu', color: '#ffd84a' },
  almendrita: { nombre: 'Almendrita', color: '#ff9ac4' },
  margarita: { nombre: 'Vecina Margarita', color: '#ff6a7a' },
  raton: { nombre: 'Ratón', color: '#c8b4ff' },
  emperador: { nombre: 'Emperador Ratón', color: '#b48aff' },
  narrador: { nombre: '', color: '#fff8e7' },
};

export const PILOTO_DE: Record<ModeloBase, Hablante> = { caza: 'dui', avioneta: 'lulu', bombardero: 'almendrita' };

export const HISTORIA: Record<GuionId, Guion> = {
  prologo: {
    id: 'prologo',
    nombre: 'Prólogo: el robo del pescado',
    beats: [
      {
        escena: 'atardecer',
        desde: [70, 60, 1.6],
        hasta: [170, 80, 1.15],
        titulo: 'San Antonio, fines de otoño',
        sonido: 'paso',
        lineas: [
          { quien: 'narrador', texto: 'Las grúas del puerto se van a dormir y la camanchaca baja despacito por los cerros de Barrancas.' },
          { quien: 'narrador', texto: 'Junto a la vieja pista de Llolleo vive el Escuadrón Dui: tres pilotos retirados… y bien regalones.' },
        ],
      },
      {
        escena: 'despensa',
        desde: [128, 80, 1.1],
        hasta: [128, 86, 1.5],
        sonido: 'paso',
        lineas: [
          { quien: 'dui', texto: '¡Cuarenta y dos pescados para el invierno! Los conté dos veces. Bueno… cuarenta y uno.' },
          { quien: 'lulu', texto: 'Dui, ese es el tercero que te comes hoy. Te estoy mirando.' },
          { quien: 'almendrita', texto: '¡Guau! Con esta despensa no pasamos frío ni hambre hasta septiembre.' },
        ],
      },
      {
        escena: 'vecina',
        desde: [150, 70, 1.3],
        hasta: [128, 76, 1.05],
        sonido: 'paso',
        lineas: [
          { quien: 'margarita', texto: '¡Otra vez esos aviones viejos calentando motores a la hora de la once! ¡Ricachones $&#%!' },
          { quien: 'raton', texto: 'Psst… señora. ¿Y si la ayudamos a que se vayan los ruidosos? Para siempre, digo.' },
          { quien: 'margarita', texto: '¿Ustedes harían eso? Les dejo el portón abierto. ¡Pero sin hacer ruido, ah! &%#' },
        ],
      },
      {
        escena: 'robo',
        desde: [128, 72, 1],
        hasta: [150, 70, 1.15],
        sonido: 'paso',
        lineas: [
          { quien: 'raton', texto: '¡Operación Quesito Marino en marcha! ¡Todo el pescado al camión, muchachos!' },
          { quien: 'emperador', texto: 'Excelente, mis ratitas. Con ese pescado cambiaremos todo el queso de Chile. ¡Ji, ji, ji!' },
        ],
      },
      {
        escena: 'amanecer',
        desde: [128, 94, 1.5],
        hasta: [128, 76, 1.1],
        sonido: 'volver',
        lineas: [
          { quien: 'almendrita', texto: '¡Guau, guau! ¡La despensa está vacía! ¡No queda ni una espina!' },
          { quien: 'lulu', texto: 'Huellitas de ratón… ruedas de camión… y una chancla. Una chancla con florcitas.' },
          { quien: 'dui', texto: '¡Nuestro pescado! Esto ya es personal.' },
        ],
      },
      {
        escena: 'hangar',
        desde: [128, 70, 1],
        hasta: [128, 78, 1.25],
        sonido: 'aceptar',
        lineas: [
          { quien: 'piloto', texto: 'Escuadrón Dui… ¡a sacarle el polvo a los aviones!' },
          { quien: 'narrador', texto: 'Del puerto de San Antonio hasta Valparaíso, la costa vuelve a tener guardianes.' },
        ],
      },
      {
        escena: 'despegue',
        desde: [100, 90, 1.3],
        hasta: [160, 60, 1],
        sonido: 'despegar',
        lineas: [{ quien: 'piloto', texto: '¡A recuperar ese pescado! ¡Despegamos!' }],
      },
    ],
  },

  'cap-oceano': {
    id: 'cap-oceano',
    nombre: 'Capítulo 2: Mar adentro',
    beats: [
      {
        escena: 'mar',
        desde: [90, 80, 1.4],
        hasta: [150, 72, 1.05],
        titulo: 'Capítulo 2 · Mar adentro',
        sonido: 'paso',
        lineas: [
          { quien: 'lulu', texto: 'Las huellas terminan en el muelle. ¡Se llevaron el pescado en lanchas!' },
          { quien: 'raton', texto: '¡Rápido, al portaaviones de la señora Margarita!' },
          { quien: 'dui', texto: '¿Margarita tiene un PORTAAVIONES?' },
          { quien: 'margarita', texto: '¡Lo compré en la feria de las pulgas! ¡Y es de la junta de vecinos! &%#' },
        ],
      },
    ],
  },
  'cap-valparaiso': {
    id: 'cap-valparaiso',
    nombre: 'Capítulo 3: Valparaíso',
    beats: [
      {
        escena: 'valparaiso',
        desde: [70, 80, 1.4],
        hasta: [160, 74, 1.05],
        titulo: 'Capítulo 3 · Valparaíso',
        sonido: 'paso',
        lineas: [
          { quien: 'almendrita', texto: 'Subieron el pescado por los ascensores. Todo el cerro huele a merluza frita.' },
          { quien: 'raton', texto: '¡El Emperador espera su pescado en lo alto! ¡Súbanlo al Gran Queso!' },
          { quien: 'lulu', texto: '¿El Gran Queso? Ay, no. Que no sea un dirigible de queso. …Es un dirigible de queso.' },
        ],
      },
    ],
  },
  'cap-tormenta': {
    id: 'cap-tormenta',
    nombre: 'Capítulo 4: La tormenta',
    beats: [
      {
        escena: 'tormenta',
        desde: [128, 90, 1.3],
        hasta: [128, 60, 1.05],
        titulo: 'Capítulo 4 · La tormenta',
        sonido: 'paso',
        lineas: [
          { quien: 'narrador', texto: 'Frente a Viña del Mar, el cielo se pone negro como gata de noche.' },
          { quien: 'margarita', texto: '¡Con este zepelín nadie me hace ruido nunca más! ¡Ni gatos, ni perritas, ni parrillas eléctricas! #$%&' },
          { quien: 'piloto', texto: 'Solo cazas en esta tormenta. ¡Abróchense los cinturones!' },
        ],
      },
    ],
  },
  'cap-valle': {
    id: 'cap-valle',
    nombre: 'De vuelta en San Antonio',
    beats: [
      {
        escena: 'atardecer',
        desde: [190, 80, 1.4],
        hasta: [150, 76, 1.1],
        titulo: 'De vuelta en casa',
        sonido: 'paso',
        lineas: [
          { quien: 'lulu', texto: 'San Antonio. Las grúas, la caleta, nuestra pista. Se extrañaba.' },
          { quien: 'dui', texto: 'Y la despensa se ve más llenita. ¡Ni un ratón más pasa por ese portón!' },
        ],
      },
    ],
  },

  'fin-margarita': {
    id: 'fin-margarita',
    nombre: 'La vecina se retira',
    beats: [
      {
        escena: 'vecina',
        desde: [128, 80, 1.5],
        hasta: [128, 76, 1.2],
        sonido: 'aceptar',
        lineas: [
          { quien: 'margarita', texto: '¡Esto no se queda así! …Mi carrito. Mis tomates. Mi permanente. #$%' },
          { quien: 'almendrita', texto: 'Señora Margarita, ¿quiere un pescadito? De los que le quedaron a los ratones, digo.' },
          { quien: 'margarita', texto: '¡No me ablandan, ricachones! ¡Ya van a ver lo que tengo guardado en el mar! &%#' },
        ],
      },
    ],
  },
  'fin-duelo': {
    id: 'fin-duelo',
    nombre: 'Duelo ganado',
    beats: [
      {
        escena: 'caida',
        desde: [128, 60, 1.3],
        hasta: [128, 80, 1.1],
        sonido: 'aceptar',
        lineas: [
          { quien: 'margarita', texto: '¡Mi caza nuevo! ¡Lo compré en cuotas y me quedaban once! $%&' },
          { quien: 'piloto', texto: 'Buen vuelo, vecina. Para la próxima, sin chanclas en el aire.' },
        ],
      },
    ],
  },
  'fin-portaaviones': {
    id: 'fin-portaaviones',
    nombre: 'El portaaviones se hunde',
    beats: [
      {
        escena: 'naufragio',
        desde: [150, 80, 1.5],
        hasta: [130, 76, 1.1],
        sonido: 'aceptar',
        lineas: [
          { quien: 'raton', texto: '¡Abandonen el barco! ¡Primero los quesos, después los ratones!' },
          { quien: 'margarita', texto: '¡Mi portaaviones! ¡Voy a llamar a la Armada! …¿Alguien tiene un bote? #&%$' },
          { quien: 'lulu', texto: 'Recuperamos unas cajas. Pero el resto del pescado va camino a Valparaíso.' },
        ],
      },
    ],
  },
  'fin-dirigible': {
    id: 'fin-dirigible',
    nombre: 'Se desinfla el Gran Queso',
    beats: [
      {
        escena: 'granqueso',
        desde: [128, 60, 1.3],
        hasta: [128, 74, 1.05],
        sonido: 'aceptar',
        lineas: [
          { quien: 'raton', texto: '¡El Gran Queso se desinfla! ¡Majestad, se nos derrite el plan!' },
          { quien: 'emperador', texto: 'Inútiles… ¡Preparen mi nave nodriza! Yo mismo iré por ese pescado.' },
        ],
      },
    ],
  },
  'fin-zepelin': {
    id: 'fin-zepelin',
    nombre: 'Paz con la vecina',
    beats: [
      {
        escena: 'tormenta',
        desde: [128, 60, 1.2],
        hasta: [128, 70, 1],
        sonido: 'aceptar',
        lineas: [
          { quien: 'margarita', texto: '¡Está bien, está bien! Que les devuelvan su pescado. …Pero bajen el volumen los domingos.' },
          { quien: 'dui', texto: 'Trato hecho, vecina. Y queda invitada al asado. Con parrilla de carbón.' },
        ],
      },
      {
        escena: 'paz',
        desde: [128, 80, 1.3],
        hasta: [128, 76, 1.05],
        lineas: [
          { quien: 'margarita', texto: '…¿Con pebre? Bueno. Pero llego temprano, ah. ¡Ricachones! Los quiero. Un poquito. &%#' },
          { quien: 'narrador', texto: 'Y esa noche, en San Antonio, el único ruido fue el de las olas… y el de Dui masticando.' },
        ],
      },
    ],
  },
  'fin-nodriza': {
    id: 'fin-nodriza',
    nombre: 'El Emperador se retira',
    beats: [
      {
        escena: 'nodriza',
        desde: [128, 70, 1.3],
        hasta: [128, 56, 1],
        sonido: 'aceptar',
        lineas: [
          { quien: 'emperador', texto: '¡Esto no ha terminado, Escuadrón Dui! ¡Volveré con más ratones y más queso!' },
          { quien: 'almendrita', texto: 'Y nosotros vamos a estar aquí. Con la despensa llena y los motores tibios.' },
        ],
      },
    ],
  },
};

/** The chapter for arriving at a map (the wave card's `resumen.destino`). */
export function guionDeMapa(destino: string): GuionId | null {
  return destino === 'oceano' ? 'cap-oceano' : destino === 'valparaiso' ? 'cap-valparaiso' : destino === 'tormenta' ? 'cap-tormenta' : destino === 'valle' ? 'cap-valle' : null;
}

/** The epilogue for a boss: the HUD's `boss.name`, or a flying boss's kind (jefes.ts `TipoJefe`). */
export function guionDeJefe(jefe: string): GuionId | null {
  switch (jefe) {
    case 'Vecina Margarita':
    case 'margarita':
      return 'fin-margarita';
    case 'Margarita en su caza':
    case 'duelo':
      return 'fin-duelo';
    case 'Portaaviones de Margarita':
    case 'portaaviones':
      return 'fin-portaaviones';
    case 'dirigible':
      return 'fin-dirigible';
    case 'zepelin':
      return 'fin-zepelin';
    case 'nodriza':
      return 'fin-nodriza';
    default:
      return null;
  }
}

/* ── What has been seen on this device ─────────────────────────────────── */

const CLAVE = 'vuelo-historia';
function leer(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
/** Whether this scene was already played (or skipped) here. */
export function vista(id: GuionId): boolean {
  return leer().has(id);
}
export function marcarVista(id: GuionId) {
  const s = leer();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(CLAVE, JSON.stringify([...s]));
  } catch {
    /* private mode: it will just play again */
  }
}
