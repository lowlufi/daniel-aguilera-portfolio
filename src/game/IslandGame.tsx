import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import { PROJECTS, SKILLS, SOCIAL } from '../data';
import Scene from './Scene';
import { LabelsOverlay } from './labels';
import { AMBIENTS, initAudio, pauseAudio, setAmbient, setAmbientVolume, setMix as setAudioMix, setMuted as setAudioMuted, sfx, type AmbientId, type Mix } from './audio';
import { WEATHERS, WEATHER_CONFIG, stepAtmosphere, type WeatherId } from './weather';
import { createStore, type GameEvents } from './store';
import { INTERACTABLES, PROJECT_SIGNS, STAR_COUNT, approachPoint, type InteractableId } from './world';

type Props = {
  navigate: (to: string) => void;
  openComposer: () => void;
  paused: boolean;
};

type Choice = { label: string; run: () => void };
type Dialog = { speaker: string; lines: string[]; choices?: Choice[] };
type Panel = 'projects' | 'skills' | null;
type Toast = { key: number; icon: string; title: string; text: string };

const ACHIEVEMENTS = {
  jardinero: { icon: '✂️', title: 'Jardinero aficionado', text: 'Cortaste tus primeros matojos.' },
  cesped: { icon: '🌿', title: 'Césped impecable', text: 'Cortaste más de un tercio de la isla.' },
  estrellas: { icon: '⭐', title: 'Cazador de estrellitas', text: `Encontraste las ${STAR_COUNT} estrellitas escondidas.` },
  vecino: { icon: '🏡', title: 'Buen vecino', text: 'Visitaste a Daniel, el tablón, el huerto y el buzón.' },
  curioso: { icon: '🔍', title: 'Curiosidad infinita', text: 'Leíste todos los letreros de proyectos.' },
} as const;
type AchievementId = keyof typeof ACHIEVEMENTS;

const TRAVEL: { id: InteractableId; emoji: string; label: string }[] = [
  { id: 'daniel', emoji: '🧑‍💻', label: 'Sobre mí' },
  { id: 'board', emoji: '📌', label: 'Proyectos' },
  { id: 'garden', emoji: '🌻', label: 'Habilidades' },
  { id: 'mailbox', emoji: '✉️', label: 'Contacto' },
];

const CROP_EMOJI = ['🌻', '🍅', '🥕', '🥬'];

const SOUND_PRESETS: { label: string; emoji: string; mix: Mix }[] = [
  { label: 'Tormenta', emoji: '⛈️', mix: { lluvia: 0.9, truenos: 0.6, viento: 0.4 } },
  { label: 'Bosque', emoji: '🌲', mix: { pajaritos: 0.7, arroyo: 0.5, viento: 0.25 } },
  { label: 'Playa', emoji: '🏖️', mix: { olas: 0.8, viento: 0.3, pajaritos: 0.15 } },
  { label: 'Chimenea', emoji: '🪵', mix: { fogata: 0.8, lluvia: 0.3, musica: 0.25 } },
  { label: 'Noche', emoji: '🌌', mix: { grillos: 0.7, fogata: 0.2, olas: 0.2 } },
  { label: 'Silencio', emoji: '🤫', mix: {} },
];

type Sheet = 'weather' | 'sound' | null;

function fullMix(m: Mix): Record<AmbientId, number> {
  return Object.fromEntries(AMBIENTS.map((a) => [a.id, m[a.id] ?? 0])) as Record<AmbientId, number>;
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
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
  const quality = useMemo<'high' | 'low'>(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return coarse || (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'high';
  }, []);
  const coarse = useCoarsePointer();

  const [started, setStarted] = useState(false);
  const [near, setNear] = useState<InteractableId | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState(0);
  const [choiceIdx, setChoiceIdx] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [stars, setStars] = useState(0);
  const [cut, setCut] = useState(0);
  const [muted, setMuted] = useState(() => readStorage('island-muted', false));
  const [weather, setWeather] = useState<WeatherId>(() => {
    const w = readStorage<WeatherId>('island-weather', 'atardecer');
    return w in WEATHER_CONFIG ? w : 'atardecer';
  });
  const [mix, setMixState] = useState<Record<AmbientId, number>>(() => fullMix(readStorage<Mix>('island-mix', WEATHER_CONFIG[weather].mix)));
  const [ambVol, setAmbVol] = useState(() => readStorage('island-ambvol', 0.8));
  const [sheet, setSheet] = useState<Sheet>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const [unlocked, setUnlocked] = useState<AchievementId[]>(() => readStorage('island-achievements', [] as AchievementId[]));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const visited = useRef(new Set<InteractableId>());
  const seenProjects = useRef(new Set<number>());
  const toastKey = useRef(0);
  const revealHint = useRef(false);

  if (import.meta.env.DEV) (window as unknown as { __island?: unknown }).__island = { store, walkTo: (id: InteractableId) => walkToRef.current(id), snapWeather: () => stepAtmosphere(1) };
  const walkToRef = useRef<(id: InteractableId) => void>(() => {});

  const busyRef = useRef(false);
  busyRef.current = !!dialog || !!panel || paused || !!store.target;
  store.frozen = !started || !!dialog || !!panel || paused;
  store.started = started;


  const toast = useCallback((icon: string, title: string, text: string) => {
    const key = ++toastKey.current;
    setToasts((t) => [...t.slice(-2), { key, icon, title, text }]);
    later(() => setToasts((t) => t.filter((x) => x.key !== key)), 3600);
  }, [later]);

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
  const cutRef = useRef(0);
  const starsRef = useRef(0);
  const startedRef = useRef(false);

  const closeDialog = useCallback(() => {
    setDialog(null);
    sfx.close();
  }, []);

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const buildDialog = useCallback(
    (id: InteractableId): Dialog => {
      const close = { label: 'Cerrar', run: closeDialog };
      if (id === 'welcome')
        return {
          speaker: 'Letrero',
          lines: [
            '¡Bienvenid@ a la isla de Daniel Eduardo! 🌅',
            'Camina con WASD o las flechas (en el celular, con el joystick). Mantén Shift para correr.',
            'Mantén Espacio (o ✂️) para cortar el pasto. Dicen que hay estrellitas escondidas entre el pasto alto…',
            'Acércate a las cosas y pulsa E para interactuar. ¡O usa los botones de abajo para ir directo!',
          ],
          choices: [{ label: '¡Vamos!', run: closeDialog }],
        };
      if (id === 'daniel')
        return {
          speaker: 'Daniel',
          lines: [
            '¡Hola! Qué bueno que pasaste por mi isla. 😊',
            'Soy Ingeniero en Informática con mención en gestión de la información, de la Universidad de Playa Ancha.',
            'Construyo experiencias web, plataformas educativas, e-commerce y sistemas IoT — uniendo el detalle artesanal con el rigor técnico.',
            'Me obsesiona la artesanía digital: que el código sea simple, que la interfaz se sienta natural y que cada microinteracción tenga una razón.',
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
          choices: [{ label: 'Mirar las plantas', run: () => { setDialog(null); setPanel('skills'); sfx.open(); } }, close],
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
    [closeDialog, openComposer],
  );

  const openDialog = useCallback(
    (id: InteractableId) => {
      const it = INTERACTABLES.find((x) => x.id === id);
      if (it) store.facing = Math.atan2(it.x - store.pos.x, it.z - store.pos.z);
      store.target = null;
      store.targetId = null;
      visited.current.add(id);
      if (['daniel', 'board', 'garden', 'mailbox'].every((x) => visited.current.has(x as InteractableId))) unlock('vecino');
      if (id.startsWith('project:')) {
        seenProjects.current.add(Number(id.split(':')[1]));
        if (seenProjects.current.size === PROJECT_SIGNS.length) unlock('curioso');
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
    [buildDialog, store, unlock],
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
      if (next >= 60) unlock('jardinero');
      if (next >= store.grassTotal * 0.35) unlock('cesped');
    },
    onStar: () => {
      const next = (starsRef.current += 1);
      setStars(next);
      if (next === STAR_COUNT) unlock('estrellas');
      else toast('⭐', `¡Estrellita! ${next}/${STAR_COUNT}`, 'Sigue cortando el pasto para encontrar más.');
    },
    onStarRevealed: () => {
      if (revealHint.current) return;
      revealHint.current = true;
      toast('✨', '¡Algo brilla!', 'Apareció una estrellita bajo el pasto. Camina hacia ella.');
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
    setAmbientVolume(ambVol);
    setAudioMix(mix);
    initAudio(muted);
    setStarted(true);
    later(() => {
      if (!busyRef.current) openDialog('welcome');
    }, 1300);
  }, [ambVol, later, mix, muted, openDialog]);

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
    const m = fullMix(WEATHER_CONFIG[w].mix);
    setMixState(m);
    setAudioMix(m);
    writeStorage('island-mix', m);
    sfx.select();
  }, []);

  const applyMix = useCallback((m: Mix) => {
    const full = fullMix(m);
    setMixState(full);
    setAudioMix(full);
    writeStorage('island-mix', full);
  }, []);

  const changeChannel = useCallback((id: AmbientId, v: number) => {
    setMixState((prev) => {
      const next = { ...prev, [id]: v };
      writeStorage('island-mix', next);
      return next;
    });
    setAmbient(id, v);
  }, []);

  const changeAmbVol = (v: number) => {
    setAmbVol(v);
    setAmbientVolume(v);
    writeStorage('island-ambvol', v);
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
      if (paused || isTyping(e) || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      // A focused button keeps Enter (and Space inside menus) for itself. Out on the
      // island, Space always means "cut", so drop focus from the HUD button.
      const onControl = (e.target as HTMLElement | null)?.closest?.('button, a') as HTMLElement | null;
      if (onControl && key === 'enter') return;
      if (onControl && key === ' ') {
        if (!started || dialog || panel || sheet) return;
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
      store.keys.add(key);
    };
    const up = (e: KeyboardEvent) => store.keys.delete(e.key.toLowerCase());
    const blur = () => store.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [advance, choiceIdx, closeDialog, dialog, openDialog, panel, paused, sheet, showChoices, start, started, store]);

  useEffect(() => {
    if (dialog || panel) store.keys.clear();
  }, [dialog, panel, store]);

  const nearItem = near ? INTERACTABLES.find((x) => x.id === near) : null;

  return (
    <MotionConfig reducedMotion="user">
    <div className="absolute inset-0 font-cozy select-none">
      <Canvas
        shadows={quality === 'high'}
        flat
        dpr={[1, quality === 'high' ? 1.75 : 1.25]}
        camera={{ fov: 50, position: [30, 17, 30], near: 0.1, far: 900 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ touchAction: 'none' }}
      >
        <Scene store={store} events={events} quality={quality} onWalkTo={walkTo} weather={weather} reduceMotion={reduceMotion} />
      </Canvas>
      <LabelsOverlay />

      {/* Crawlable summary for search engines and screen readers. */}
      <div className="sr-only">
        <h1>Daniel Eduardo — Ingeniero en Informática</h1>
        <p>Portafolio interactivo: una isla 3D para explorar. Desarrollo web full stack, IoT y soluciones a medida.</p>
        <a href="/clasico">Versión clásica del portafolio</a> · <a href="/proyectos">Proyectos</a> · <a href="/sobre-mi">Sobre mí</a>
      </div>

      <AnimatePresence>{!started && <StartScreen onStart={start} onClassic={() => navigate('/clasico')} coarse={coarse} />}</AnimatePresence>

      {started && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 md:p-4">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 md:gap-2">
              <span className="hidden md:inline-flex rounded-full bg-[#fff8e7]/95 px-4 py-2 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)]">
                🏝️ Isla de Daniel Eduardo
              </span>
              <Stat>⭐ {stars}/{STAR_COUNT}</Stat>
              <Stat>✂️ {cut}</Stat>
              <Stat title="Logros" className="hidden sm:inline-flex">
                🏆 {unlocked.length}/{Object.keys(ACHIEVEMENTS).length}
              </Stat>
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5 md:gap-2">
              <IconButton label="Clima" active={sheet === 'weather'} onClick={() => setSheet((v) => (v === 'weather' ? null : 'weather'))}>
                {WEATHERS.find((w) => w.id === weather)?.emoji}
              </IconButton>
              <IconButton label="Sonidos ambiente" active={sheet === 'sound'} onClick={() => setSheet((v) => (v === 'sound' ? null : 'sound'))}>
                🎧
              </IconButton>
              <IconButton label={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute} className="hidden md:grid">
                {muted ? '🔇' : '🔊'}
              </IconButton>
              <IconButton label="Ayuda" onClick={() => openDialog('welcome')}>
                ❔
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

          <nav
            aria-label="Ir a"
            className="absolute z-20 left-1/2 -translate-x-1/2 top-[60px] md:top-auto md:bottom-4 flex gap-1.5 md:gap-2 max-w-[calc(100%-24px)] overflow-x-auto no-scrollbar px-1 py-1"
          >
            {TRAVEL.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => walkTo(t.id)}
                className="shrink-0 rounded-full bg-[#7ccf8a] px-3.5 md:px-4 py-2 text-[13px] md:text-sm font-extrabold text-[#1d4a26] shadow-[0_3px_0_#4f9c5d] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_#4f9c5d] transition-transform"
              >
                <span className="mr-1">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </nav>

          {!coarse && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden lg:block rounded-2xl bg-[#fff8e7]/85 px-4 py-3 text-xs font-bold leading-relaxed text-[#6b4f3a]">
              <Kbd>WASD</Kbd> caminar · <Kbd>Shift</Kbd> correr
              <br />
              <Kbd>Espacio</Kbd> cortar pasto · <Kbd>E</Kbd> interactuar
              <br />
              <span className="opacity-70">o haz clic en el suelo para caminar</span>
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
                className="absolute z-20 left-1/2 -translate-x-1/2 bottom-[150px] md:bottom-20 rounded-full bg-[#fff8e7] px-5 py-2.5 text-sm md:text-base font-extrabold text-[#6b4f3a] shadow-[0_4px_0_rgba(91,70,54,0.25)]"
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
                aria-label="Cortar pasto"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  store.cutHeld = true;
                }}
                onPointerUp={() => (store.cutHeld = false)}
                onPointerCancel={() => (store.cutHeld = false)}
                className="absolute z-20 bottom-8 right-6 grid h-20 w-20 place-items-center rounded-full bg-[#fff8e7] text-3xl shadow-[0_5px_0_rgba(91,70,54,0.25)] active:translate-y-1 active:shadow-[0_1px_0_rgba(91,70,54,0.25)]"
                style={{ touchAction: 'none' }}
              >
                ✂️
              </button>
            </>
          )}

          <div className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-[110px] md:top-20 flex w-[min(360px,calc(100%-24px))] flex-col items-center gap-2">
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
                  <span className="text-2xl">{t.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-black leading-tight">{t.title}</div>
                    <div className="text-xs font-bold opacity-75 leading-snug">{t.text}</div>
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
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel && (
          <PanelShell
            key={panel}
            title={panel === 'projects' ? '📌 Proyectos de Daniel' : '🌻 Huerto de habilidades'}
            onClose={() => {
              setPanel(null);
              sfx.close();
            }}
          >
            {panel === 'projects' ? <ProjectsPanel /> : <SkillsPanel />}
          </PanelShell>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {started && sheet && (
          <motion.aside
            key={sheet}
            role="dialog"
            aria-label={sheet === 'weather' ? 'Elegir clima' : 'Sonidos ambiente'}
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="absolute right-3 top-[112px] md:right-4 md:top-[68px] z-30 w-[min(340px,calc(100%-24px))] max-h-[calc(100svh-190px)] md:max-h-[calc(100svh-150px)] overflow-y-auto rounded-[1.75rem] bg-[#fff8e7] p-4 text-[#5b4636] shadow-[0_6px_0_rgba(91,70,54,0.22),0_20px_50px_rgba(60,30,40,0.25)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black">{sheet === 'weather' ? '🌦️ Clima de la isla' : '🎧 Sonidos ambiente'}</h2>
              <button type="button" onClick={() => setSheet(null)} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full bg-[#f0e2c8] hover:bg-[#ead6b3]">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            {sheet === 'weather' ? (
              <WeatherPicker weather={weather} onChoose={chooseWeather} />
            ) : (
              <SoundMixer
                mix={mix}
                ambVol={ambVol}
                muted={muted}
                onChannel={changeChannel}
                onVolume={changeAmbVol}
                onPreset={applyMix}
                onWeatherPreset={() => applyMix(WEATHER_CONFIG[weather].mix)}
                onToggleMute={toggleMute}
              />
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
      <p className="mt-3 text-xs font-bold opacity-80">El clima también cambia los sonidos. Puedes ajustarlos en 🎧.</p>
    </>
  );
}

type SoundMixerProps = {
  mix: Record<AmbientId, number>;
  ambVol: number;
  muted: boolean;
  onChannel: (id: AmbientId, v: number) => void;
  onVolume: (v: number) => void;
  onPreset: (m: Mix) => void;
  onWeatherPreset: () => void;
  onToggleMute: () => void;
};

function SoundMixer({ mix, ambVol, muted, onChannel, onVolume, onPreset, onWeatherPreset, onToggleMute }: SoundMixerProps) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onWeatherPreset} className="rounded-full bg-[#7ccf8a] px-3 py-1.5 text-xs font-black text-[#1d4a26] shadow-[0_2px_0_#4f9c5d]">
          🌦️ Del clima
        </button>
        {SOUND_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onPreset(p.mix)} className="rounded-full bg-white px-3 py-1.5 text-xs font-black hover:bg-[#fbf1dc]">
            {p.emoji} {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#f6ecd9] px-3 py-2.5">
        <button type="button" onClick={onToggleMute} aria-label={muted ? 'Activar sonido' : 'Silenciar todo'} className="text-xl">
          {muted ? '🔇' : '🔊'}
        </button>
        <label className="flex-1">
          <span className="sr-only">Volumen general</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={ambVol}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="cozy-range w-full"
          />
        </label>
      </div>

      <ul className="mt-3 space-y-1.5">
        {AMBIENTS.map((a) => {
          const v = mix[a.id];
          const on = v > 0.001;
          return (
            <li key={a.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors ${on ? 'bg-white' : 'bg-transparent'}`}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${on ? 'Apagar' : 'Encender'} ${a.label}`}
                onClick={() => onChannel(a.id, on ? 0 : 0.5)}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl transition-all ${on ? 'bg-[#f0a45d] shadow-[0_2px_0_#c97d3c]' : 'bg-[#f0e2c8] grayscale-[60%]'}`}
              >
                {a.emoji}
              </button>
              <label className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold leading-tight">{a.label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={v}
                  onChange={(e) => onChannel(a.id, Number(e.target.value))}
                  className="cozy-range mt-1 w-full"
                />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] font-bold opacity-80">Todos los sonidos se generan en vivo en tu navegador. Siguen sonando mientras exploras.</p>
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
  active = false,
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
        <p className="mt-3 text-[15px] font-bold leading-snug opacity-80">
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
        <p className="mt-4 text-xs font-bold opacity-80">
          {coarse ? 'Usa el joystick para caminar y ✂️ para cortar el pasto.' : 'WASD para caminar · Espacio para cortar el pasto · E para hablar'}
        </p>
        <button type="button" onClick={onClassic} className="mt-5 text-sm font-extrabold underline decoration-2 underline-offset-4 opacity-70 hover:opacity-100">
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
};

function DialogBox({ dialog, text, fullText, lineDone, showChoices, choiceIdx, setChoiceIdx, onAdvance }: DialogBoxProps) {
  const list = useRef<HTMLUListElement>(null);
  // Keep keyboard focus on the highlighted choice so Enter/Space pick it.
  useEffect(() => {
    if (showChoices) list.current?.querySelectorAll('button')[choiceIdx]?.focus({ preventScroll: true });
  }, [showChoices, choiceIdx]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="absolute inset-x-0 bottom-3 md:bottom-6 z-40 mx-auto w-[min(680px,calc(100%-24px))]"
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
        role="dialog"
        aria-label={dialog.speaker}
        onClick={onAdvance}
        className="relative cursor-pointer rounded-[2rem] bg-[#fff8e7] px-6 pb-7 pt-8 md:px-9 md:pt-9 text-[#5b4636] shadow-[0_6px_0_rgba(91,70,54,0.22),0_20px_50px_rgba(60,30,40,0.25)]"
      >
        <span className="absolute -top-4 left-6 -rotate-3 rounded-full bg-[#f0a45d] px-5 py-1.5 text-base font-black text-[#3d2410] shadow-[0_3px_0_#c97d3c]">
          {dialog.speaker}
        </span>
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
        <div className="overflow-y-auto p-4 md:p-6">{children}</div>
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
  const move = (e: ReactPointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
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
      className="absolute z-20 bottom-8 left-6 h-32 w-32 rounded-full bg-[#fff8e7]/55 shadow-[inset_0_2px_8px_rgba(91,70,54,0.25)]"
      style={{ touchAction: 'none' }}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-[#fff8e7] shadow-[0_4px_0_rgba(91,70,54,0.25)]"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}
