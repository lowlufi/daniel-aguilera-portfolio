import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import { PROJECTS, SKILLS, SOCIAL } from '../data';
import PixelScene from './PixelScene';
import { initAudio, pauseAudio, setMusicMood, setMusicVolume, setMuted as setAudioMuted, sfx } from './audio';
import { WEATHERS, WEATHER_CONFIG, stepAtmosphere, type WeatherId } from './weather';
import { createStore, type GameEvents, type Meteo } from './store';
import { STAMPS, loadProgress, nextStamp, saveProgress, stampFor, type StampId } from './progress';
import { GARDEN as GARDEN_CENTER, INTERACTABLES, PROJECT_SIGNS, STAR_COUNT, approachPoint, type InteractableId } from './world';

type Props = {
  navigate: (to: string) => void;
  openComposer: () => void;
  paused: boolean;
};

type Choice = { label: string; run: () => void };
type Dialog = { speaker: string; lines: string[]; choices?: Choice[]; skippable?: boolean };
type Panel = 'projects' | 'skills' | 'libreta' | null;
type Toast = { key: number; icon: string; title: string; text: string };

const ACHIEVEMENTS = {
  jardinero: { icon: '✂️', title: 'Jardinero aficionado', text: 'Cortaste tus primeros matojos.' },
  cesped: { icon: '🌿', title: 'Césped impecable', text: 'Cortaste más de un tercio de la isla.' },
  estrellas: { icon: '⭐', title: 'Cazador de estrellitas', text: `Encontraste las ${STAR_COUNT} estrellitas escondidas.` },
  vecino: { icon: '🏡', title: 'Buen vecino', text: 'Visitaste a Daniel, el tablón, el huerto y el buzón.' },
  curioso: { icon: '🔍', title: 'Curiosidad infinita', text: 'Leíste todos los letreros de proyectos.' },
  pulgar: { icon: '💧', title: 'Pulgar verde', text: 'Regaste el huerto tres veces.' },
  cosecha: { icon: '🧺', title: 'Cosecha feliz', text: 'Cosechaste el huerto de habilidades.' },
  meteo: { icon: '📡', title: 'Meteorólogo', text: 'Sincronizaste la isla con el clima real de San Antonio.' },
  muelle: { icon: '🌊', title: 'Contemplativo', text: 'Te sentaste a mirar el mar desde el muelle.' },
  secreto: { icon: '🎉', title: 'Código secreto', text: '↑ ↑ ↓ ↓ ← → ← → B A. ¡Eres de los buenos!' },
  dui: { icon: '🐾', title: 'Gato regalón', text: 'Le hiciste cariño a Dui. Ronronea de puro feliz.' },
  libreta: { icon: '📖', title: 'Libreta completa', text: 'Juntaste los cinco sellos: ya conoces a Daniel, su trabajo y cómo escribirle.' },
} as const;

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

// Open-Meteo weather codes → words, and → the closest island weather.
function describeCode(code: number) {
  if (code === 0) return 'despejado';
  if (code <= 3) return 'parcialmente nublado';
  if (code === 45 || code === 48) return 'con niebla';
  if (code >= 51 && code <= 57) return 'con llovizna';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'con lluvia';
  if (code >= 71 && code <= 77) return 'con nieve';
  if (code >= 95) return 'con tormenta';
  return 'variable';
}
function islandWeatherFor(m: Meteo): WeatherId {
  const c = m.code;
  if (c === 45 || c === 48) return 'niebla';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return 'lluvia';
  if (c >= 71 && c <= 77) return 'nieve';
  if (!m.isDay) return 'noche';
  const toSunset = m.sunset - Date.now() / 1000;
  return toSunset > -1800 && toSunset < 5400 ? 'atardecer' : 'soleado';
}
type AchievementId = keyof typeof ACHIEVEMENTS;

/**
 * Movement keys by physical position (e.code), so keydown and keyup always
 * agree: e.key changes with modifiers and layouts (Option+W gives '∑' on a
 * Mac, AZERTY has no W where WASD expects it), and the key would never be
 * released. Everything else keeps using e.key.
 */
const CODE_TO_KEY: Record<string, string> = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
  ShiftLeft: 'shift', ShiftRight: 'shift',
};
function movementKey(e: KeyboardEvent): string {
  return CODE_TO_KEY[e.code] ?? e.key.toLowerCase();
}

const TRAVEL: { id: InteractableId; emoji: string; label: string }[] = [
  { id: 'daniel', emoji: '🧑‍💻', label: 'Sobre mí' },
  { id: 'board', emoji: '📌', label: 'Proyectos' },
  { id: 'garden', emoji: '🌻', label: 'Habilidades' },
  { id: 'mailbox', emoji: '✉️', label: 'Contacto' },
];

// The other places on the map, for a keyboard or screen reader player: the
// "Ir a" bar only has the four that matter most, and the map itself is
// hidden from screen readers.
const MORE_PLACES: { id: InteractableId; label: string }[] = [
  { id: 'welcome', label: 'Letrero de bienvenida' },
  { id: 'station', label: 'Estación ESP32' },
  { id: 'dock', label: 'Muelle' },
];

const CROP_EMOJI = ['🌻', '🍅', '🥕', '🥬'];

type Sheet = 'weather' | 'sound' | null;

const SKIP_LINK = 'sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-[#fff8e7] focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-[#6b4f3a] focus:shadow-[0_3px_0_rgba(91,70,54,0.25)]';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
/** A stored number, or the fallback if it's missing, corrupt or not finite (NaN breaks the audio graph). */
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return coarse;
}

export default function IslandGame({ navigate, openComposer, paused }: Props) {
  const store = useMemo(createStore, []);
  // Saved notebook progress, loaded once and mirrored into the store so the
  // scene can draw it (green lanterns, stars that stay collected).
  const progress = useMemo(() => {
    const p = loadProgress();
    for (const id of p.projects) store.seenProjects.add(id);
    for (const i of p.stars) store.starsTaken.add(i);
    return p;
  }, [store]);
  const coarse = useCoarsePointer();

  const [started, setStarted] = useState(false);
  const [near, setNear] = useState<InteractableId | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState(0);
  const [choiceIdx, setChoiceIdx] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [stars, setStars] = useState(() => store.starsTaken.size);
  const [stamps, setStamps] = useState<StampId[]>(() => progress.stamps);
  const [cut, setCut] = useState(0);
  const [muted, setMuted] = useState(() => readStorage('island-muted', false));
  const [weather, setWeather] = useState<WeatherId>(() => {
    const w = readStorage<WeatherId>('island-weather', 'atardecer');
    return w in WEATHER_CONFIG ? w : 'atardecer';
  });
  const [musicVol, setMusicVol] = useState(() => Math.min(1, Math.max(0, finiteOr(readStorage<unknown>('island-music-vol', 0.5), 0.5))));
  const [sheet, setSheet] = useState<Sheet>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const [unlocked, setUnlocked] = useState<AchievementId[]>(() => {
    // Anything but a list of known ids (a corrupt value, an achievement that no
    // longer exists) would throw off the "n/12" counter and the unlock check.
    const v = readStorage<unknown>('island-achievements', []);
    return Array.isArray(v) ? [...new Set(v.filter((id): id is AchievementId => typeof id === 'string' && id in ACHIEVEMENTS))] : [];
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const visited = useRef(new Set<InteractableId>());
  const toastKey = useRef(0);
  const revealHint = useRef(false);

  if (import.meta.env.DEV) (window as unknown as { __island?: unknown }).__island = { store, walkTo: (id: InteractableId) => walkToRef.current(id), snapWeather: () => stepAtmosphere(1) };
  const walkToRef = useRef<(id: InteractableId) => void>(() => {});

  // The next missing stamp's name tag lights up with a paw; none left, no highlight.
  useEffect(() => {
    const n = nextStamp(stamps);
    const it = n ? INTERACTABLES.find((x) => x.id === n.target) : undefined;
    store.goalId = it ? it.id : null;
  }, [stamps, store]);

  const busyRef = useRef(false);
  busyRef.current = !!dialog || !!panel || paused || !!store.target;
  store.frozen = !started || !!dialog || !!panel || paused;
  store.started = started;


  const toast = useCallback((icon: string, title: string, text: string) => {
    const key = ++toastKey.current;
    setToasts((t) => [...t.slice(-2), { key, icon, title, text }]);
    later(() => setToasts((t) => t.filter((x) => x.key !== key)), 3600);
  }, [later]);

  // A tip shown once per player (kept in localStorage), the first time they
  // try a move: the tutorial text is easy to skip, the moment of use is not.
  const hintOnce = useCallback(
    (id: string, icon: string, title: string, text: string) => {
      const seen = readStorage<unknown>('island-hints', []);
      const list = Array.isArray(seen) ? (seen as string[]) : [];
      if (list.includes(id)) return;
      writeStorage('island-hints', [...list, id]);
      toast(icon, title, text);
    },
    [toast],
  );

  const unlockedRef = useRef(unlocked);
  const unlock = useCallback(
    (id: AchievementId) => {
      if (unlockedRef.current.includes(id)) return;
      const next = [...unlockedRef.current, id];
      unlockedRef.current = next;
      setUnlocked(next);
      writeStorage('island-achievements', next);
      const a = ACHIEVEMENTS[id];
      sfx.achievement();
      toast(a.icon, `¡Logro! ${a.title}`, a.text);
    },
    [toast],
  );

  const persistProgress = useCallback(() => {
    saveProgress({ stamps: stampsRef.current, projects: [...store.seenProjects], stars: [...store.starsTaken] });
  }, [store]);

  const grantStamp = useCallback(
    (id: StampId) => {
      if (stampsRef.current.includes(id)) return;
      const next = [...stampsRef.current, id];
      stampsRef.current = next;
      setStamps(next);
      persistProgress();
      if (next.length === STAMPS.length) {
        // The last stamp is usually the mailbox: end on a high note there.
        store.burst('party', store.pos.x, store.pos.z);
        unlock('libreta');
        return;
      }
      // The arrival stamp is a gift; announcing it would only be noise.
      if (id === 'llegada') return;
      const s = STAMPS.find((x) => x.id === id);
      if (!s) return;
      sfx.star();
      toast(s.icon, `Sello ${next.length}/${STAMPS.length} · ${s.title}`, nextStamp(next)?.hint ?? '');
    },
    [persistProgress, store, toast, unlock],
  );
  const cutRef = useRef(0);
  const starsRef = useRef(store.starsTaken.size);
  const stampsRef = useRef<StampId[]>(progress.stamps);
  const duiHintAt = useRef(-Infinity);
  const startedRef = useRef(false);

  const closeDialog = useCallback(() => {
    setDialog(null);
    sfx.close();
  }, []);

  const chooseWeatherRef = useRef<(w: WeatherId) => void>(() => {});
  const konami = useRef<string[]>([]);
  const danielTalks = useRef(0);
  const waterCount = useRef(0);

  const waterGarden = useCallback(() => {
    setDialog(null);
    const g = store.garden;
    g.wateredAt = performance.now() / 1000;
    g.growth = Math.min(1.45, Math.round((g.growth + 0.15) * 100) / 100);
    store.burst('water', GARDEN_CENTER.x, GARDEN_CENTER.z);
    sfx.water();
    waterCount.current += 1;
    if (waterCount.current >= 3) unlock('pulgar');
    toast('💧', '¡Regaste el huerto!', g.growth >= 1.29 ? 'Las plantas se ven listas para cosechar. 🧺' : 'Las plantas crecen un poquito. Riega otra vez.');
  }, [store, toast, unlock]);

  const harvestGarden = useCallback(() => {
    setDialog(null);
    const g = store.garden;
    if (g.growth < 1.29) {
      toast('🌱', 'Aún no está listo', 'Riega el huerto un par de veces antes de cosechar.');
      sfx.close();
      return;
    }
    g.growth = 1;
    g.harvestedAt = performance.now() / 1000;
    store.burst('harvest', GARDEN_CENTER.x, GARDEN_CENTER.z);
    sfx.pop();
    unlock('cosecha');
    toast('🧺', '¡Cosecha lista!', 'Girasoles, tomates, zanahorias y lechugas. Igual que sus habilidades: siempre creciendo.');
  }, [store, toast, unlock]);

  // Once seen (or skipped), the welcome tour stops opening on its own.
  const finishTutorial = useCallback(() => {
    writeStorage('island-tutorial-done', true);
    closeDialog();
  }, [closeDialog]);

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const buildDialog = useCallback(
    (id: InteractableId): Dialog => {
      const close = { label: 'Cerrar', run: closeDialog };
      if (id === 'welcome')
        return {
          speaker: 'Letrero',
          lines: [
            '¡Bienvenid@ a la isla de Daniel Eduardo! 🌅',
            'Eres Dui, el gato de Daniel. Camina con A y D (o las flechas) y salta con Espacio o W. En el celular, usa el joystick: hacia arriba salta.',
            'Con F (o 🐾) das un zarpazo: corta el pasto alto y cava la tierra. S+F cava hacia abajo y W+F sube cavando. Dicen que hay estrellitas escondidas entre el pasto… y algunas bajo tierra.',
            'Acércate a las cosas y pulsa E para interactuar. ¡O usa los botones «Ir a» para llegar directo!',
          ],
          choices: [{ label: '¡Vamos!', run: finishTutorial }],
          skippable: true,
        };
      if (id === 'daniel' && danielTalks.current >= 4)
        return {
          speaker: 'Daniel',
          lines: [
            '¿Otra vez por aquí? 😄 Me caes bien, así que te cuento un secreto…',
            'En esta isla, prueba escribir ↑ ↑ ↓ ↓ ← → ← → B A. Nadie sabe qué pasa. 🤫',
          ],
          choices: [
            { label: 'Ver tus proyectos', run: () => { setDialog(null); setPanel('projects'); sfx.open(); } },
            { label: '¡Gracias!', run: closeDialog },
          ],
        };
      if (id === 'daniel')
        return {
          speaker: 'Daniel',
          lines: [
            '¡Dui! ¿Te escapaste otra vez? 😄 Y trajiste visita… ¡hola a quien sea que esté jugando!',
            'Soy Daniel, Ingeniero en Informática de la Universidad de Playa Ancha. Hago webs, e-commerce, plataformas educativas y sistemas IoT.',
            'Este gordito naranjo es Dui, mi gato, y hoy te toca recorrer la isla con sus patitas. Está a dieta: si pide comida, no le creas. 🐾',
          ],
          choices: [
            { label: 'Ver tus proyectos', run: () => { setDialog(null); setPanel('projects'); sfx.open(); } },
            { label: '¿Qué herramientas usas?', run: () => { setDialog(null); setPanel('skills'); sfx.open(); } },
            { label: 'Quiero escribirte', run: () => { setDialog(null); openComposer(); } },
            { label: '¡Nos vemos!', run: closeDialog },
          ],
        };
      if (id === 'board')
        return {
          speaker: 'Tablón de proyectos',
          lines: [`Aquí están los ${PROJECTS.length} proyectos de Daniel. Cada letrero con farolito es uno — ¡acércate a leerlos!`],
          choices: [{ label: 'Ver la lista completa', run: () => { setDialog(null); setPanel('projects'); sfx.open(); } }, close],
        };
      if (id === 'garden')
        return {
          speaker: 'Huerto de habilidades',
          lines: ['Cada cultivo de este huerto es algo que Daniel ha ido sembrando con los años. 🌱'],
          choices: [
            { label: 'Mirar las plantas', run: () => { setDialog(null); setPanel('skills'); sfx.open(); } },
            { label: '💧 Regar', run: waterGarden },
            { label: '🧺 Cosechar', run: harvestGarden },
            close,
          ],
        };
      if (id === 'station') {
        const m = store.meteo;
        if (!m)
          return {
            speaker: 'Estación ESP32',
            lines: [
              'Una mini estación meteorológica con un ESP32 y un sensor DHT22 que armó Daniel. 📡',
              'Mmm… no logra conectarse ahora mismo. Vuelve en un ratito.',
            ],
            choices: [close],
          };
        const target = islandWeatherFor(m);
        const label = WEATHERS.find((w) => w.id === target);
        return {
          speaker: 'Estación ESP32',
          lines: [
            'Una mini estación meteorológica con un ESP32 y un sensor DHT22 que armó Daniel. 📡',
            `Ahora mismo en San Antonio: ${m.temp.toFixed(1)} °C, ${Math.round(m.hum)} % de humedad y viento de ${Math.round(m.wind)} km/h. Está ${describeCode(m.code)}.`,
            '(Datos en vivo de Open-Meteo, se actualizan cada 10 minutos.)',
          ],
          choices: [
            {
              label: `Poner la isla igual que San Antonio (${label?.emoji} ${label?.label})`,
              run: () => {
                setDialog(null);
                chooseWeatherRef.current(target);
                unlock('meteo');
              },
            },
            close,
          ],
        };
      }
      if (id === 'dock')
        return {
          speaker: 'Muelle',
          lines: [
            'Te sientas en el borde del muelle y dejas los pies colgando sobre el agua. 🌊',
            'Se escuchan las olas, las gaviotas a lo lejos… Aquí nadie te apura.',
          ],
          choices: [
            { label: 'Quedarse un ratito', run: () => { unlock('muelle'); closeDialog(); } },
            { label: 'Volver a explorar', run: closeDialog },
          ],
        };
      if (id === 'mailbox')
        return {
          speaker: 'Buzón',
          lines: ['El buzón de Daniel. ¿Quieres dejarle una carta o visitarlo en otra isla?'],
          choices: [
            { label: '✉️ Escribir una carta', run: () => { setDialog(null); openComposer(); } },
            { label: 'LinkedIn', run: () => openUrl(SOCIAL.linkedin) },
            { label: 'GitHub', run: () => openUrl(SOCIAL.github) },
            { label: 'Instagram', run: () => openUrl(SOCIAL.instagram) },
            { label: 'Ahora no', run: closeDialog },
          ],
        };
      const pid = Number(id.split(':')[1]);
      const p = PROJECTS.find((x) => x.id === pid)!;
      return {
        speaker: p.title,
        lines: [p.description, `Hecho con: ${p.tags.filter((t) => t !== 'Próximamente').join(' · ')}.`],
        choices: p.comingSoon
          ? [{ label: '¡Próximamente! 🌱', run: closeDialog }]
          : [{ label: `Visitar ${p.url.replace(/^https?:\/\/(www\.)?/, '')} ↗`, run: () => openUrl(p.url) }, close],
      };
    },
    [closeDialog, finishTutorial, harvestGarden, openComposer, store, unlock, waterGarden],
  );

  const openDialog = useCallback(
    (id: InteractableId) => {
      const it = INTERACTABLES.find((x) => x.id === id);
      if (it) store.facing = Math.atan2(it.x - store.pos.x, it.z - store.pos.z);
      store.target = null;
      store.targetId = null;
      visited.current.add(id);
      const stamp = stampFor(id);
      if (stamp) grantStamp(stamp);
      if (id === 'daniel') danielTalks.current += 1;
      if (['daniel', 'board', 'garden', 'mailbox'].every((x) => visited.current.has(x as InteractableId))) unlock('vecino');
      if (id.startsWith('project:')) {
        store.seenProjects.add(Number(id.split(':')[1]));
        persistProgress();
        if (store.seenProjects.size === PROJECT_SIGNS.length) unlock('curioso');
      }
      sfx.open();
      (document.activeElement as HTMLElement | null)?.blur?.();
      setPanel(null);
      setSheet(null);
      setDialog(buildDialog(id));
      setLine(0);
      setTyped(0);
      setChoiceIdx(0);
    },
    [buildDialog, grantStamp, persistProgress, store, unlock],
  );

  const walkTo = useCallback(
    (id: InteractableId) => {
      if (!started) return;
      const it = INTERACTABLES.find((x) => x.id === id);
      if (!it) return;
      setDialog(null);
      setPanel(null);
      if (Math.hypot(it.x - store.pos.x, it.z - store.pos.z) < it.radius) {
        openDialog(id);
        return;
      }
      sfx.select();
      store.target = approachPoint(it);
      store.targetId = id;
    },
    [openDialog, started, store],
  );

  walkToRef.current = walkTo;
  const events = useRef<GameEvents>({} as GameEvents);
  events.current = {
    onNear: setNear,
    onArrive: openDialog,
    onCut: (n) => {
      const next = (cutRef.current += n);
      setCut(next);
      // "Your first tufts": the 2D island keeps ~22 of them and digging no
      // longer counts as cutting, so the old 60 meant re-cutting it all thrice.
      if (next >= 5) unlock('jardinero');
      if (next >= store.grassTotal * 0.35) unlock('cesped');
    },
    onStar: (i) => {
      store.starsTaken.add(i);
      persistProgress();
      const next = (starsRef.current += 1);
      setStars(next);
      if (next === STAR_COUNT) unlock('estrellas');
      else toast('⭐', `¡Estrellita! ${next}/${STAR_COUNT}`, 'Sigue cortando el pasto para encontrar más.');
    },
    onPet: () => {
      const n = finiteOr(readStorage<unknown>('island-dui-pets', 0), 0) + 1;
      writeStorage('island-dui-pets', n);
      if (n === 1) {
        unlock('dui');
      } else if (n === 10) {
        toast('🐾', 'Dui está feliz', 'Diez cariños. Ya te considera parte de la familia (y quiere comida).');
      }
    },
    onIdleHint: () => {
      const n = nextStamp(stampsRef.current);
      const now = performance.now();
      // Once in a while is a hint; every time would be nagging.
      if (!n || now - duiHintAt.current < 45_000) return;
      duiHintAt.current = now;
      toast('🐾', 'Dui huele algo por allá', `${n.hint} Busca el letrero con la huellita 🐾.`);
    },
    onStarRevealed: () => {
      if (revealHint.current) return;
      revealHint.current = true;
      toast('✨', '¡Algo brilla!', 'Apareció una estrellita. Camina hacia ella para tomarla.');
    },
  };

  // Typewriter + villager-speak.
  const fullText = dialog?.lines[line] ?? '';
  const lineDone = typed >= fullText.length;
  useEffect(() => {
    if (!dialog || lineDone) return;
    if (reduceMotion) {
      setTyped(fullText.length);
      return;
    }
    const t = window.setTimeout(() => {
      setTyped((n) => n + 1);
      if (typed % 3 === 0 && fullText[typed] !== ' ') sfx.talk();
    }, 22);
    return () => window.clearTimeout(t);
  }, [dialog, typed, lineDone, fullText, reduceMotion]);

  const isLastLine = !!dialog && line === dialog.lines.length - 1;
  const showChoices = isLastLine && lineDone && !!dialog?.choices?.length;

  const advance = useCallback(() => {
    if (!dialog) return;
    if (!lineDone) {
      setTyped(fullText.length);
      return;
    }
    if (!isLastLine) {
      setLine((l) => l + 1);
      setTyped(0);
      sfx.select();
      return;
    }
    if (!dialog.choices?.length) closeDialog();
  }, [dialog, lineDone, fullText.length, isLastLine, closeDialog]);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setMusicVolume(musicVol);
    setMusicMood(WEATHER_CONFIG[weather].music);
    initAudio(muted);
    // The start button keeps keyboard focus while the screen fades out, and a
    // focused button keeps Space for itself: someone who entered with Enter
    // could then never jump. Let the island have the keyboard.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setStarted(true);
    grantStamp('llegada');
    if (!readStorage('island-tutorial-done', false)) {
      later(() => {
        if (busyRef.current || store.target) return;
        openDialog('welcome');
        // Seen counts as done: closing it with Esc or by tapping a travel
        // button never reached finishTutorial, so it opened on every visit.
        writeStorage('island-tutorial-done', true);
      }, 1300);
    }
  }, [grantStamp, later, musicVol, muted, openDialog, weather]);

  // Stop every sound and pending timer when leaving the island.
  useEffect(
    () => () => {
      pauseAudio();
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const chooseWeather = useCallback((w: WeatherId) => {
    setWeather(w);
    writeStorage('island-weather', w);
    setMusicMood(WEATHER_CONFIG[w].music);
    sfx.select();
  }, []);

  chooseWeatherRef.current = chooseWeather;

  // Live readings for the ESP32 station (San Antonio, Valparaíso).
  useEffect(() => {
    let alive = true;
    let retry = 0;
    // A first request that fails (flaky mobile data, a cold API) left the
    // station "offline", and the Meteorólogo badge out of reach, for the full
    // 10 minutes until the next poll. Try again sooner while there is no reading.
    const retrySoon = () => {
      if (!alive || store.meteo) return;
      window.clearTimeout(retry);
      retry = window.setTimeout(load, 30_000);
    };
    const load = async () => {
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=-33.5933&longitude=-71.6217&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=sunset&forecast_days=1&timezone=auto&timeformat=unixtime',
        );
        if (!res.ok) return retrySoon();
        const d = await res.json();
        if (!alive) return;
        const c = d?.current ?? {};
        // Open-Meteo can return null for a reading; the station dialog calls
        // toFixed on these, which would crash the island.
        if (![c.temperature_2m, c.relative_humidity_2m, c.wind_speed_10m, c.weather_code].every(Number.isFinite)) return retrySoon();
        store.meteo = {
          temp: c.temperature_2m,
          hum: c.relative_humidity_2m,
          wind: c.wind_speed_10m,
          code: c.weather_code,
          isDay: c.is_day === 1,
          sunset: finiteOr(d.daily?.sunset?.[0], 0),
        };
      } catch {
        // Offline or blocked: the station shows "no logra conectarse" for now.
        retrySoon();
      }
    };
    load();
    const t = window.setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.clearTimeout(retry);
    };
  }, [store]);

  const changeMusicVol = (v: number) => {
    setMusicVol(v);
    setMusicVolume(v);
    writeStorage('island-music-vol', v);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setAudioMuted(m);
    writeStorage('island-muted', m);
  };

  // Keyboard.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.metaKey) store.keys.clear();
      if (paused || isTyping(e) || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      // A focused button keeps Enter (and Space inside menus) for itself.
      const onControl = (e.target as HTMLElement | null)?.closest?.('button, a') as HTMLElement | null;
      if (onControl && key === 'enter') return;
      if (onControl && key === ' ') {
        if (!started || dialog || panel || sheet) return;
        // Keyboard focus (the ring is showing): Space presses the button, as
        // everywhere else on the web, and must not also make Dui jump. Focus
        // left behind by a mouse click: drop it and let Space jump, or one
        // click on a HUD button would press it again on every jump.
        if (onControl.matches(':focus-visible')) return;
        onControl.blur();
      }
      if (key === 'escape' && sheet) {
        setSheet(null);
        return;
      }
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
      if (!started) {
        if (key === 'enter' || key === ' ') start();
        return;
      }
      if (panel) {
        if (key === 'escape') {
          setPanel(null);
          sfx.close();
        }
        return;
      }
      if (dialog) {
        if (e.repeat) return;
        if (key === 'escape') closeDialog();
        else if (showChoices && dialog.choices) {
          const n = dialog.choices.length;
          if (key === 'arrowdown' || key === 's') {
            setChoiceIdx((i) => (i + 1) % n);
            sfx.select();
          } else if (key === 'arrowup' || key === 'w') {
            setChoiceIdx((i) => (i - 1 + n) % n);
            sfx.select();
          } else if (key === 'enter' || key === ' ' || key === 'e') dialog.choices[choiceIdx]?.run();
        } else if (key === 'enter' || key === ' ' || key === 'e') advance();
        return;
      }
      if ((key === 'e' || key === 'enter') && store.nearId) {
        openDialog(store.nearId);
        return;
      }
      if (!e.repeat) {
        if (key === ' ' || key === 'w' || key === 'arrowup') hintOnce('salto', '⬆️', '¡Salto!', 'Mantén la tecla para saltar más alto y subir los cerros.');
        if (key === 'f') hintOnce('zarpazo', '🐾', '¡Zarpazo!', 'Corta el pasto alto: ahí se esconden estrellitas. Con S + F cavas hacia abajo.');
      }
      konami.current = [...konami.current, key].slice(-KONAMI.length);
      if (konami.current.join() === KONAMI.join()) {
        konami.current = [];
        store.burst('party', store.pos.x, store.pos.z);
        sfx.achievement();
        unlock('secreto');
        toast('🎉', '¡Fiesta en la isla!', 'Encontraste el código secreto.');
      }
      // Cmd/Option change e.key (Option+W is '∑') and macOS sends no keyup for
      // letters while Cmd is held, so a held key could stay "down" forever.
      if (e.metaKey || e.altKey) {
        store.keys.clear();
        return;
      }
      store.keys.add(movementKey(e));
    };
    const up = (e: KeyboardEvent) => store.keys.delete(movementKey(e));
    const blur = () => store.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [advance, choiceIdx, closeDialog, dialog, hintOnce, openDialog, panel, paused, sheet, showChoices, start, started, store, toast, unlock]);

  useEffect(() => {
    if (!dialog && !panel) return;
    store.keys.clear();
    // Opening a dialog can unmount the scissors button mid-press, so its
    // pointerup never fires and the player kept cutting after closing it.
    store.cutHeld = false;
  }, [dialog, panel, store]);

  const nearItem = near ? INTERACTABLES.find((x) => x.id === near) : null;

  // The weather and sound sheets open from a HUD button: focus goes to their
  // close button so keyboard and screen reader users land inside, and back
  // to the button that opened them when they close.
  const sheetRef = useRef<HTMLElement>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!sheet) {
      sheetOpener.current?.focus?.({ preventScroll: true });
      sheetOpener.current = null;
      return;
    }
    sheetOpener.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [sheet]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="absolute inset-0 font-cozy select-none">
      {/* La isla en 2D, dibujada en crayón en un canvas: corre en cualquier equipo, sin WebGL. */}
      <PixelScene store={store} events={events} onWalkTo={walkTo} weather={weather} reduceMotion={reduceMotion} paused={paused} />

      {/* Crawlable summary for search engines and screen readers. */}
      <div className="sr-only">
        <h1>Daniel Eduardo — Ingeniero en Informática</h1>
        <p>Portafolio interactivo: una isla en 2D dibujada en crayón, para explorar con Dui, el gato de Daniel. Desarrollo web full stack, IoT y soluciones a medida.</p>
        <p>
          Cómo jugar con teclado: A y D o las flechas mueven a Dui, el gato de Daniel; Espacio o W salta; F da un zarpazo que corta el pasto
          y cava la tierra; E o Enter conversa con lo que tengas cerca. Los botones «Ir a» y «Más lugares» llevan a Dui directo a cada
          sitio. Lo que hay cerca se anuncia solo.
        </p>
      </div>
      {/* These links come first in the Tab order. Each one is hidden until it
          takes focus, like a skip link, so a sighted keyboard player sees
          where focus went instead of three invisible stops before the HUD.
          They sit outside the sr-only block above: inside it they'd stay
          clipped to 1px even while focused. */}
      <nav aria-label="Otras páginas">
        <a href="/clasico" className={SKIP_LINK}>Versión clásica del portafolio</a>
        <a href="/proyectos" className={SKIP_LINK}>Proyectos</a>
        <a href="/sobre-mi" className={SKIP_LINK}>Sobre mí</a>
      </nav>

      <AnimatePresence>{!started && <StartScreen onStart={start} onClassic={() => navigate('/clasico')} coarse={coarse} />}</AnimatePresence>

      {started && (
        <>
          {/* index.html sets viewport-fit=cover, so on notched phones the HUD,
              joystick, scissors and dialog sat under the notch or home bar
              until they were offset by the safe-area insets. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 md:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 md:gap-2">
              <span className="hidden md:inline-flex rounded-full bg-[#fff8e7]/95 px-4 py-2 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)]">
                🏝️ Isla de Daniel Eduardo
              </span>
              <Stat>⭐ {stars}/{STAR_COUNT}</Stat>
              {/* The notebook is the goal, so it takes the cut-grass counter's
                  place (that one now lives inside it). Visible on phones too. */}
              <button
                type="button"
                onClick={() => {
                  setDialog(null);
                  setSheet(null);
                  setPanel('libreta');
                  sfx.open();
                }}
                aria-label={`Libreta de Daniel: ${stamps.length} de ${STAMPS.length} sellos`}
                className="inline-flex h-10 items-center gap-1 rounded-full bg-[#ffe3a3] px-3 md:px-3.5 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] tabular-nums ring-2 ring-[#f0a45d]/60 hover:-translate-y-0.5 active:translate-y-0.5 transition-transform"
              >
                📖 {stamps.length}/{STAMPS.length}
              </button>
              <Stat title="Logros" className="hidden sm:inline-flex">
                🏆 {unlocked.length}/{Object.keys(ACHIEVEMENTS).length}
              </Stat>
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5 md:gap-2">
              <IconButton label={`Clima: ${WEATHERS.find((w) => w.id === weather)?.label ?? ''}`} active={sheet === 'weather'} onClick={() => setSheet((v) => (v === 'weather' ? null : 'weather'))}>
                {WEATHERS.find((w) => w.id === weather)?.emoji}
              </IconButton>
              <IconButton label="Música" active={sheet === 'sound'} onClick={() => setSheet((v) => (v === 'sound' ? null : 'sound'))}>
                🎧
              </IconButton>
              <IconButton label={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute} className="hidden md:grid">
                {muted ? '🔇' : '🔊'}
              </IconButton>
              <IconButton label="Ayuda" onClick={() => openDialog('welcome')}>
                ❔
              </IconButton>
              <IconButton label="Juego de aviones" onClick={() => navigate('/aviones')}>
                ✈️
              </IconButton>
              <button
                type="button"
                onClick={() => navigate('/clasico')}
                className="rounded-full bg-[#fff8e7]/95 px-3 md:px-4 h-10 text-xs md:text-sm font-extrabold text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] hover:-translate-y-0.5 transition-transform"
              >
                <span className="md:hidden">Clásica</span>
                <span className="hidden md:inline">Versión clásica</span>
              </button>
            </div>
          </div>

          {/* On narrow screens the four buttons wrap to a second row instead of
              scrolling sideways: as a hidden scroll strip, "Contacto" (the one
              that matters most) was the button left out of view. Under 390 px
              (iPhone SE, small Androids) the stats row above wraps too, so the
              row moves down: it used to cover the notebook button. On desktop the
              row sits at the bottom, where an open dialog covers it, so it hides
              while one is open instead of peeking out and taking keyboard focus. */}
          <nav
            aria-label="Ir a"
            className={`absolute z-20 left-1/2 -translate-x-1/2 top-[60px] max-[389px]:top-[108px] md:top-auto md:bottom-4 flex flex-wrap justify-center gap-1.5 md:gap-2 w-max max-w-[calc(100%-24px)] px-1 py-1 ${dialog || panel ? 'md:hidden' : ''}`}
          >
            {TRAVEL.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => walkTo(t.id)}
                className="shrink-0 rounded-full bg-[#7ccf8a] px-3 md:px-4 py-2 text-[12.5px] md:text-sm font-extrabold text-[#1d4a26] shadow-[0_3px_0_#4f9c5d] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_#4f9c5d] transition-transform"
              >
                <span className="mr-1">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </nav>

          {/* Hidden until it takes focus with Tab (it follows "Ir a"), so it
              helps keyboard players without crowding the screen. */}
          {!dialog && !panel && (
            <div className="absolute z-30 left-1/2 -translate-x-1/2 top-[150px] max-[389px]:top-[196px] md:top-auto md:bottom-20">
              <nav aria-label="Más lugares" className="sr-only focus-within:not-sr-only flex flex-wrap justify-center gap-1.5 rounded-full bg-[#fff8e7] p-1.5 shadow-[0_4px_0_rgba(91,70,54,0.25)]">
                {MORE_PLACES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => walkTo(p.id)}
                    className="shrink-0 rounded-full bg-[#f0e2c8] px-3 py-1.5 text-[12.5px] md:text-sm font-extrabold text-[#6b4f3a] hover:bg-[#ead6b3]"
                  >
                    {p.label}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* The map is aria-hidden, so say what Dui is next to. Not while he
              walks there on his own: the dialog opens by itself on arrival. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {nearItem && !dialog && !panel && store.targetId !== nearItem.id
              ? `${nearItem.verb} ${nearItem.label}: ${coarse ? 'toca el botón de abajo' : 'presiona E'}.`
              : ''}
          </p>

          {!coarse && !dialog && !panel && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden lg:block rounded-2xl bg-[#fff8e7]/85 px-4 py-3 text-xs font-bold leading-relaxed text-[#6b4f3a]">
              <Kbd>A</Kbd> <Kbd>D</Kbd> caminar · <Kbd>Shift</Kbd> correr · <Kbd>Espacio</Kbd> saltar
              <br />
              <Kbd>F</Kbd> zarpazo (pasto y tierra) · <Kbd>S</Kbd>+<Kbd>F</Kbd> cavar abajo · <Kbd>W</Kbd>+<Kbd>F</Kbd> subir cavando · <Kbd>E</Kbd> interactuar
              <br />
              <span className="text-[#7a614c]">Clic: caminar, cavar un bloque cercano o hacerle cariño a Dui</span>
            </div>
          )}

          <AnimatePresence>
            {nearItem && !dialog && !panel && (
              <motion.button
                key={nearItem.id}
                type="button"
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                onClick={() => openDialog(nearItem.id)}
                // 12 px above the joystick (2rem + 128 px + home bar): at 150 px its
                // bottom edge sat on the stick on narrow phones.
                className="absolute z-20 left-1/2 -translate-x-1/2 bottom-[calc(172px+env(safe-area-inset-bottom))] md:bottom-20 rounded-full bg-[#fff8e7] px-5 py-2.5 text-sm md:text-base font-extrabold text-[#6b4f3a] shadow-[0_4px_0_rgba(91,70,54,0.25)]"
              >
                {!coarse && <Kbd>E</Kbd>} {coarse && '💬 '}
                {nearItem.verb} {nearItem.label}
              </motion.button>
            )}
          </AnimatePresence>

          {coarse && !dialog && !panel && (
            <>
              <Joystick store={store} />
              <button
                type="button"
                aria-label="Zarpazo: cortar pasto o cavar"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  store.cutHeld = true;
                  hintOnce('zarpazo', '🐾', '¡Zarpazo!', 'Corta el pasto alto: ahí se esconden estrellitas. Joystick hacia abajo + 🐾 cava.');
                }}
                onPointerUp={() => (store.cutHeld = false)}
                onPointerCancel={() => (store.cutHeld = false)}
                className="absolute z-20 bottom-[calc(2rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] grid h-20 w-20 place-items-center rounded-full bg-[#fff8e7] text-3xl shadow-[0_5px_0_rgba(91,70,54,0.25)] active:translate-y-1 active:shadow-[0_1px_0_rgba(91,70,54,0.25)]"
                style={{ touchAction: 'none' }}
              >
                🐾
              </button>
            </>
          )}

          <div role="status" aria-live="polite" className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-[110px] max-[389px]:top-[196px] md:top-20 flex w-[min(360px,calc(100%-24px))] flex-col items-center gap-2">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.div
                  key={t.key}
                  layout
                  initial={{ opacity: 0, y: -14, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  className="flex w-full items-center gap-3 rounded-2xl bg-[#fff8e7] px-4 py-2.5 text-[#6b4f3a] shadow-[0_4px_0_rgba(91,70,54,0.2)]"
                >
                  <span aria-hidden="true" className="text-2xl">{t.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-black leading-tight">{t.title}</div>
                    <div className="text-xs font-bold text-[#7a614c] leading-snug">{t.text}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      <AnimatePresence>
        {dialog && (
          <DialogBox
            key={dialog.speaker}
            dialog={dialog}
            text={fullText.slice(0, typed)}
            fullText={fullText}
            lineDone={lineDone}
            showChoices={showChoices}
            choiceIdx={choiceIdx}
            setChoiceIdx={setChoiceIdx}
            onAdvance={advance}
            onSkip={finishTutorial}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel && (
          <PanelShell
            key={panel}
            title={panel === 'projects' ? '📌 Proyectos de Daniel' : panel === 'skills' ? '🌻 Huerto de habilidades' : '📖 Libreta de Daniel'}
            onClose={() => {
              setPanel(null);
              sfx.close();
            }}
          >
            {panel === 'projects' ? (
              <ProjectsPanel />
            ) : panel === 'skills' ? (
              <SkillsPanel />
            ) : (
              <LibretaPanel
                stamps={stamps}
                stars={stars}
                cut={cut}
                projectsSeen={store.seenProjects.size}
                pets={finiteOr(readStorage<unknown>('island-dui-pets', 0), 0)}
                unlocked={unlocked}
                onGo={(target) => {
                  setPanel(null);
                  walkTo(target);
                }}
              />
            )}
          </PanelShell>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {started && sheet && (
          <motion.aside
            key={sheet}
            ref={sheetRef}
            role="dialog"
            aria-label={sheet === 'weather' ? 'Elegir clima' : 'Música'}
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            data-lenis-prevent
            className="absolute right-3 top-[112px] md:right-4 md:top-[68px] z-30 w-[min(340px,calc(100%-24px))] max-h-[calc(100svh-190px)] md:max-h-[calc(100svh-150px)] overflow-y-auto rounded-[1.75rem] bg-[#fff8e7] p-4 text-[#5b4636] shadow-[0_6px_0_rgba(91,70,54,0.22),0_20px_50px_rgba(60,30,40,0.25)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black">{sheet === 'weather' ? '🌦️ Clima de la isla' : '🎧 Música'}</h2>
              <button type="button" onClick={() => setSheet(null)} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full bg-[#f0e2c8] hover:bg-[#ead6b3]">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            {sheet === 'weather' ? (
              <WeatherPicker weather={weather} onChoose={chooseWeather} />
            ) : (
              <SoundMixer volume={musicVol} muted={muted} onVolume={changeMusicVol} onToggleMute={toggleMute} />
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

function WeatherPicker({ weather, onChoose }: { weather: WeatherId; onChoose: (w: WeatherId) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {WEATHERS.map((w) => {
          const on = w.id === weather;
          return (
            <button
              key={w.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(w.id)}
              className={`flex items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-[15px] font-extrabold transition-colors ${
                on ? 'bg-[#f0a45d] text-[#3d2410] shadow-[0_3px_0_#c97d3c]' : 'bg-white hover:bg-[#fbf1dc]'
              }`}
            >
              <span className="text-2xl">{w.emoji}</span>
              {w.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs font-bold opacity-80">De noche y con lluvia la música se vuelve más tranquila. Ajusta el volumen en 🎧.</p>
    </>
  );
}

type SoundMixerProps = {
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
};

function SoundMixer({ volume, muted, onVolume, onToggleMute }: SoundMixerProps) {
  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl bg-[#f6ecd9] px-3 py-2.5">
        <button type="button" onClick={onToggleMute} aria-label={muted ? 'Activar sonido' : 'Silenciar todo'} className="text-xl">
          {muted ? '🔇' : '🔊'}
        </button>
        <label className="flex-1">
          <span className="block text-[13px] font-extrabold leading-tight">🎶 Música</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label="Volumen de la música"
            onChange={(e) => onVolume(Number(e.target.value))}
            className="cozy-range mt-1 w-full"
          />
        </label>
      </div>
      <p className="mt-3 text-[11px] font-bold opacity-80">Una canción chiptune original que se genera en vivo en tu navegador. Sigue sonando mientras exploras.</p>
    </>
  );
}

function Stat({ children, title, className = 'inline-flex' }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`${className} h-10 items-center rounded-full bg-[#fff8e7]/95 px-3 md:px-3.5 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] tabular-nums`}>
      {children}
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
  className = 'grid',
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // Only a real toggle (the sheet buttons) announces pressed/not pressed;
      // "Ayuda, toggle button, not pressed" was wrong for a plain button.
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`${className} h-10 w-10 place-items-center rounded-full text-lg shadow-[0_3px_0_rgba(91,70,54,0.2)] hover:-translate-y-0.5 transition-transform ${
        active ? 'bg-[#f0a45d]' : 'bg-[#fff8e7]/95'
      }`}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-[#6b4f3a] px-1.5 py-0.5 text-[11px] font-black text-[#fff8e7]">{children}</kbd>;
}

function StartScreen({ onStart, onClassic, coarse }: { onStart: () => void; onClassic: () => void; coarse: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.6 } }}
      className="absolute inset-0 z-40 grid place-items-center bg-gradient-to-b from-[#4f5499]/35 via-transparent to-[#f6a07e]/40 p-4"
    >
      <motion.div
        initial={{ y: 24, scale: 0.94, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: -30, scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.25 }}
        className="w-full max-w-md rounded-[2rem] bg-[#fff8e7] px-7 py-8 text-center text-[#6b4f3a] shadow-[0_8px_0_rgba(91,70,54,0.25),0_30px_60px_rgba(60,30,40,0.3)]"
      >
        <div className="text-sm font-extrabold uppercase tracking-[0.25em] text-[#a4552c]">🏝️ Bienvenid@ a la isla de</div>
        <h1 className="mt-2 text-4xl md:text-5xl font-black leading-none text-[#5b4636]">Daniel Eduardo</h1>
        <p className="mt-3 text-[15px] font-bold leading-snug text-[#7a614c]">
          Ingeniero en Informática. Desarrollo web full stack, IoT y soluciones a medida.
        </p>
        <motion.button
          type="button"
          onClick={onStart}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          autoFocus
          className="mt-7 w-full rounded-full bg-[#7ccf8a] py-4 text-lg font-black text-[#1d4a26] shadow-[0_5px_0_#4f9c5d] active:translate-y-1 active:shadow-[0_1px_0_#4f9c5d]"
        >
          ▶ Entrar a la isla
        </motion.button>
        <p className="mt-4 text-xs font-bold text-[#7a614c]">
          {coarse ? 'Joystick para caminar (arriba salta) y 🐾 para el zarpazo.' : 'A/D para caminar · Espacio salta · F zarpazo · E para hablar'}
        </p>
        <button type="button" onClick={onClassic} className="mt-5 text-sm font-extrabold text-[#7a614c] underline decoration-2 underline-offset-4 hover:text-[#5b4636]">
          Prefiero la versión clásica
        </button>
      </motion.div>
    </motion.div>
  );
}

type DialogBoxProps = {
  dialog: Dialog;
  text: string;
  fullText: string;
  lineDone: boolean;
  showChoices: boolean;
  choiceIdx: number;
  setChoiceIdx: (i: number) => void;
  onAdvance: () => void;
  onSkip: () => void;
};

function DialogBox({ dialog, text, fullText, lineDone, showChoices, choiceIdx, setChoiceIdx, onAdvance, onSkip }: DialogBoxProps) {
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Keep keyboard focus on the highlighted choice so Enter/Space pick it.
  useEffect(() => {
    if (showChoices) list.current?.querySelectorAll('button')[choiceIdx]?.focus({ preventScroll: true });
  }, [showChoices, choiceIdx]);
  // Until the choices show, focus sits on the box itself: a screen reader
  // then hears who is talking and the lines as they complete, and Tab from
  // here reaches "Saltar tutorial" instead of the HUD behind it.
  // `dialog` is a dependency because reopening the same speaker right after
  // closing reuses the exiting box (same key), so mount alone is not enough.
  useEffect(() => {
    if (!showChoices) box.current?.focus({ preventScroll: true });
  }, [showChoices, dialog]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-40 mx-auto w-[min(680px,calc(100%-24px))]"
    >
      <AnimatePresence>
        {showChoices && dialog.choices && (
          <motion.ul
            ref={list}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 ml-auto w-fit max-w-full space-y-1.5 rounded-3xl bg-[#fff8e7] p-2.5 shadow-[0_5px_0_rgba(91,70,54,0.2)]"
          >
            {dialog.choices.map((c, i) => (
              <li key={c.label}>
                <button
                  type="button"
                  onClick={c.run}
                  onMouseEnter={() => setChoiceIdx(i)}
                  className={`flex w-full items-center gap-2 rounded-2xl px-4 py-2 text-left text-[15px] font-extrabold transition-colors ${
                    i === choiceIdx ? 'bg-[#f0a45d] text-[#3d2410]' : 'text-[#6b4f3a]'
                  }`}
                >
                  <span className={i === choiceIdx ? 'opacity-100' : 'opacity-0'}>▶</span>
                  {c.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div
        ref={box}
        role="dialog"
        aria-label={dialog.speaker}
        tabIndex={-1}
        onClick={onAdvance}
        className="relative cursor-pointer rounded-[2rem] bg-[#fff8e7] px-6 pb-7 pt-8 md:px-9 md:pt-9 text-[#5b4636] shadow-[0_6px_0_rgba(91,70,54,0.22),0_20px_50px_rgba(60,30,40,0.25)]"
      >
        <span className="absolute -top-4 left-6 -rotate-3 rounded-full bg-[#f0a45d] px-5 py-1.5 text-base font-black text-[#3d2410] shadow-[0_3px_0_#c97d3c]">
          {dialog.speaker}
        </span>
        {dialog.skippable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
            className="absolute -top-4 right-6 rounded-full bg-[#fff8e7] px-4 py-1.5 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.25)] ring-2 ring-[#ead6b3] hover:-translate-y-0.5 transition-transform"
          >
            Saltar tutorial ⏭
          </button>
        )}
        <p aria-hidden className="min-h-[3.2em] text-[17px] md:text-lg font-bold leading-relaxed">
          {text}
        </p>
        {/* Screen readers get each line once, complete, instead of letter by letter. */}
        <p className="sr-only" aria-live="polite">
          {lineDone ? `${dialog.speaker}: ${fullText}` : ''}
        </p>
        {lineDone && !showChoices && (
          <motion.span
            animate={{ y: [0, 4, 0] }}
            transition={{ repeat: Infinity, duration: 0.9 }}
            className="absolute bottom-3 right-6 text-[#f0a45d]"
          >
            ▼
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}

function LibretaPanel({
  stamps,
  stars,
  cut,
  projectsSeen,
  pets,
  unlocked,
  onGo,
}: {
  stamps: StampId[];
  stars: number;
  cut: number;
  projectsSeen: number;
  pets: number;
  unlocked: AchievementId[];
  onGo: (target: InteractableId) => void;
}) {
  const next = nextStamp(stamps);
  return (
    <div className="space-y-6">
      <p className="text-sm font-bold leading-relaxed text-[#6b4f3a]">
        {next
          ? 'Junta los cinco sellos recorriendo la isla con Dui. Cada uno es una parte del portafolio. El letrero con la huellita 🐾 marca el próximo lugar.'
          : '¡Libreta completa! Ya conoces a Daniel, su trabajo y cómo escribirle. Gracias por recorrer la isla. 🧡'}
      </p>

      <ol className="space-y-2.5">
        {STAMPS.map((s, i) => {
          const done = stamps.includes(s.id);
          const isNext = next?.id === s.id;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${done ? 'bg-[#e4f5dd]' : isNext ? 'bg-[#fff1cc] ring-2 ring-[#f0a45d]' : 'bg-[#f5ead6]'}`}
            >
              <span
                aria-hidden="true"
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl ${done ? 'bg-[#7ccf8a] shadow-[0_3px_0_#4f9c5d]' : 'bg-[#fff8e7] grayscale opacity-60'}`}
              >
                {done ? s.icon : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-black text-[#5b4636]">
                  {s.title}
                  <span className="sr-only">{done ? ' (sellado)' : ' (pendiente)'}</span>
                </p>
                {!done && <p className="text-sm font-bold text-[#7a614c]">{s.hint}</p>}
              </div>
              {done ? (
                <span aria-hidden="true" className="text-lg font-black text-[#3f8a4b]">✓</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onGo(s.target)}
                  className="shrink-0 rounded-full bg-[#7ccf8a] px-3.5 py-2 text-sm font-extrabold text-[#1d4a26] shadow-[0_3px_0_#4f9c5d] hover:-translate-y-0.5 active:translate-y-0.5 transition-transform"
                >
                  Ir
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <section>
        <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-[#a4552c]">Para quien se queda un rato más</h3>
        <ul className="grid grid-cols-2 gap-2 text-sm font-bold text-[#6b4f3a]">
          <li className="rounded-xl bg-[#f5ead6] px-3 py-2">📌 Letreros leídos {projectsSeen}/{PROJECT_SIGNS.length}</li>
          <li className="rounded-xl bg-[#f5ead6] px-3 py-2">⭐ Estrellitas {stars}/{STAR_COUNT}</li>
          <li className="rounded-xl bg-[#f5ead6] px-3 py-2">🐾 Cariños a Dui {pets}</li>
          <li className="rounded-xl bg-[#f5ead6] px-3 py-2">✂️ Pasto cortado {cut}</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-[#a4552c]">
          Logros {unlocked.length}/{Object.keys(ACHIEVEMENTS).length}
        </h3>
        <ul className="space-y-1.5">
          {(Object.keys(ACHIEVEMENTS) as AchievementId[]).map((id) => {
            const a = ACHIEVEMENTS[id];
            const got = unlocked.includes(id);
            return (
              <li key={id} className={`flex items-start gap-2.5 text-sm ${got ? 'text-[#5b4636]' : 'text-[#7a614c]'}`}>
                <span aria-hidden="true" className={got ? '' : 'grayscale opacity-50'}>{got ? a.icon : '🔒'}</span>
                <span>
                  <span className="font-black">{got ? a.title : 'Logro escondido'}</span>
                  {got && <span className="font-bold"> · {a.text}</span>}
                  <span className="sr-only">{got ? ' (conseguido)' : ' (pendiente)'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  // Keep Tab inside the panel.
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const items = box.current.querySelectorAll<HTMLElement>('a[href], button');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 grid place-items-center bg-[#3b2a33]/35 p-3 md:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={trap}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88svh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] bg-[#fff8e7] text-[#5b4636] shadow-[0_8px_0_rgba(91,70,54,0.25),0_30px_60px_rgba(60,30,40,0.3)]"
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-dashed border-[#e8d5b5] px-6 py-4">
          <h2 className="text-xl md:text-2xl font-black">{title}</h2>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-full bg-[#f0e2c8] hover:bg-[#ead6b3]">
            <X size={18} strokeWidth={3} />
          </button>
        </div>
        <div data-lenis-prevent className="overflow-y-auto p-4 md:p-6">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function ProjectsPanel() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PROJECT_SIGNS.map(({ project: p, color }) => (
        <div key={p.id} className="flex flex-col rounded-3xl bg-white p-4 shadow-[0_3px_0_rgba(91,70,54,0.12)]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: color }}>
              <p.icon size={20} strokeWidth={2.2} />
            </span>
            <h3 className="text-lg font-black leading-tight">{p.title}</h3>
          </div>
          <p className="mt-2.5 flex-1 text-sm font-semibold leading-snug opacity-80">{p.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {p.tags.map((t) => (
              <span key={t} className="rounded-full bg-[#f6ecd9] px-2.5 py-0.5 text-[11px] font-extrabold">
                {t}
              </span>
            ))}
            {!p.comingSoon && (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#7ccf8a] px-3 py-1 text-xs font-black text-[#1d4a26] shadow-[0_2px_0_#4f9c5d]"
              >
                Visitar <ArrowUpRight size={13} strokeWidth={3} />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SkillsPanel() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {SKILLS.map((g, i) => (
        <div key={g.title} className="rounded-3xl bg-white p-4 shadow-[0_3px_0_rgba(91,70,54,0.12)]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f6ecd9] text-2xl">{CROP_EMOJI[i % CROP_EMOJI.length]}</span>
            <h3 className="text-lg font-black">{g.title}</h3>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {g.items.map((item) => (
              <span key={item} className="rounded-full bg-[#e3f4d9] px-3 py-1 text-xs font-extrabold text-[#4f7a3e]">
                🌱 {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Joystick({ store }: { store: ReturnType<typeof createStore> }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 46;
  // A thumb never lands exactly on the centre: inside this radius nothing
  // moves, and past it the stick ramps up from 0 so there is no jolt.
  const DEAD = 9;
  const move = (e: ReactPointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    const m = d < DEAD ? 0 : Math.min(1, (d - DEAD) / (R - DEAD));
    dx = d ? (dx / d) * m * R : 0;
    dy = d ? (dy / d) * m * R : 0;
    setKnob({ x: dx, y: dy });
    store.joy.x = dx / R;
    store.joy.z = dy / R;
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    store.joy.x = 0;
    store.joy.z = 0;
  };
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={base}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      className="absolute z-20 bottom-[calc(2rem+env(safe-area-inset-bottom))] left-[calc(1.5rem+env(safe-area-inset-left))] h-32 w-32 rounded-full bg-[#fff8e7]/55 shadow-[inset_0_2px_8px_rgba(91,70,54,0.25)]"
      style={{ touchAction: 'none' }}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-[#fff8e7] shadow-[0_4px_0_rgba(91,70,54,0.25)]"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}
