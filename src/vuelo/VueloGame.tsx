import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { initAudio, jingleIntro, jingleStart, pauseAudio, setMusicMood, setMusicVolume, setMuted as setAudioMuted, menu } from '../game/audio';
import { cargarSonidos } from './sonido';
import * as AD from './armas-dibujo';
import { PLANES, createVuelo, dibujo, readSave, type Hud, type Mejorable, type Result, type SavedGame, type Vuelo } from './motor';
import type { BombaTipo, ModeloBase as ModeloAvion, ModeloAvion as Avion } from './fisica-tipos';
import * as HG from './hangar';
import * as AB from './audio-batalla';
import { FPS, FRAMES, fondoTarjeta, retrato, type Pose } from './retratos';

/*
 * "Escuadrón Dui": the plane game around the canvas engine in motor.ts. This
 * file only does the intro, the title screen, the credits, the hangar, the
 * HUD, the pause and the touch controls.
 */

/** intro → titulo (title menu over a self-playing game) → menu (hangar) → play → over. */
type Phase = 'intro' | 'titulo' | 'creditos' | 'menu' | 'play' | 'over';

const AUTOR = 'Daniel Aguilera Campusano';
/** The four upgrades bought with ⭐ between waves. */
const MEJORAS: { k: Mejorable; icono: string; nombre: string; efecto: string }[] = [
  { k: 'dano', icono: '💥', nombre: 'Daño', efecto: '+15 % por nivel' },
  { k: 'salud', icono: '❤️', nombre: 'Salud', efecto: '+1 coraza por oleada' },
  { k: 'defensa', icono: '🛡️', nombre: 'Defensa', efecto: '+10 % de desviar' },
  { k: 'municion', icono: '🚀', nombre: 'Munición', efecto: '+1 puesto de cada arma' },
];
/** Every role in the credits, all of them by the author. */
const ROLES = [
  'Dirección del juego', 'Idea original', 'Diseño de juego', 'Guion y personajes', 'Programación', 'Motor del juego',
  'Física de vuelo', 'Física de misiles y explosiones', 'Inteligencia artificial de los ratones', 'Cazas ratón y jefes',
  'Diseño de niveles: el valle y el océano', 'Arte pixel', 'Diseño de personajes', 'Animación', 'Fondos y escenarios',
  'Efectos visuales, luces y sombras', 'Interfaz y menús', 'Diseño de sonido', 'Música original (chiptune)',
  'Controles táctiles', 'Investigación de experiencia de juego', 'Balance y dificultad', 'Accesibilidad',
  'Pruebas y control de calidad', 'Producción', 'Sitio web danieleduardo.cl',
];
const ELENCO = [
  ['Dui', 'el gato naranja, piloto del Caza Mandarina'],
  ['Lulu', 'la gatita negra de ojos amarillos, Avioneta Mostaza'],
  ['Almendrita', 'la yorkshire, Bombardero Nube'],
  ['Vecina Margarita', 'ella misma (y su portaaviones)'],
  ['Los ratones', 'muchos, muchísimos ratones'],
];
/** CC0 sound recordings (no attribution required; thanked anyway). */
const SONIDOS_CC0 = ['modusmogulus', 'craigsmith', 'qubodup', 'unfa', 'josecruz98', 'Alxy', 'Anthousai', 'Rocotilos'];

const CHIP = 'inline-flex h-8 [@media(min-height:500px)]:h-10 items-center gap-1 rounded-full bg-[#fff8e7]/95 px-2.5 [@media(min-height:500px)]:px-3 text-xs [@media(min-height:500px)]:text-sm whitespace-nowrap font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] tabular-nums';
/** The phone HUD: the same chips, small, in one tight row so the sky stays clear. */
const CHIP_M = 'inline-flex h-6 items-center gap-0.5 rounded-full bg-[#fff8e7]/90 px-1.5 text-[10px] whitespace-nowrap font-black text-[#6b4f3a] shadow-[0_2px_0_rgba(91,70,54,0.2)] tabular-nums';
const BTN = 'whitespace-nowrap rounded-full bg-[#fff8e7]/95 px-3 md:px-4 h-8 [@media(min-height:500px)]:h-10 text-xs md:text-sm font-extrabold text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] hover:-translate-y-0.5 transition-transform';
const GO = 'rounded-full bg-[#7ccf8a] px-6 py-3 text-base font-black text-[#1d4a26] shadow-[0_4px_0_#4f9c5d] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_#4f9c5d] transition-transform';

function readMuted() {
  try {
    return localStorage.getItem('vuelo-silencio') === '1';
  } catch {
    return false;
  }
}

function Pips({ n, max, on, off }: { n: number; max: number; on: string; off: string }) {
  return (
    <span aria-hidden className="tracking-tight">
      {Array.from({ length: max }, (_, i) => (i < n ? on : off)).join('')}
    </span>
  );
}

/*
 * Tiny pixel-art icons for the weapons chip, so it matches the game instead of
 * the system's emoji. Each letter is a colour; '.' is transparent.
 */
const ICON_COL: Record<string, string> = { k: '#3a2a6a', w: '#fff8e7', r: '#ff4a5a', o: '#ff9a3c', y: '#ffd84a', g: '#8a8aa8', b: '#2a2438' };
const ICONS = {
  misil: ['.k.......', 'krkkkkkk.', 'orgggggwk', 'krkkkkkk.', '.k.......'],
  bomba: ['..bbbb.k.', '.bbwbbbk.', 'bbbbbbbkk', '.bbbbbbk.', '..bbbb.k.'],
  bengala: ['....o....', '..oyyyo..', 'ooywwwyoo', '..oyyyo..', '....o....'],
} as const;
type Icono = keyof typeof ICONS;
const iconUrls = new Map<Icono, string>();
function iconUrl(n: Icono) {
  let u = iconUrls.get(n);
  if (!u) {
    const rows = ICONS[n];
    const c = document.createElement('canvas');
    c.width = rows[0].length;
    c.height = rows.length;
    const g = c.getContext('2d')!;
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        g.fillStyle = ICON_COL[ch];
        g.fillRect(x, y, 1, 1);
      }),
    );
    u = c.toDataURL();
    iconUrls.set(n, u);
  }
  return u;
}

/** One pixel icon per slot: full ones bright, empty ones faded. */
function Slots({ icon, n, max }: { icon: Icono; n: number; max: number }) {
  return (
    <span aria-hidden className="inline-flex items-center">
      {Array.from({ length: max }, (_, i) => (
        <img key={i} src={iconUrl(icon)} alt="" width={18} height={10} className={i < n ? '' : 'opacity-25 grayscale'} style={{ imageRendering: 'pixelated' }} />
      ))}
    </span>
  );
}

/** A big pilot portrait, animated at the pose's own pace (pixel art scaled with CSS). */
function Retrato({ m, pose, className }: { m: ModeloAvion; pose: Pose; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();
    const pinta = (now: number) => {
      const n = FRAMES[pose];
      let f = Math.floor(((now - t0) / 1000) * FPS[pose]);
      // «listo» plays once and holds its last frames; the others loop.
      f = pose === 'listo' ? Math.min(n - 1, f) : quieto ? 0 : f % n;
      const img = retrato(m, pose, f);
      if (c.width !== img.width) {
        c.width = img.width;
        c.height = img.height;
      }
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      raf = requestAnimationFrame(pinta);
    };
    raf = requestAnimationFrame(pinta);
    return () => cancelAnimationFrame(raf);
  }, [m, pose]);
  return <canvas ref={ref} className={className} style={{ imageRendering: 'pixelated' }} aria-hidden />;
}

/** The card's pixel backdrop in the pilot's colours. */
function FondoTarjeta({ m }: { m: ModeloAvion }) {
  const src = useMemo(() => fondoTarjeta(m, 120, 160).toDataURL(), [m]);
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ imageRendering: 'pixelated' }} />;
}

/** Hangar thumbnails per pilot, made once per session (toDataURL is slow on phones). */
const MINIS = new Map<ModeloAvion, Record<Avion, string>>();
function miniaturas(piloto: ModeloAvion) {
  let out = MINIS.get(piloto);
  if (!out) {
    // The pilot is global to the sprite painter: borrow it for the thumbnails and give it back.
    const antes = dibujo.pilotoActual();
    dibujo.fijarPiloto(piloto);
    out = {} as Record<Avion, string>;
    for (const a of HG.HANGAR) out[a.id] = dibujo.planeSprite(a.id).toDataURL();
    dibujo.fijarPiloto(antes);
    MINIS.set(piloto, out);
  }
  return out;
}

/**
 * The hangar: pick the plane (each with its real weapons) and the bomb load.
 * Locked ones show what unlocks them.
 */
function Hangar({ piloto, avion, bomba, libres, bombas, onAvion, onBomba, onClose }: {
  piloto: ModeloAvion; avion: Avion; bomba: BombaTipo; libres: Avion[]; bombas: BombaTipo[];
  onAvion: (a: Avion) => void; onBomba: (b: BombaTipo) => void; onClose: () => void;
}) {
  const sprites = useMemo(() => miniaturas(piloto), [piloto]);
  const bombaSprites = useMemo(() => {
    const out = {} as Record<BombaTipo, string>;
    for (const b of HG.TIPOS_BOMBA) {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 16;
      AD.drawBombaTipo(c.getContext('2d')!, b, 12, 8, 0);
      out[b] = c.toDataURL();
    }
    return out;
  }, []);
  const dialogo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Give the focus back to whatever opened the hangar when it closes.
    const antes = document.activeElement as HTMLElement | null;
    return () => {
      if (antes && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    // The hangar owns the keyboard while open: Esc closes it, nothing reaches the game or the select.
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab' && e.type === 'keydown') {
        // Keep Tab inside the hangar.
        const bs = [...(dialogo.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        if (bs.length) {
          const i = bs.indexOf(document.activeElement as HTMLElement);
          const sig = e.shiftKey ? (i <= 0 ? bs.length - 1 : i - 1) : i < 0 || i >= bs.length - 1 ? 0 : i + 1;
          e.preventDefault();
          bs[sig].focus();
        }
        e.stopImmediatePropagation();
        return;
      }
      if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space') return;
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && (e.code === 'Escape' || e.code === 'KeyP')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const sel = HG.especDe(avion);
  return (
    <div
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-label="Hangar"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="pointer-events-auto absolute inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#120c24]/80 p-3 pt-16 [@media(max-height:500px)]:p-1.5 [@media(max-height:500px)]:pt-12"
    >
      <div className="w-full max-w-4xl rounded-[1.6rem] bg-[#fff8e7] p-3 text-[#6b4f3a] ring-4 ring-[#ead6b3] [@media(max-height:500px)]:p-2">
        <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-[1.6rem] bg-[#fff8e7] px-3 pb-1 pt-3 [@media(max-height:500px)]:-top-1.5 [@media(max-height:500px)]:-mx-2 [@media(max-height:500px)]:-mt-2 [@media(max-height:500px)]:px-2 [@media(max-height:500px)]:pt-2">
          <h2 className="logo-dui text-2xl font-black sm:text-3xl">🛩️ HANGAR</h2>
          <button type="button" autoFocus onClick={onClose} className={GO + ' py-2 text-sm'}>Listo ✓</button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7 [@media(max-height:500px)]:grid-cols-7 [@media(max-height:500px)]:gap-1">
          {HG.HANGAR.map((a) => {
            const libre = libres.includes(a.id);
            const elegido = a.id === avion;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  if (!libre) return AB.hangarBloqueado();
                  AB.hangarSel();
                  onAvion(a.id);
                }}
                aria-pressed={elegido}
                aria-disabled={!libre}
                aria-label={`${a.real ?? a.name}${libre ? '' : `, bloqueado: ${a.desbloqueo?.texto}`}`}
                className={`relative rounded-xl p-1.5 text-center transition-transform [@media(max-height:500px)]:p-1 ${elegido ? 'bg-[#3a2a6a] text-white ring-4 ring-[#ffd84a]' : libre ? 'bg-white/80 hover:-translate-y-0.5' : 'bg-[#e6d6bd]/60 text-[#7a5c40]'}`}
              >
                <img src={sprites[a.id]} alt="" className={`mx-auto h-10 w-auto [@media(max-height:500px)]:h-7 ${libre ? '' : 'opacity-40 grayscale'}`} style={{ imageRendering: 'pixelated' }} />
                <div className="text-xs font-black leading-tight [@media(max-height:500px)]:text-[10px]">{a.real ?? a.name}</div>
                {libre ? (
                  <div className="text-[10px] font-bold opacity-80 [@media(max-height:500px)]:hidden">{TIPO_AVION[a.id]}</div>
                ) : (
                  <div className="text-[10px] font-black">🔒 {HG.corto(a.desbloqueo)}</div>
                )}
              </button>
            );
          })}
        </div>
        {/* The chosen plane's numbers and weapons. */}
        <div className="mt-2 grid gap-2 rounded-2xl bg-white/70 p-2 text-left sm:grid-cols-2">
          <div>
            <p className="text-sm font-black">{sel.real ?? sel.name} <span className="font-bold text-[#a08060]">· {sel.blurb}</span></p>
            <dl className="mt-1 grid grid-cols-4 gap-1 text-center text-xs font-bold">
              <div><dt className="text-[10px] text-[#a08060]">Velocidad</dt><dd><Stars n={sel.stats.velocidad} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Blindaje</dt><dd><Stars n={sel.stats.blindaje} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Misiles</dt><dd><Stars n={sel.stats.misiles} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Bombas</dt><dd><Stars n={sel.stats.bombas} /></dd></div>
            </dl>
          </div>
          <ul className="text-xs font-bold leading-snug">
            <li>🚀 {sel.kit.misil.nombre} ×{sel.rack}</li>
            <li>🔫 {sel.kit.metralla ? sel.kit.metralla.nombre : 'Sin metralla'}</li>
            <li>✨ {sel.kit.bengala.nombre} ×{sel.flareRack}</li>
            <li>💣 Bodega: {sel.bombRack} {sel.bombs > 1 ? `(suelta ${sel.bombs} a la vez)` : ''}{sel.sigilo > 0 ? ' · 👻 furtivo' : ''}</li>
          </ul>
        </div>
        <p className="mt-2 text-sm font-black">💣 Bombas</p>
        <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {HG.TIPOS_BOMBA.map((b) => {
            const info = HG.BOMBAS[b];
            const libre = bombas.includes(b);
            const elegida = b === bomba;
            if (info.soloOvni && avion !== 'ovni') return null;
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  if (!libre) return AB.hangarBloqueado();
                  AB.hangarSel();
                  onBomba(b);
                }}
                aria-pressed={elegida}
                aria-disabled={!libre}
                aria-label={`${info.nombre}${libre ? '' : `, bloqueada: ${info.desbloqueo?.texto ?? ''}`}`}
                className={`rounded-xl p-1.5 text-left transition-transform ${elegida ? 'bg-[#3a2a6a] text-white ring-4 ring-[#ffd84a]' : libre ? 'bg-white/80 hover:-translate-y-0.5' : 'bg-[#e6d6bd]/60 text-[#7a5c40]'}`}
              >
                <div className="flex items-center gap-1">
                  <img src={bombaSprites[b]} alt="" className={`h-5 w-auto ${libre ? '' : 'opacity-40 grayscale'}`} style={{ imageRendering: 'pixelated' }} />
                  <span className="text-xs font-black">{info.nombre}</span>
                </div>
                {libre ? <div className="text-[10px] font-bold opacity-80">{info.texto}</div> : <div className="text-[10px] font-black">🔒 {HG.corto(info.desbloqueo)}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A one-line kind for each plane, under its name in the hangar. */
const TIPO_AVION: Record<Avion, string> = {
  avioneta: 'De la casa', caza: 'De la casa', bombardero: 'De la casa',
  raptor: 'Caza furtivo', sukhoi: 'Caza supermaniobrable', b2: 'Bombardero furtivo', ovni: 'De otro mundo',
  tomcat: 'Caza de portaaviones', a10: 'Ataque a tierra', spitfire: 'Caza clásico de hélice',
};

/** The mice's radio: a little transmission card, the line typing itself out. */
function Radio({ quien, texto, top }: { quien: string; texto: string; top: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = window.setInterval(() => setN((k) => (k >= texto.length ? k : k + 1)), 28);
    return () => window.clearInterval(id);
  }, [texto]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute left-3 z-20 max-w-[min(22rem,70vw)] animate-[aparece_0.2s_ease-out]" style={{ top: top + 6 }}>
      <div className="flex items-start gap-2 rounded-xl bg-[#1a1438]/85 px-2.5 py-1.5 text-white shadow-[0_3px_0_rgba(0,0,0,0.25)] ring-2 ring-[#7af0a0]/60">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2a2458] text-base ring-1 ring-[#7af0a0]/50" aria-hidden>🐭</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-[#7af0a0]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#7af0a0]" aria-hidden />📻 {quien}
          </div>
          <div className="text-xs font-bold leading-snug">
            {texto.slice(0, n)}
            <span className="sr-only">{texto.slice(n)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span role="img" aria-label={`${n} de 5`} className="tracking-tight text-[#f0a45d]">
      {'★'.repeat(n)}
      <span className="text-[#e6d6bd]">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export default function VueloGame({ navigate }: { navigate: (to: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<Vuelo | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  // Intro beats: 0 «presenta» (waits for a key), 1 pilots, 2 logo slam, 3 «press start».
  const [introStep, setIntroStep] = useState(0);
  const [saved, setSaved] = useState<SavedGame | null>(readSave);
  const [plane, setPlane] = useState<ModeloAvion>(() => readSave()?.pilot ?? 'caza');
  const [hud, setHud] = useState<Hud | null>(null);
  // «Seguir» gets the focus without scrolling the wave card (autoFocus would jump it to the bottom).
  const seguirRef = useRef<HTMLButtonElement>(null);
  // The top bar's real height (its chips wrap on phones), so the boss bar and banners sit under it.
  const barraRef = useRef<HTMLDivElement>(null);
  const [barraH, setBarraH] = useState(64);
  useEffect(() => {
    const el = barraRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarraH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The hangar: open or not, and the plane/bomb picked before take-off (null = the pilot's own plane).
  const [hangar, setHangar] = useState(false);
  const [avion, setAvion] = useState<Avion | null>(null);
  const [bomba, setBomba] = useState<BombaTipo | null>(null);
  const cerrarHangar = useCallback(() => setHangar(false), []);
  // Mid-game the hangar stops the world: no engine, wind or battle sound behind it.
  useEffect(() => {
    if (phase !== 'play' || !hangar) return;
    game.current?.setPaused(true);
    return () => game.current?.setPaused(false);
  }, [phase, hangar]);
  const [result, setResult] = useState<Result | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) setHangar(false);
  }, [paused]);
  const tiendaAbierta = phase === 'play' && !!hud?.mejoras.tienda && !!hud?.resumen;
  useEffect(() => {
    if (tiendaAbierta) seguirRef.current?.focus({ preventScroll: true });
  }, [tiendaAbierta]);
  const [muted, setMuted] = useState(readMuted);
  const [touchUi, setTouchUi] = useState(false);
  const [portrait, setPortrait] = useState(false);
  // Phones get their own layout: compact HUD, small translucent buttons, extras in the pause menu.
  const movil = touchUi && (phase === 'play' || phase === 'over');
  const chip = movil ? CHIP_M : CHIP;
  const [verticalOk, setVerticalOk] = useState(false);

  useEffect(() => {
    const g = createVuelo(canvasRef.current!, boxRef.current!, {
      onHud: setHud,
      onOver: (r) => {
        setResult(r);
        setSaved(readSave());
        setPhase('over');
      },
    });
    game.current = g;
    // The title screen's background: a game flown by the autopilot.
    g.attract();
    return () => {
      g.destroy();
      game.current = null;
      pauseAudio();
      setMusicMood('alegre');
    };
  }, []);

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const tall = window.matchMedia('(orientation: portrait)');
    const update = () => {
      setTouchUi(coarse.matches);
      game.current?.setTouch(coarse.matches);
      setPortrait(tall.matches && coarse.matches);
    };
    update();
    coarse.addEventListener('change', update);
    tall.addEventListener('change', update);
    return () => {
      coarse.removeEventListener('change', update);
      tall.removeEventListener('change', update);
    };
  }, []);

  const thumbs = useMemo(() => {
    const out = {} as Record<ModeloAvion, { plane: string; pilot: string }>;
    for (const p of PLANES) out[p.id] = { plane: dibujo.planeSprite(p.id).toDataURL(), pilot: dibujo.pilotPortrait(p.id).toDataURL() };
    return out;
  }, []);
  // The mice for the intro: a jeep, a frigate and Margarita on her cart.
  const ratones = useMemo(() => (['jeep', 'fragata', 'margarita'] as const).map((k) => dibujo.vehicleSprite(k, 0).toDataURL()), []);

  /** Title music on, at its normal level (the game itself has none). */
  const tituloMusica = useCallback(() => {
    initAudio(muted);
    setMusicVolume(1);
    setMusicMood('titulo');
  }, [muted]);

  // The intro: the first key/tap starts the music and the show; the next skips to «press start».
  const advanceIntro = useCallback(() => {
    if (introStep === 0) {
      tituloMusica();
      jingleIntro();
      setIntroStep(1);
    } else if (introStep < 3) setIntroStep(3);
    else {
      jingleStart();
      setPhase('titulo');
    }
  }, [introStep, tituloMusica]);
  useEffect(() => {
    if (phase !== 'intro' || introStep === 0 || introStep >= 3) return;
    const id = window.setTimeout(() => {
      menu.paso();
      setIntroStep((n) => Math.min(3, n + 1));
    }, introStep === 1 ? 2300 : 1300);
    return () => window.clearTimeout(id);
  }, [phase, introStep]);
  useEffect(() => {
    if (phase !== 'intro') return;
    const onKey = (e: KeyboardEvent) => {
      // Tab and shortcuts (reload, devtools…) are left alone.
      if (e.repeat || e.code === 'Tab' || e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
      e.preventDefault();
      advanceIntro();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, advanceIntro]);

  const play = useCallback((resume = false) => {
    // No background music here: only the engines and the effects.
    setMusicVolume(0);
    initAudio(muted);
    cargarSonidos();
    // Once the audio has woken up, bake the battle sounds in idle time.
    window.setTimeout(() => AB.precalentar(), 800);
    menu.despegar();
    setResult(null);
    setPaused(false);
    game.current?.setPaused(false);
    const from = resume ? readSave() : null;
    if (from) setPlane(from.pilot);
    game.current?.start(from ? from.pilot : plane, from, false, avion ?? undefined, bomba ?? undefined);
    setSaved(null);
    setPhase('play');
  }, [muted, plane, avion, bomba]);

  // Character select: who is confirmed (playing their pose) before take-off.
  const [confirmado, setConfirmado] = useState<ModeloAvion | null>(null);
  const elegir = useCallback((m: ModeloAvion) => {
    setPlane(m);
    setAvion(null);
    setBomba(null);
    menu.aceptar();
  }, []);
  // The game-over buttons wake up after a moment, so a held fire key can't skip the card.
  const [overListo, setOverListo] = useState(false);
  useEffect(() => {
    if (phase !== 'over') return setOverListo(false);
    const id = window.setTimeout(() => setOverListo(true), 800);
    return () => window.clearTimeout(id);
  }, [phase]);
  const confirmTimer = useRef(0);
  const confirmando = useRef(false);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);
  const confirmar = useCallback(() => {
    if (confirmado || confirmando.current) return;
    confirmando.current = true;
    setConfirmado(plane);
    jingleStart();
    confirmTimer.current = window.setTimeout(() => {
      confirmando.current = false;
      setConfirmado(null);
      play();
    }, 1300);
  }, [confirmado, plane, play]);
  useEffect(() => {
    if (phase !== 'menu') return;
    const onKey = (e: KeyboardEvent) => {
      if (confirmado) return;
      const i = PLANES.findIndex((p) => p.id === plane);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') elegir(PLANES[(i + PLANES.length - 1) % PLANES.length].id);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') elegir(PLANES[(i + 1) % PLANES.length].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, plane, confirmado, elegir]);

  // «Menos movimiento», remembered on this device.
  const [calma, setCalma] = useState(() => {
    // The system's «reduce motion» turns it on unless the player chose otherwise.
    try {
      const v = localStorage.getItem('vuelo-calma');
      if (v !== null) return v === '1';
    } catch {
      /* private mode */
    }
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  });
  const toggleCalma = (on: boolean) => {
    setCalma(on);
    game.current?.setCalma(on);
    try {
      localStorage.setItem('vuelo-calma', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    game.current?.setCalma(calma);
  }, [calma]);

  const togglePause = useCallback(() => {
    if (phase !== 'play') return;
    setPaused((p) => {
      game.current?.setPaused(!p);
      menu.pausa(!p);
      return !p;
    });
    // Fingers held when pausing are forgotten (the touch layer unmounts and never hears them lift).
    fingers.current.clear();
    setTurning(0);
  }, [phase]);

  /** Back to the hangar to pick another plane (the self-playing game keeps flying behind). */
  const toHangar = useCallback(() => {
    setHangar(false);
    game.current?.attract();
    game.current?.setPaused(false);
    setPaused(false);
    setSaved(readSave());
    tituloMusica();
    setPhase('menu');
  }, [tituloMusica]);

  const toMenu = useCallback(() => {
    setHangar(false);
    game.current?.attract();
    game.current?.setPaused(false);
    setPaused(false);
    setSaved(readSave());
    tituloMusica();
    setPhase('titulo');
  }, [tituloMusica]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      setAudioMuted(next);
      try {
        localStorage.setItem('vuelo-silencio', next ? '1' : '0');
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  // Esc / P pause; a hidden tab pauses too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
      // Esc goes back from the credits and the hangar (Enter uses the focused button everywhere).
      if (e.code === 'Escape' && (phase === 'creditos' || (phase === 'menu' && !confirmado))) setPhase('titulo');
    };
    const onHide = () => {
      if (document.hidden && phase === 'play' && !paused) togglePause();
      // Menus and cards: the title music stops with the tab hidden (a throttled
      // background timer would only stutter it) and comes back on return.
      else if (phase !== 'play' && phase !== 'intro') {
        if (document.hidden) pauseAudio();
        else initAudio(muted);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [togglePause, play, phase, paused, confirmado, muted]);

  /*
   * Touch: no sliding. Hold the left half of the screen to turn the nose
   * counterclockwise, the right half clockwise (flying left: left dives,
   * right climbs). A quick double tap fires the super nitro.
   */
  const fingers = useRef(new Map<number, 1 | -1>());
  const lastTap = useRef({ t: -1e9, side: 0 });
  const [turning, setTurning] = useState(0);
  // The hint goes away once the player has turned a couple of times.
  const [turns, setTurns] = useState(0);
  const applyTurn = () => {
    let l = false, r = false;
    for (const side of fingers.current.values()) {
      if (side === 1) l = true;
      else r = true;
    }
    const dir = l === r ? 0 : l ? 1 : -1;
    game.current?.steer(dir);
    setTurning(dir);
    if (dir) setTurns((n) => n + 1);
  };
  const onSkyDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const side: 1 | -1 = e.clientX - box.left < box.width / 2 ? 1 : -1;
    const now = performance.now();
    if (now - lastTap.current.t < 320 && lastTap.current.side === side) {
      game.current?.nitro();
      lastTap.current = { t: -1e9, side: 0 };
    } else lastTap.current = { t: now, side };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that already ended */
    }
    fingers.current.set(e.pointerId, side);
    applyTurn();
  };
  const onSkyUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.delete(e.pointerId)) return;
    applyTurn();
  };
  const throttle = (v: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that already ended */
      }
      game.current?.touch({ gas: v });
    },
    onPointerUp: () => game.current?.touch({ gas: 0 }),
    onPointerCancel: () => game.current?.touch({ gas: 0 }),
  });
  const [showKeys, setShowKeys] = useState(() => {
    try {
      return localStorage.getItem('vuelo-controles') !== '0';
    } catch {
      return true;
    }
  });
  // The keys panel folds away once missile, bomb and flares have all been
  // tried (or after a long while), so it doesn't hide the road for good.
  const [keysFolded, setKeysFolded] = useState(false);
  useEffect(() => {
    if (phase !== 'play' || keysFolded) return;
    const used = new Set<string>();
    let fold = 0;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'j') used.add('misil');
      else if (k === 'k') used.add('bomba');
      else if (k === 'l') used.add('bengala');
      if (used.size === 3 && !fold) fold = window.setTimeout(() => setKeysFolded(true), 4000);
    };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => setKeysFolded(true), 45000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      window.clearTimeout(fold);
    };
  }, [phase, keysFolded]);
  const toggleKeys = () =>
    setShowKeys((v) => {
      try {
        localStorage.setItem('vuelo-controles', v ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !v;
    });
  const hold = (key: 'fire' | 'bomb' | 'flare' | 'gun' | 'nuke' | 'tonel') => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that already ended */
      }
      game.current?.touch({ [key]: true });
    },
    onPointerUp: () => game.current?.touch({ [key]: false }),
    onPointerCancel: () => game.current?.touch({ [key]: false }),
  });

  // A sign when the plane crosses into a new layer of sky.
  const [zoneSign, setZoneSign] = useState('');
  const lastZone = useRef('');
  const zone = phase === 'play' ? hud?.zone ?? '' : '';
  useEffect(() => {
    const first = !lastZone.current;
    lastZone.current = zone;
    if (!zone || first) return;
    setZoneSign(zone);
    const id = window.setTimeout(() => setZoneSign(''), 2600);
    return () => window.clearTimeout(id);
  }, [zone]);

  const spec = PLANES.find((p) => p.id === plane)!;

  return (
    <div className="pixel-isla fixed inset-0 overflow-hidden select-none font-cozy text-[#5b4636] touch-none">
      <div ref={boxRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block" aria-label="Escuadrón Dui: juego de aviones" />
      </div>

      {/* Top bar: score on the left, the way out on the right. */}
      <div ref={barraRef} className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {phase === 'intro' || phase === 'titulo' || phase === 'creditos' ? null : phase === 'menu' ? (
            <span className={`${chip} px-4`}>✈️ Escuadrón Dui</span>
          ) : (
            hud && (
              <>
                <span className={chip} title="Aviones que te quedan" aria-label={`Aviones: ${hud.lives}`}>
                  ✈️ ×{hud.lives}
                </span>
                <span
                  className={`${chip} ${hud.lost.length ? 'ring-2 ring-[#ff4a5a]' : ''}`}
                  title={hud.lost.length ? `Dañado: ${hud.lost.join(', ')}` : 'Avión intacto'}
                  aria-label={`Blindaje: ${hud.hp} de ${hud.hpMax}${hud.lost.length ? `. Perdiste ${hud.lost.join(', ')}` : ''}`}
                >
                  <Pips n={hud.hp} max={hud.hpMax} on="🛡️" off="💥" />
                  <span className="ml-1 tabular-nums text-[10px] opacity-70">{hud.hp}/{hud.hpMax}</span>
                </span>
                <span className={`${chip} ${hud.stolen ? 'animate-pulse ring-4 ring-[#ff4a5a]' : ''}`} title="Pescado en la despensa" aria-label={`Despensa: ${hud.meta} de ${hud.metaMax}`}>
                  <Pips n={hud.meta} max={hud.metaMax} on="🐟" off="🦴" />
                </span>
                <span className={chip}>⭐ {hud.score}</span>
                {hud.mejoras.coraza > 0 && (
                  <span className={`${chip} text-[#c8507a]`} title="Coraza de la mejora «Salud»: cada una absorbe un golpe" aria-label={`Coraza: ${hud.mejoras.coraza}`}>
                    ❤️ ×{hud.mejoras.coraza}
                  </span>
                )}
                {hud.mision && !hud.resumen && !movil && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black shadow ${
                      hud.mision.hecha ? 'bg-[#c8f0c8] text-[#2f6a3a]' : hud.mision.fallida ? 'bg-[#ead6b3]/80 text-[#a08060] line-through' : 'bg-[#fff8e7]/90 text-[#6b4f3a]'
                    }`}
                  >
                    {hud.mision.hecha ? '🏅' : '🎯'} {hud.mision.texto}
                    {hud.mision.meta > 1 && !hud.mision.hecha ? ` (${hud.mision.prog}/${hud.mision.meta})` : ''}
                  </span>
                )}
                {hud.nukes > 0 && (
                  <span className={`${chip} bg-[#f4ffc0] text-[#4a5a1a]`} title="Bomba nuclear: tecla N o botón ☢️">
                    ☢️ ×{hud.nukes}
                  </span>
                )}
                {hud.boost && (
                  <span className={`${chip} animate-pulse bg-[#ffe0f0] text-[#c8507a]`} title="Mejora especial de un avión derribado">
                    ⭐ {hud.boost} · {hud.boostT} s
                  </span>
                )}
                <span className={chip}>🌊 {hud.wave} · 🐭 {hud.left}</span>
                <span className={chip} title="Altura">⛰️ {hud.altitude.toLocaleString('es-CL')} m</span>
                <span className={`${chip} max-[899px]:hidden`} title="Viento: empuja las bombas y el humo" aria-label={`Viento ${Math.abs(hud.wind)} hacia la ${hud.wind < 0 ? 'izquierda' : 'derecha'}`}>
                  🌬️ {hud.wind < 0 ? '◀'.repeat(Math.min(3, Math.ceil(-hud.wind / 4))) : hud.wind > 0 ? '▶'.repeat(Math.min(3, Math.ceil(hud.wind / 4))) : '·'}
                </span>
                <span
                  className={chip}
                  title="Armamento: atrapa los globos de los enemigos para ganar más puestos"
                  aria-label={`Misiles ${hud.ammo} de ${hud.rack}, bombas ${hud.bombs} de ${hud.bombMax}, bengalas ${hud.flares} de ${hud.flareMax}`}
                >
                  <Slots icon="misil" n={hud.ammo} max={hud.rack} />
                  <span className="mx-0.5 h-4 w-px bg-[#ead6b3]" />
                  <Slots icon="bomba" n={hud.bombs} max={hud.bombMax} />
                  <span className="mx-0.5 h-4 w-px bg-[#ead6b3]" />
                  <Slots icon="bengala" n={hud.flares} max={hud.flareMax} />
                  <span className="mx-0.5 h-4 w-px bg-[#ead6b3]" />
                  <span
                    title="Super nitro: aprieta acelerar dos veces seguidas"
                    className={`rounded-full px-1.5 text-[10px] font-black ${
                      hud.nitro === 'activo' ? 'animate-pulse bg-[#7ad8ff] text-[#1a3a6a]' : hud.nitro === 'listo' ? 'bg-[#ffe3a3] text-[#e8742a]' : 'bg-[#ead6b3] text-[#a08060]'
                    }`}
                  >
                    🔥{hud.nitro === 'carga' ? ` ${Math.round(hud.nitroK * 100)}%` : ''}
                  </span>
                  <span className="mx-0.5 h-4 w-px bg-[#ead6b3]" />
                  <span
                    className="relative h-2.5 w-8 overflow-hidden rounded-full bg-[#ead6b3]"
                    title="Metralla: si la mantienes mucho se calienta y debe enfriarse"
                  >
                    <span
                      className={`absolute inset-y-0 left-0 ${hud.hot ? 'animate-pulse bg-[#ff4a5a]' : hud.heat > 0.7 ? 'bg-[#ff9a3c]' : 'bg-[#7ccf8a]'}`}
                      style={{ width: `${Math.round((hud.hot ? 1 : hud.heat) * 100)}%` }}
                    />
                  </span>
                </span>
              </>
            )
          )}
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          {phase === 'play' && (
            <button type="button" aria-label={paused ? 'Seguir' : 'Pausa'} onClick={togglePause} className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}>
              {paused ? '▶️' : '⏸️'}
            </button>
          )}
          {phase === 'play' && hud && !movil && (
            <button
              type="button"
              aria-label={`Cielo: ${({ auto: 'automático', dia: 'día', tarde: 'tarde', noche: 'noche' } as Record<string, string>)[hud.sky]}. Cambiar`}
              title="Cambiar el cielo"
              onClick={() => game.current?.cycleSky()}
              className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}
            >
              {({ auto: '🌄', dia: '☀️', tarde: '🌅', noche: '🌙' } as Record<string, string>)[hud.sky]}
            </button>
          )}
          {phase === 'play' && hud && hud.zoom[0] > 1 && !movil && (
            <button type="button" aria-label={hud.zoom[1] === hud.zoom[0] - 1 ? 'Volver a acercar' : 'Alejar la cámara'} title="Zoom (Z)" onClick={() => game.current?.zoom()} className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}>
              {hud.zoom[1] ? '🔎' : '🔍'}
            </button>
          )}
          {!movil && (
            <>
              <button type="button" aria-label={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute} className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}>
                {muted ? '🔇' : '🔊'}
              </button>
              <button type="button" onClick={() => navigate('/')} className={`${BTN} hidden lg:block`}>
                🏝️ Isla
              </button>
              <button type="button" onClick={() => navigate('/clasico')} className={`${BTN} bg-[#ffe3a3] ring-2 ring-[#f0a45d]/60`}>
                <span className="lg:hidden">Clásica</span>
                <span className="hidden lg:inline">Versión clásica</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Wave banner and missile alarm. */}
      {phase === 'play' && hud?.banner && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 text-center ${hud.boss ? '' : movil ? 'top-[16%]' : 'top-[22%]'}`} style={hud.boss ? { top: barraH + 52 } : undefined}>
          <span className={`inline-block font-black text-[#6b4f3a] shadow-[0_5px_0_rgba(91,70,54,0.2)] ${movil ? 'rounded-2xl bg-[#fff8e7]/85 px-3 py-1 text-sm' : 'rounded-3xl bg-[#fff8e7]/95 px-6 py-3 text-2xl md:text-3xl'}`}>
            {hud.banner}
          </span>
        </div>
      )}
      {phase === 'play' && zoneSign && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-10 text-center">
          <span className="inline-block rounded-full bg-[#1d1544]/80 px-5 py-2 text-lg font-black tracking-wide text-[#fff6d0] shadow-[0_3px_0_rgba(0,0,0,0.25)] ring-2 ring-[#c8bcf4]">
            {zoneSign}
          </span>
        </div>
      )}
      {phase === 'play' && hud?.warn && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 text-center">
          <span className="inline-block animate-pulse rounded-full bg-[#ff4a5a] px-4 py-1.5 text-sm font-black text-white shadow-[0_3px_0_#a01a3a]">
            ⚠️ ¡Misil! Gira fuerte o suelta bengalas
          </span>
        </div>
      )}
      {phase === 'play' && hud?.pista && !hud.resumen && !paused && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4 ${hud.enTierra && touchUi ? 'top-[38%]' : 'bottom-28 [@media(max-height:500px)]:bottom-24'}`}>
          <span className={`rounded-full bg-[#3a2a6a]/75 px-4 py-1.5 text-center text-sm font-black text-white shadow ${touchUi ? 'max-w-[55%] rounded-2xl text-xs' : ''}`}>💡 {hud.pista}</span>
        </div>
      )}
      {phase === 'play' && hud?.resumen && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-[45] flex justify-center px-4 [@media(max-height:500px)]:top-2">
          <div className="w-full max-w-sm animate-[aparece_0.35s_ease-out] overflow-auto rounded-[1.6rem] bg-[#fff8e7]/95 p-4 text-center [@media(max-height:500px)]:pointer-events-auto [@media(max-height:500px)]:max-h-[calc(100dvh-1rem)] [@media(max-height:500px)]:p-2 shadow-[0_6px_0_rgba(91,70,54,0.2)] ring-4 ring-[#ead6b3]">
            <div className="flex items-center justify-center gap-3">
              <img src={thumbs[plane].pilot} alt="" className="h-12 w-12 animate-bounce rounded-full bg-white p-0.5 ring-2 ring-[#f0a45d]" style={{ imageRendering: 'pixelated' }} />
              <h2 className="text-xl font-black text-[#e8742a]">¡Oleada {hud.resumen.oleada} superada!</h2>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5 text-[#6b4f3a]">
              {[
                ['🐭', hud.resumen.enemigos, 'enemigos'],
                ['⭐', hud.resumen.puntos, 'puntos'],
                ['⏱️', `${hud.resumen.tiempo}s`, 'tiempo'],
                ['🐟', hud.resumen.pescado, 'pescado'],
                ['✈️', hud.resumen.aviones, 'aviones'],
              ].map(([icon, value, label]) => (
                <div key={label} className="rounded-xl bg-white/70 px-1 py-1.5">
                  <div className="text-base leading-none">{icon}</div>
                  <div className="mt-0.5 text-sm font-black tabular-nums">{value}</div>
                  <div className="text-[9px] font-bold text-[#a08060]">{label}</div>
                </div>
              ))}
            </div>
            {hud.resumen.mision && (
              <p className={`mt-2 text-sm font-black ${hud.resumen.cumplida ? 'text-[#2f8a4a]' : 'text-[#a08060]'}`}>
                {hud.resumen.cumplida ? '🏅' : '▫️'} Misión: {hud.resumen.mision} {hud.resumen.cumplida ? '✓' : ''}
              </p>
            )}
            {hud.resumen.destino ? (
              <p className="mt-3 animate-pulse rounded-full bg-[#7ad8ff] px-3 py-1 text-sm font-black text-[#1a3a6a]">
                🔥 ¡Super nitro! Rumbo{' '}
                {({ oceano: 'al mar de San Antonio 🌊', valparaiso: 'a Valparaíso 🏘️', tormenta: 'a la tormenta ⛈️', valle: 'a San Antonio 🏠' } as Record<string, string>)[hud.resumen.destino]}
              </p>
            ) : (
              <p className="mt-2 text-xs font-bold text-[#8a6e55]">Próxima oleada: {hud.resumen.siguiente}</p>
            )}
            {hud.resumen.dato && (
              <p className="mt-2 rounded-xl bg-[#ffe3a3]/60 px-3 py-1.5 text-left text-xs font-bold text-[#6b4f3a] [@media(max-height:500px)]:hidden">💡 ¿Sabías que…? {hud.resumen.dato}</p>
            )}
            {hud.resumen.nuevos && hud.resumen.nuevos.length > 0 && (
              <p className="mt-2 animate-pulse rounded-full bg-[#3a2a6a] px-3 py-1 text-sm font-black text-[#ffd84a]">🔓 Nuevo en el hangar: {HG.resumirNuevos(hud.resumen.nuevos)}</p>
            )}
            {hud.mejoras.tienda && (
              // The upgrade shop: the break waits until «Seguir».
              <div className="pointer-events-auto mt-3 rounded-2xl bg-[#3a2a6a]/90 p-2 text-white">
                <p className="text-sm font-black">⭐ Mejoras · tienes {hud.mejoras.puntos} {hud.mejoras.puntos === 1 ? 'punto' : 'puntos'}</p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {MEJORAS.map((m) => {
                    const nivel = hud.mejoras.niv[m.k];
                    const costo = nivel + 1;
                    const max = nivel >= 5;
                    const puede = !max && hud.mejoras.puntos >= costo;
                    return (
                      <button
                        key={m.k}
                        type="button"
                        disabled={!puede}
                        onClick={() => {
                          if (game.current?.mejorar(m.k)) menu.aceptar();
                        }}
                        aria-label={`${m.nombre}: nivel ${nivel} de 5. ${max ? 'Al máximo' : `Cuesta ${costo} ⭐`}`}
                        className={`rounded-xl px-1 py-1.5 text-center transition-transform ${puede ? 'bg-[#fff8e7] text-[#6b4f3a] hover:-translate-y-0.5' : 'bg-white/20 text-white/60'}`}
                      >
                        <div className="text-lg leading-none">{m.icono}</div>
                        <div className="text-xs font-black">{m.nombre}</div>
                        <div className="text-[10px] tracking-tight text-[#f0a45d]">{'●'.repeat(nivel)}<span className="opacity-40">{'●'.repeat(5 - nivel)}</span></div>
                        <div className="text-[9px] font-bold opacity-80 [@media(max-height:500px)]:hidden">{m.efecto}</div>
                        <div className="text-[10px] font-black">{max ? 'MÁX' : `${costo} ⭐`}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => { menu.aceptar(); setHangar(true); }} className={`${BTN} h-9`}>
                    🛩️ Hangar · {HG.especDe(hud.hangar.avion).real ?? HG.especDe(hud.hangar.avion).name}
                  </button>
                  <button type="button" ref={seguirRef} onClick={() => game.current?.cerrarTienda()} className={`${GO} py-2 text-sm`}>
                    Seguir ▶
                  </button>
                </div>
              </div>
            )}
            <p className="mt-1 text-[10px] font-bold text-[#a08060]">Partida guardada ✓ · puedes seguir otro día</p>
          </div>
        </div>
      )}
      {phase === 'play' && hangar && hud?.mejoras.tienda && !paused && (
        <Hangar
          piloto={hud.hangar.piloto}
          avion={hud.hangar.avion}
          bomba={hud.hangar.bomba}
          libres={hud.hangar.libres}
          bombas={hud.hangar.bombas}
          onAvion={(a) => game.current?.elegirAvion(a)}
          onBomba={(b) => game.current?.elegirAvion(hud.hangar.avion, b)}
          onClose={cerrarHangar}
        />
      )}
      {phase === 'play' && hud && hud.hielo > 0.25 && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex justify-center px-4">
          <span
            role={hud.congelado ? 'alert' : 'status'}
            className={`rounded-full px-4 py-1.5 text-center text-sm font-black shadow-[0_3px_0_rgba(26,58,106,0.35)] ${
              hud.congelado ? 'animate-pulse bg-[#e6f6ff] text-[#1a3a6a] ring-4 ring-[#9ad8ff]' : 'bg-[#bfe8ff] text-[#1a3a6a]'
            }`}
          >
            {hud.congelado
              ? '🧊 ¡Avión congelado! Los controles no responden… cayendo hasta descongelar'
              : `❄️ ¡Frío extremo! Baja o te congelarás · hielo ${Math.round(hud.hielo * 100)}%`}
          </span>
        </div>
      )}
      {phase === 'play' && hud?.stall && !paused && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 text-center">
          <span className="inline-block animate-pulse rounded-full bg-[#ffe048] px-4 py-1.5 text-sm font-black text-[#6b4f3a] shadow-[0_3px_0_#e08a10]">
            ⚠️ ¡Vas muy lento! Apunta hacia abajo y acelera
          </span>
        </div>
      )}
      {phase === 'play' && hud?.radio && !paused && !hud.resumen && <Radio key={hud.radio.texto + hud.radio.quien} quien={hud.radio.quien} texto={hud.radio.texto} top={barraH + (hud.boss ? 48 : 0)} />}
      {phase === 'play' && hud?.boss && (
        <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4" style={{ top: barraH }}>
          <div className="w-full max-w-sm rounded-2xl bg-[#fff8e7]/95 px-3 py-1.5 shadow-[0_3px_0_rgba(91,70,54,0.2)] ring-2 ring-[#f08a94]">
            <div className="flex items-center justify-between text-xs font-black text-[#a02a4a]">
              <span>👵 {hud.boss.name}</span>
              <span>{Math.ceil(hud.boss.hp * 100)}%</span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#ffd8d8]">
              <div className="h-full rounded-full bg-[#e0486a] transition-[width] duration-200" style={{ width: `${hud.boss.hp * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Keyboard controls, always on screen (can be folded away). */}
      {phase === 'play' && !touchUi && !paused && !hud?.enTierra && (
        <div className="absolute bottom-10 left-3 z-10 origin-bottom-left [@media(max-height:500px)]:scale-[0.7] [@media(max-height:500px)]:opacity-80">
          {showKeys && !keysFolded ? (
            <div className="rounded-2xl bg-[#fff8e7]/90 p-2.5 text-[11px] font-bold text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] ring-2 ring-[#ead6b3]">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-xs font-black">Controles</span>
                <button type="button" onClick={toggleKeys} className="rounded-full px-1.5 text-[11px] font-black text-[#a08060] hover:bg-[#ead6b3]" aria-label="Ocultar controles">
                  ✕
                </button>
              </div>
              <ul className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <Key k="← ↑ → ↓" label="Pilotear (o WASD)" />
                <Key k="E · Shift" label="Acelerar" on={hud?.throttle === 1} />
                <Key k="E E (dos veces)" label="Super nitro" on={hud?.nitro === 'activo'} />
                <Key k="Q · Ctrl" label="Frenar (apaga el nitro)" on={hud?.throttle === -1} />
                <Key k="Espacio" label="Misil (sale por la nariz)" />
                <Key k="K" label="Bomba" />
                <Key k="L · Enter" label="Bengalas" />
                <Key k="H · F" label="Metralla (se calienta)" />
                <Key k="N" label="Bomba nuclear (de los ovnis)" />
                <Key k="R" label="Tonel: esquiva misiles" />
                <Key k="Z · rueda" label="Zoom" />
                <Key k="Esc" label="Pausa" />
              </ul>
            </div>
          ) : (
            <button type="button" onClick={keysFolded ? () => setKeysFolded(false) : toggleKeys} className={BTN}>
              ⌨️ Controles
            </button>
          )}
        </div>
      )}

      {/* Intro, SNES style: «presenta», the pilots fly in, the logo slams down, press start. */}
      {phase === 'intro' && (
        <div
          role="button"
          tabIndex={0}
          aria-label={introStep < 3 ? 'Saltar la intro' : 'Empezar'}
          onClick={advanceIntro}
          className={`absolute inset-0 z-50 grid cursor-pointer place-items-center overflow-hidden transition-colors duration-700 ${introStep === 0 ? 'bg-[#120c24]' : 'bg-[#120c24]/55'}`}
        >
          {introStep === 0 ? (
            <div className="text-center">
              <p className="animate-[aparece_1.2s_ease-out] text-sm font-black uppercase tracking-[0.35em] text-[#c9b4ff]">danieleduardo.cl</p>
              <p className="mt-1 animate-[aparece_1.6s_ease-out] text-lg font-black text-white">presenta</p>
              <p className="mt-10 animate-pulse text-xs font-black text-[#ffe3a3]">{touchUi ? 'Toca la pantalla' : 'Presiona cualquier tecla'} 🔊</p>
            </div>
          ) : (
            <div className="flex w-full max-w-3xl flex-col items-center px-4 text-center">
              {/* The squadron flies in from the left… */}
              <div className="flex items-end justify-center gap-4 sm:gap-8">
                {PLANES.map((p, i) => (
                  <div key={p.id} className="intro-vuela flex flex-col items-center" style={{ animationDelay: `${i * 0.25}s` }}>
                    <img src={thumbs[p.id].pilot} alt="" className="h-12 w-12 rounded-full bg-[#fff8e7] p-1 ring-4 ring-[#f0a45d] sm:h-16 sm:w-16" style={{ imageRendering: 'pixelated' }} />
                    <img src={thumbs[p.id].plane} alt="" className="mt-1 h-8 w-auto sm:h-12" style={{ imageRendering: 'pixelated' }} />
                    <span className="mt-1 text-xs font-black text-white drop-shadow sm:text-sm">{p.pilot}</span>
                  </div>
                ))}
              </div>
              {/* …the logo slams down… */}
              {introStep >= 2 && (
                <h1 className="logo-dui intro-golpe mt-4 text-5xl font-black leading-none sm:text-7xl">
                  ESCUADRÓN
                  <br />
                  DUI
                </h1>
              )}
              {/* …the mice come the other way… */}
              {introStep >= 2 && (
                <div className="mt-3 flex items-end gap-3">
                  {ratones.map((src, i) => (
                    <img key={i} src={src} alt="" className="intro-ratones h-8 w-auto sm:h-10" style={{ imageRendering: 'pixelated', animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              )}
              {introStep >= 3 && <p className="mt-6 animate-pulse text-xl font-black tracking-widest text-[#ffe048] drop-shadow">{touchUi ? 'TOCA PARA EMPEZAR' : 'PRESIONA START'}</p>}
            </div>
          )}
        </div>
      )}

      {/* Title menu over the self-playing game. */}
      {phase === 'titulo' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#120c24]/50 via-transparent to-[#120c24]/50 p-4">
          <h1 className="logo-dui text-5xl font-black leading-none sm:text-7xl [@media(max-height:500px)]:text-4xl">
            ESCUADRÓN DUI
          </h1>
          <nav aria-label="Menú principal" className="flex w-full max-w-xs flex-col gap-2.5">
            {saved && (
              <button type="button" autoFocus onClick={() => play(true)} className={`${GO} w-full`}>
                ▶ Continuar · oleada {saved.wave}
              </button>
            )}
            <button type="button" autoFocus={!saved} onClick={() => { menu.aceptar(); setPhase('menu'); }} className={saved ? `${BTN} h-12 w-full text-base` : `${GO} w-full`}>
              ✈️ {saved ? 'Nueva partida' : 'Jugar'}
            </button>
            <button type="button" onClick={() => { menu.aceptar(); setPhase('creditos'); }} className={`${BTN} h-12 w-full text-base`}>
              🎬 Créditos
            </button>
            <button type="button" onClick={() => navigate('/clasico')} className={`${BTN} h-12 w-full text-base`}>
              🏠 Versión clásica del portafolio
            </button>
          </nav>
          <p className="text-xs font-bold text-white/80 drop-shadow">© 2026 {AUTOR} · danieleduardo.cl</p>
        </div>
      )}

      {/* Credits: a slow SNES-style roll; every role is the author's. */}
      {phase === 'creditos' && (
        <div role="dialog" aria-modal="true" aria-label="Créditos" className="absolute inset-0 z-30 overflow-hidden bg-[#120c24]/85 text-center text-white motion-reduce:overflow-y-auto">
          <div className="creditos-rueda mx-auto max-w-lg px-6 pb-[60vh] pt-[100vh]">
            <h2 className="logo-dui text-4xl font-black">ESCUADRÓN DUI</h2>
            <p className="mt-2 text-sm font-bold text-[#c9b4ff]">un juego de {AUTOR}</p>
            <dl className="mt-10 space-y-5">
              {ROLES.map((r) => (
                <div key={r}>
                  <dt className="text-xs font-black uppercase tracking-widest text-[#ffe3a3]">{r}</dt>
                  <dd className="text-lg font-black">{AUTOR}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-14 text-xs font-black uppercase tracking-widest text-[#ffe3a3]">Elenco</h3>
            <ul className="mt-3 space-y-2">
              {ELENCO.map(([n, d]) => (
                <li key={n}>
                  <span className="font-black">{n}</span> <span className="text-sm text-white/70">· {d}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-14 text-xs font-black uppercase tracking-widest text-[#ffe3a3]">Recursos</h3>
            <p className="mt-3 text-sm text-white/80">
              Algunos efectos de sonido son grabaciones de dominio público (CC0) de Freesound.org; gracias a {SONIDOS_CC0.join(', ')}.
              <br />
              Tipografías Fredoka y Nunito (SIL Open Font License).
              <br />
              La música, el arte y todo lo demás: {AUTOR}.
            </p>
            <h3 className="mt-14 text-xs font-black uppercase tracking-widest text-[#ffe3a3]">Agradecimientos especiales</h3>
            <p className="mt-3 text-sm text-white/80">A Dui, Lulu y Almendrita, por inspirar cada vuelo.</p>
            <p className="mt-16 text-2xl font-black">¡Gracias por jugar!</p>
            <p className="mt-2 text-sm text-white/70">© 2026 {AUTOR} · danieleduardo.cl</p>
          </div>
          <button type="button" autoFocus onClick={() => { menu.volver(); setPhase('titulo'); }} className={`${BTN} fixed bottom-5 left-1/2 z-40 h-12 -translate-x-1/2`}>
            ← Volver
          </button>
        </div>
      )}

      {/* Character select, arcade style: three framed pilots, the chosen one big and animated; confirm and they strike a pose. */}
      {phase === 'menu' && (
        <div role="dialog" aria-modal="true" aria-label="Elige tu piloto" className={`absolute inset-0 ${hangar ? 'z-[45]' : 'z-30'} flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#120c24]/70 p-3 pt-16 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:pt-12`}>
          <div className="flex w-full max-w-4xl items-center justify-between gap-2">
            <button type="button" onClick={() => { menu.volver(); setPhase('titulo'); }} className={`${BTN} h-9`} disabled={!!confirmado}>← Volver</button>
            <h1 className="logo-dui text-3xl font-black sm:text-5xl [@media(max-height:500px)]:text-2xl">ELIGE TU PILOTO</h1>
            <span className="w-20" />
          </div>
          <div className="grid w-full max-w-4xl grid-cols-3 gap-2 sm:gap-4">
            {PLANES.map((p) => {
              const sel = plane === p.id;
              const pose: Pose = confirmado === p.id ? 'listo' : sel ? 'elegido' : 'quieto';
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!!confirmado}
                  onClick={() => (sel ? confirmar() : elegir(p.id))}
                  aria-pressed={sel}
                  aria-label={`${p.pilot}, ${p.name}`}
                  className={`tarjeta-piloto relative overflow-hidden rounded-xl text-center transition-transform duration-200 ${
                    sel ? 'z-10 scale-[1.04] ring-4 ring-[#ffd84a] shadow-[0_0_24px_rgba(255,216,74,0.6)]' : 'opacity-70 ring-2 ring-[#3a2a6a] hover:opacity-90'
                  } ${confirmado === p.id ? 'tarjeta-confirmada' : ''}`}
                >
                  <FondoTarjeta m={p.id} />
                  {sel && !confirmado && <span className="absolute left-1.5 top-1.5 z-10 rounded bg-[#ff4a5a] px-1.5 text-[10px] font-black text-white">P1</span>}
                  <div className="relative z-10 flex flex-col items-center px-1 pb-2 pt-2">
                    <Retrato m={p.id} pose={pose} className="h-24 w-24 sm:h-48 sm:w-48 [@media(max-height:500px)]:h-20 [@media(max-height:500px)]:w-20" />
                    <span className="mt-1 text-lg font-black text-white drop-shadow-[0_2px_0_#3a2a6a] sm:text-2xl [@media(max-height:500px)]:text-sm">{p.pilot.toUpperCase()}</span>
                    <span className="text-[11px] font-black text-[#ffe3a3] drop-shadow sm:text-sm [@media(max-height:500px)]:text-[10px]">{p.name}</span>
                    <img src={thumbs[p.id].plane} alt="" className="mt-1 h-6 w-auto sm:h-10 [@media(max-height:500px)]:hidden" style={{ imageRendering: 'pixelated' }} />
                  </div>
                  {confirmado === p.id && <span className="sello-listo absolute inset-x-0 top-1/3 z-20 text-3xl font-black text-[#ffd84a] sm:text-5xl">¡LISTO!</span>}
                </button>
              );
            })}
          </div>
          {/* The chosen pilot's story and numbers. */}
          <div className="w-full max-w-4xl rounded-2xl bg-[#fff8e7]/95 p-3 text-center ring-4 ring-[#ead6b3] [@media(max-height:500px)]:p-1.5">
            <p className="text-sm font-bold text-[#6b4f3a] [@media(max-height:500px)]:hidden">{spec.blurb}</p>
            <dl className="mt-1 grid grid-cols-4 gap-1 text-xs font-bold sm:text-sm">
              <div><dt className="text-[10px] text-[#a08060]">Velocidad</dt><dd><Stars n={spec.stats.velocidad} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Blindaje</dt><dd><Stars n={spec.stats.blindaje} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Misiles</dt><dd><Stars n={spec.stats.misiles} /></dd></div>
              <div><dt className="text-[10px] text-[#a08060]">Bombas</dt><dd><Stars n={spec.stats.bombas} /></dd></div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {saved && (
              <button type="button" disabled={!!confirmado} onClick={() => play(true)} className={`${BTN} h-12`}>
                ▶ Continuar · {PLANES.find((p) => p.id === saved.pilot)?.pilot}, oleada {saved.wave}
              </button>
            )}
            <button type="button" disabled={!!confirmado} onClick={() => { menu.aceptar(); setHangar(true); }} className={`${BTN} h-12`}>
              🛩️ Hangar · {HG.especDe(avion ?? plane).real ?? HG.especDe(avion ?? plane).name}
            </button>
            <button type="button" autoFocus disabled={!!confirmado} onClick={confirmar} className={GO}>
              ✈️ ¡A volar con {spec.pilot}!
            </button>
          </div>
          <p className="text-center text-[11px] font-bold text-white/80 [@media(max-height:500px)]:hidden">
            {touchUi ? 'Toca un piloto para elegirlo y otra vez para confirmar.' : '← → elige · Enter confirma · Esc vuelve'}
          </p>
          {portrait && <p className="text-center text-xs font-black text-[#ffe3a3]">📱 Gira el teléfono para jugar más cómodo.</p>}
          {hangar && (
            <Hangar
              piloto={plane}
              avion={avion ?? plane}
              bomba={bomba ?? HG.especDe(avion ?? plane).bomba}
              libres={HG.HANGAR.filter((a) => HG.avionLibre(a.id)).map((a) => a.id)}
              bombas={HG.TIPOS_BOMBA.filter((b) => HG.bombaLibre(b, avion ?? plane))}
              onAvion={(a) => {
                setAvion(a);
                setBomba(null);
              }}
              onBomba={setBomba}
              onClose={cerrarHangar}
            />
          )}
        </div>
      )}

      {phase === 'over' && result && (
        <div role="dialog" aria-modal="true" aria-label="Fin del vuelo" className="absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4 [@media(max-height:500px)]:p-2">
          <div className="w-full max-w-md rounded-[2rem] bg-[#fff8e7]/95 p-6 [@media(max-height:500px)]:p-3 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h2 className="text-3xl font-black text-[#e8742a]">{result.reason === 'avion' ? '¡Derribaron todos tus aviones!' : '¡Vaciaron la despensa!'}</h2>
            <p className="mt-1 font-bold text-[#8a6e55]">
              {result.reason === 'avion' ? `${result.pilot} saltó en paracaídas y está bien.` : 'Los ratones se llevaron todo el pescado.'}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 font-black">
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Puntos</div>{result.score}</div>
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Oleada</div>{result.wave}</div>
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Vehículos</div>{result.kills}</div>
            </div>
            <p className="mt-3 font-black">{result.record ? '🏆 ¡Nuevo récord!' : `Récord: ${result.best}`}</p>
            <p className="mt-2 text-sm font-bold text-[#8a6e55]">
              {result.reason === 'avion'
                ? 'Consejo: cuando un misil se acerque, gira fuerte en el último momento o suelta bengalas ✨'
                : 'Consejo: vuela bajo y vigila el pescado 🐟; las flechas del borde te llevan a los ratones'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {saved && (
                <button type="button" autoFocus disabled={!overListo} onClick={() => play(true)} className={GO}>
                  Seguir desde la oleada {saved.wave}
                </button>
              )}
              <button type="button" autoFocus={!saved} disabled={!overListo} onClick={() => play()} className={saved ? `${BTN} h-12` : GO}>Otra vez</button>
              <button type="button" onClick={toHangar} className={`${BTN} h-12`}>Cambiar avión</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'play' && paused && (
        <div role="dialog" aria-modal="true" aria-label="Pausa" className="absolute inset-0 z-30 grid place-items-center bg-[#3a2a6a]/30 p-4">
          <div className="rounded-[2rem] bg-[#fff8e7]/95 p-6 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h2 className="text-3xl font-black">Pausa</h2>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" autoFocus onClick={togglePause} className={GO}>Seguir</button>
              <button type="button" onClick={toHangar} className={`${BTN} h-12`}>Salir al hangar</button>
              <button type="button" onClick={toMenu} className={`${BTN} h-12`}>Menú principal</button>
            </div>
            {touchUi && hud && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => game.current?.cycleSky()} className={`${BTN} h-10`}>
                  {({ auto: '🌄', dia: '☀️', tarde: '🌅', noche: '🌙' } as Record<string, string>)[hud.sky]} Cielo
                </button>
                {hud.zoom[0] > 1 && (
                  <button type="button" onClick={() => game.current?.zoom()} className={`${BTN} h-10`}>🔍 Zoom</button>
                )}
                <button type="button" onClick={toggleMute} className={`${BTN} h-10`}>{muted ? '🔇 Sonido' : '🔊 Sonido'}</button>
                <button type="button" onClick={() => navigate('/clasico')} className={`${BTN} h-10`}>Versión clásica</button>
              </div>
            )}
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm font-black text-[#6b4f3a]">
              <input type="checkbox" checked={calma} onChange={(e) => toggleCalma(e.target.checked)} className="h-5 w-5 accent-[#f0a45d]" />
              Menos movimiento (sin sacudidas ni destellos fuertes)
            </label>
          </div>
        </div>
      )}

      {/* Phones held upright: the game is made for landscape. */}
      {portrait && touchUi && !verticalOk && (phase === 'play' || phase === 'menu') && (
        <div role="dialog" aria-modal="true" aria-label="Gira el teléfono" className="absolute inset-0 z-[60] grid place-items-center bg-[#120c24]/90 p-6 text-center text-white">
          <div>
            <div className="girar-telefono text-6xl">📱</div>
            <p className="mt-4 text-xl font-black">Gira el teléfono</p>
            <p className="mt-1 text-sm font-bold text-white/80">Escuadrón Dui se juega en horizontal: así ves el cielo, el suelo y a los ratones.</p>
            <button type="button" onClick={() => setVerticalOk(true)} className={`${BTN} mt-5 h-10`}>Jugar igual</button>
          </div>
        </div>
      )}
      {phase === 'play' && touchUi && !paused && (
        <>
          <div className="absolute inset-x-0 bottom-0 top-16 z-10 flex touch-none" onPointerDown={onSkyDown} onPointerUp={onSkyUp} onPointerCancel={onSkyUp} onLostPointerCapture={onSkyUp}>
            {/* Two invisible halves: hold one to turn. Only a soft glow on that edge, and a small arrow, show it. */}
            <div className="pointer-events-none relative h-full w-1/2">
              <div className={`absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white/25 to-transparent transition-opacity duration-150 ${turning === 1 ? 'opacity-100' : 'opacity-0'}`} />
              <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-2xl font-black text-white drop-shadow transition-opacity ${turning === 1 ? 'opacity-90' : 'opacity-30'}`}>⟲</span>
            </div>
            <div className="pointer-events-none relative h-full w-1/2">
              <div className={`absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white/25 to-transparent transition-opacity duration-150 ${turning === -1 ? 'opacity-100' : 'opacity-0'}`} />
              <span className={`absolute right-2 top-[38%] -translate-y-1/2 text-2xl font-black text-white drop-shadow transition-opacity ${turning === -1 ? 'opacity-90' : 'opacity-30'}`}>⟳</span>
            </div>
            {turns < 3 && !hud?.enTierra && (
              <span className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 rounded-full bg-[#3a2a6a]/55 px-3 py-1 text-center text-[11px] font-black text-white">
                Mantén un lado para girar · la metralla dispara sola · doble toque: 🔥 nitro
              </span>
            )}
          </div>
          {/* Left thumb: throttle in the corner. */}
          <div className="absolute bottom-10 left-3 z-10 flex flex-col gap-2 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
            <TouchButton label={hud?.nitro === 'listo' ? 'Acelerar ×2🔥' : 'Acelerar'} active={hud?.throttle === 1 || hud?.nitro === 'activo'} {...throttle(1)}>
              {hud?.nitro === 'activo' ? '🔥' : '⏩'}
            </TouchButton>
            <TouchButton label="Frenar" active={hud?.throttle === -1} {...throttle(-1)}>🛑</TouchButton>
          </div>
          {/* Right thumb: the missile big in the corner, the rest in an arc around it. */}
          <div className="absolute bottom-7 right-0 z-10 h-48 w-48 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] [@media(max-height:420px)]:h-40 [@media(max-height:420px)]:w-40">
            <div className="absolute bottom-3 right-3">
              <TouchButton label="Misil" big {...hold('fire')}>🚀</TouchButton>
            </div>
            <div className="absolute bottom-3 right-[6.2rem] [@media(max-height:420px)]:right-[5.4rem]">
              <TouchButton label="Bomba" {...hold('bomb')}>💣</TouchButton>
            </div>
            <div className="absolute bottom-[4.6rem] right-[5.2rem] [@media(max-height:420px)]:bottom-[4rem] [@media(max-height:420px)]:right-[4.5rem]">
              <TouchButton label="Bengalas" {...hold('flare')}>✨</TouchButton>
            </div>
            <div className="absolute bottom-[6.2rem] right-3 [@media(max-height:420px)]:bottom-[5.4rem]">
              <TouchButton label="Tonel" {...hold('tonel')}>🌀</TouchButton>
            </div>
            {!!hud?.nukes && (
              <div className="absolute bottom-[9.4rem] right-3 [@media(max-height:420px)]:bottom-[8.4rem]">
                <TouchButton label={`Nuclear ×${hud.nukes}`} {...hold('nuke')}>☢️</TouchButton>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TouchButton({ label, big, active, children, ...rest }: { label: string; big?: boolean; active?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex flex-col items-center justify-center rounded-full shadow-[0_3px_0_rgba(91,70,54,0.25)] ring-2 active:scale-95 active:opacity-100 transition-transform ${
        active ? 'bg-[#ffe3a3] ring-[#f0a45d]' : 'bg-[#fff8e7]/70 ring-white/60'
      } ${big ? 'h-20 w-20 text-3xl [@media(max-height:420px)]:h-[4.5rem] [@media(max-height:420px)]:w-[4.5rem]' : 'h-14 w-14 text-xl [@media(max-height:420px)]:h-12 [@media(max-height:420px)]:w-12'} opacity-85`}
      {...rest}
      onPointerDown={(e) => {
        // A short buzz under the thumb.
        try {
          navigator.vibrate?.(big ? 18 : 10);
        } catch {
          /* no vibration */
        }
        rest.onPointerDown?.(e);
      }}
    >
      <span aria-hidden className="leading-none">{children}</span>
      <span aria-hidden className="mt-0.5 text-[8px] font-black leading-none text-[#6b4f3a]">{label}</span>
    </button>
  );
}

function Key({ k, label, on }: { k: string; label: string; on?: boolean }) {
  return (
    <li className="contents">
      <kbd className={`justify-self-start whitespace-nowrap rounded-md px-1.5 py-0.5 font-black shadow-[0_2px_0_rgba(91,70,54,0.25)] ${on ? 'bg-[#ffe048]' : 'bg-white'}`}>{k}</kbd>
      <span className={on ? 'font-black text-[#e8742a]' : ''}>{label}</span>
    </li>
  );
}
