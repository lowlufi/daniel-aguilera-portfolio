import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { initAudio, jingleIntro, jingleStart, pauseAudio, setMusicMood, setMusicVolume, setMuted as setAudioMuted, menu } from '../game/audio';
import { cargarSonidos } from './sonido';
import * as AD from './armas-dibujo';
import { ESCUADRON, createVuelo, dibujo, readSave, type Hud, type Mejorable, type Result, type SavedGame, type Vuelo } from './motor';
import type { BombaTipo, ModeloAvion as Avion, Piloto } from './fisica-tipos';
import { CASA } from './pilotos';
import * as HG from './hangar';
import { PARAMS } from './fisica-vuelo';
import * as AB from './audio-batalla';
import { FPS, FRAMES, fondoTarjeta, retrato, type Pose } from './retratos';
import Cinematica from './Cinematica';
import * as HI from './historia';

/*
 * "Escuadrón Dui": the plane game around the canvas engine in motor.ts. This
 * file only does the intro, the title screen, the credits, the hangar, the
 * HUD, the pause and the touch controls.
 */

/** intro → titulo (title menu over a self-playing game) → menu (hangar) → play → over. */
type Phase = 'intro' | 'titulo' | 'creditos' | 'ajustes' | 'menu' | 'play' | 'over';

const AUTOR = 'Daniel Aguilera Campusano';
/** The four upgrades bought with points between waves. */
const MEJORAS: { k: Mejorable; icono: PxIcon; nombre: string; efecto: string }[] = [
  { k: 'dano', icono: 'explosion', nombre: 'Daño', efecto: '+15 % por nivel' },
  { k: 'salud', icono: 'corazon', nombre: 'Salud', efecto: '+1 coraza por oleada' },
  { k: 'defensa', icono: 'escudo', nombre: 'Defensa', efecto: '+10 % de desviar' },
  { k: 'municion', icono: 'misil', nombre: 'Munición', efecto: '+1 puesto de cada arma' },
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
  ['Naxo', 'enfermero del CESFAM, Mustang'],
  ['Ñelo', 'de Juanaspe, Stuka'],
  ['Vecina Margarita', 'ella misma (y su portaaviones)'],
  ['Los ratones', 'muchos, muchísimos ratones'],
];
/** CC0 sound recordings (no attribution required; thanked anyway). */
const SONIDOS_CC0 = ['modusmogulus', 'craigsmith', 'qubodup', 'unfa', 'josecruz98', 'Alxy', 'Anthousai', 'Rocotilos'];

/** A HUD instrument plate (night-purple, bevelled, pixel-notched corners): see .hud-panel in index.css. */
const CHIP = 'hud-panel h-8 [@media(min-height:500px)]:h-9 gap-1.5 px-2 text-sm';
/** The phone HUD: the same plates, small, in one tight row so the sky stays clear. */
const CHIP_M = 'hud-panel h-5 gap-0.5 px-1 text-[10px]';
/** The HUD's cockpit switches: cream key caps on the same pixel frame. */
const TECLA = 'hud-key h-8 [@media(min-height:500px)]:h-9 text-sm';
const TECLA_M = 'hud-key h-7 text-xs';
const BTN = 'whitespace-nowrap rounded-full bg-[#fff8e7]/95 px-3 md:px-4 h-8 [@media(min-height:500px)]:h-10 text-xs md:text-sm font-extrabold text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] hover:-translate-y-0.5 transition-transform';
const GO = 'rounded-full bg-[#7ccf8a] px-6 py-3 text-base font-black text-[#1d4a26] shadow-[0_4px_0_#4f9c5d] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_#4f9c5d] transition-transform';

function readMuted() {
  try {
    return localStorage.getItem('vuelo-silencio') === '1';
  } catch {
    return false;
  }
}

/*
 * The HUD's pixel icons: drawn as tiny SVGs (one rect per run of pixels, crisp
 * edges), so they stay sharp at any size and match the game instead of the
 * system's emoji. Each letter is a colour; '.' is transparent.
 */
const PX_COL: Record<string, string> = {
  k: '#22183f', w: '#fff8e7', y: '#ffd84a', o: '#f0a45d', O: '#e8742a', r: '#ff5a6a', p: '#ff8ab8',
  g: '#7af0a0', b: '#7ad8ff', B: '#4a7ae0', s: '#c8c0e0', m: '#ddd2ec', f: '#ffd2b0', G: '#8a8aa8',
};
const PX = {
  avion: ['yy.........', 'yyy..bb....', 'yyyyyyyyyy.', '.oooooooyyw', '....ooo....'],
  pez: ['..ooo...o', '.ooooo.oo', 'okoooooo.', '.ooooo.oo', '..ooo...o'],
  estrella: ['...y...', '..yyy..', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', 'yy...yy'],
  raton: ['mm...mm', 'mmm.mmm', '.mmmmm.', '.mkmkm.', '..mpm..', '...m...'],
  ola: ['.bb..bb.', 'b..bb..b', '........', '.bb..bb.', 'b..bb..b'],
  montana: ['...w.....', '..wws....', '.sssss.s.', '.ssssssss', 'sssssssss'],
  manga: ['srrww....', 'srrwwrrw.', 'srrwwrrww', 'srrwwrr..', 's........', 's........'],
  misil: ['.s........', '.sswwwwwr.', 'oswwwwwwrr', '.sswwwwwr.', '.s........'],
  bomba: ['s...mmm..', 'ss.mmrmm.', 'sssmmrmmm', 'ss.mmrmm.', 's...mmm..'],
  bengala: ['...y...', '.y.o.y.', '..ooo..', 'yowwwoy', '..ooo..', '.y.o.y.', '...y...'],
  llama: ['...o...', '..oo...', '..oyo.o', '.oyyoo.', '.oyyyo.', 'oyywyyo', 'oyywwyo', '.oyyyo.'],
  bala: ['.y...y.', 'yyy.yyy', 'ooo.ooo', 'ooo.ooo', 'ooo.ooo'],
  nuclear: ['kk...kk', 'kkk.kkk', '.kk.kk.', '...k...', '.......', '..kkk..', '.kkkkk.'],
  corazon: ['.pp.pp.', 'ppppppp', 'ppppppp', '.ppppp.', '..ppp..', '...p...'],
  diana: ['..rrr..', '.r...r.', 'r..r..r', 'r.rrr.r', 'r..r..r', '.r...r.', '..rrr..'],
  medalla: ['.b...b.', '..b.b..', '...b...', '..yyy..', '.yyoyy.', '.yoooy.', '.yyoyy.', '..yyy..'],
  pausa: ['kk..kk', 'kk..kk', 'kk..kk', 'kk..kk', 'kk..kk', 'kk..kk', 'kk..kk'],
  play: ['k.....', 'kkk...', 'kkkkk.', 'kkkkkk', 'kkkkk.', 'kkk...', 'k.....'],
  parlante: ['...k.....', '..kk..k..', 'kkkk...k.', 'kkkk.k.k.', 'kkkk...k.', '..kk..k..', '...k.....'],
  mudo: ['...k.....', '..kk.....', 'kkkk.r.r.', 'kkkk..r..', 'kkkk.r.r.', '..kk.....', '...k.....'],
  sol: ['...O...', '.O...O.', '..yyy..', 'O.yyy.O', '..yyy..', '.O...O.', '...O...'],
  luna: ['..BBB..', '.BB....', 'BB.....', 'BB.....', 'BB.....', '.BB...B', '..BBBB.'],
  tarde: ['.......', '..ooo..', '.oyyyo.', 'oyyyyyo', 'BBBBBBB', '.......', 'B.BBB.B'],
  auto: ['y....BB', '.yy.B..', 'yyy.B..', '.yy.BB.', 'y....BB', '.......', 'kkkkkkk'],
  lupaMas: ['..kkk...', '.k...k..', 'k..k..k.', 'k.kkk.k.', 'k..k..k.', '.k...kk.', '..kkk.kk', '......kk'],
  lupaMenos: ['..kkk...', '.k...k..', 'k.....k.', 'k.kkk.k.', 'k.....k.', '.k...kk.', '..kkk.kk', '......kk'],
  casa: ['...k...', '..kkk..', '.kkkkk.', 'kkkkkkk', '.kkkkk.', '.kk.kk.', '.kk.kk.'],
  hangar: ['..kkk..', '.k...k.', 'k.kkk.k', 'k.k.k.k', 'k.k.k.k', 'kkkkkkk'],
  alerta: ['...k...', '..kyk..', '..kyk..', '.kkykk.', '.kkkkk.', 'kkkykkk', 'kkkkkkk'],
  bombilla: ['.yyyy.', 'ywyyyy', 'ywyyyy', 'yyyyyy', '.yyyy.', '.ssss.', '.ssss.', '..ss..'],
  copo: ['...B...', '.B.B.B.', '..BBB..', 'BBBwBBB', '..BBB..', '.B.B.B.', '...B...'],
  hielo: ['BBBBBBB', 'BwwbbbB', 'BwbbbbB', 'BbbbbbB', 'BbbbbbB', 'BbbbbwB', 'BBBBBBB'],
  abuela: ['..sssss..', '.sssssss.', 'ssfffffss', 'sfkkfkkfs', 'spfffffps', '.ffkkkff.', '.fkfffkf.', '..fffff..'],
  antena: ['.g...g.', 'g..s..g', 'g.sss.g', '.g.s.g.', '...s...', '..s.s..', '.s...s.'],
  reloj: ['..www..', '.w...w.', 'w..y..w', 'w..yy.w', 'w.....w', '.w...w.', '..www..'],
  candado: ['..sss..', '.s...s.', '.s...s.', 'yyyyyyy', 'yyykyyy', 'yyykyyy', 'yyyyyyy'],
  escudo: ['bbbbbbb', 'bwbbbbb', 'bwbbbbb', 'bbbbbbb', '.bbbbb.', '.bbbbb.', '..bbb..', '...b...'],
  explosion: ['o..y..o', '.o.y.o.', '..yry..', 'yyrwryy', '..yry..', '.o.y.o.', 'o..y..o'],
  acelerar: ['kk...kk..', '.kk...kk.', '..kk...kk', '.kk...kk.', 'kk...kk..'],
  frenar: ['.rrrrr.', 'rrrrrrr', 'rwwwwwr', 'rrrrrrr', '.rrrrr.'],
  tonel: ['.BBBBB..', 'B.....B.', 'B.BBB..B', 'B.B.B..B', 'B.B....B', 'B..BBBB.', '.B......', '..BBBBBB'],
  giro: ['...www.w.', '..w...ww.', '.w...www.', 'w........', 'w........', 'w.......w', '.w.....w.', '..wwwww..'],
} as const;
type PxIcon = keyof typeof PX;
/** Each icon's runs of same-coloured pixels, worked out once. */
const pxRuns = new Map<PxIcon, [number, number, number, string][]>();
function runsOf(i: PxIcon) {
  let out = pxRuns.get(i);
  if (!out) {
    out = [];
    PX[i].forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        let n = 1;
        while (row[x + n] === ch) n++;
        if (ch !== '.') out!.push([x, y, n, ch]);
        x += n;
      }
    });
    pxRuns.set(i, out);
  }
  return out;
}
/** A pixel icon, `s` screen px per art pixel. `tinta` paints every pixel one colour (empty sockets). */
function Px({ i, s = 2, tinta, className, style }: { i: PxIcon; s?: number; tinta?: string; className?: string; style?: React.CSSProperties }) {
  const rows = PX[i];
  const w = rows[0].length;
  const h = rows.length;
  return (
    <svg aria-hidden width={w * s} height={h * s} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" className={`shrink-0 ${className ?? ''}`} style={style}>
      {runsOf(i).map(([x, y, n, ch]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={n} height={1} fill={tinta ?? PX_COL[ch]} />
      ))}
    </svg>
  );
}

/** One socket per slot: loaded ones lit, spent ones a dark silhouette. */
function Sockets({ i, n, max, s }: { i: PxIcon; n: number; max: number; s?: number }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-px">
      {Array.from({ length: max }, (_, k) => (
        <Px key={k} i={i} s={s} tinta={k < n ? undefined : '#55467f'} />
      ))}
    </span>
  );
}

/** A segmented instrument bar: `n` lit of `max`, in `color`; `alerta` blinks the lit ones. */
function Segs({ n, max, color, alerta, ancho = 6 }: { n: number; max: number; color: string | ((k: number) => string); alerta?: boolean; ancho?: number }) {
  return (
    <span aria-hidden className="hud-segs">
      {Array.from({ length: max }, (_, k) => (
        <i key={k} className={k < n && alerta ? 'hud-parpadeo' : ''} style={{ width: ancho, background: k < n ? (typeof color === 'string' ? color : color(k)) : undefined }} />
      ))}
    </span>
  );
}

/** The score as a mechanical counter: each digit in its own drum window, idle leading zeros dimmed. */
function Contador({ v, cifras = 5 }: { v: number; cifras?: number }) {
  const t = String(Math.max(0, Math.floor(v)));
  const pad = Math.max(0, cifras - t.length);
  return (
    <span aria-hidden className="hud-odo">
      {Array.from({ length: pad }, (_, k) => (
        <b key={`z${k}`} className="hud-odo-cero">0</b>
      ))}
      {[...t].map((d, k) => (
        <b key={k}>{d}</b>
      ))}
    </span>
  );
}

/** Seconds as «m:ss» (2:05, 0:45) for the wave card. */
const minSeg = (t: number) => {
  const n = Math.max(0, Math.round(t));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
/** The same, in words for screen readers and the tooltip. */
const duracion = (t: number) => {
  const n = Math.max(0, Math.round(t));
  const m = Math.floor(n / 60), sg = n % 60;
  const ps = `${sg} ${sg === 1 ? 'segundo' : 'segundos'}`;
  return m ? `${m} ${m === 1 ? 'minuto' : 'minutos'}${sg ? ` y ${ps}` : ''}` : ps;
};

const CIELO_NOMBRE: Record<string, string> = { auto: 'automático', dia: 'día', tarde: 'tarde', noche: 'noche' };
const CIELO_ICONO: Record<string, PxIcon> = { auto: 'auto', dia: 'sol', tarde: 'tarde', noche: 'luna' };

/** The engine's texts may carry emoji; the HUD draws its own icons, so they're taken out (with any «( / )» they leave). */
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\uFE0F\u200D\p{Extended_Pictographic}]*/gu;
function limpio(t: string) {
  return t
    .replace(EMOJI, '')
    .replace(/\s*\/\s*\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?)])/g, '$1')
    .trim();
}
/** A banner's leading emoji, as one of the HUD's pixel icons. */
function iconoDe(t: string): PxIcon | null {
  if (t.startsWith('🐟')) return 'pez';
  if (t.startsWith('☢')) return 'nuclear';
  if (t.startsWith('✈')) return 'avion';
  return null;
}

/** A big pilot portrait, animated at the pose's own pace (pixel art scaled with CSS). */
function Retrato({ m, pose, className }: { m: Piloto; pose: Pose; className?: string }) {
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
function FondoTarjeta({ m }: { m: Piloto }) {
  const src = useMemo(() => fondoTarjeta(m, 120, 160).toDataURL(), [m]);
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ imageRendering: 'pixelated' }} />;
}

/** Hangar thumbnails per pilot, made once per session (toDataURL is slow on phones). */
const MINIS = new Map<Piloto, Record<Avion, string>>();
function miniaturas(piloto: Piloto) {
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
  piloto: Piloto; avion: Avion; bomba: BombaTipo; libres: Avion[]; bombas: BombaTipo[];
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
  // The list is long: filter it by engine, or show only what's unlocked (remembered per browser).
  const [filtro, setFiltroEstado] = useState<FiltroHangar>(() => {
    try {
      const f = localStorage.getItem('escuadron-dui-filtro');
      return f === 'helice' || f === 'jet' || f === 'libres' ? f : 'todos';
    } catch {
      return 'todos';
    }
  });
  const setFiltro = (f: FiltroHangar) => {
    setFiltroEstado(f);
    try {
      localStorage.setItem('escuadron-dui-filtro', f);
    } catch {
      /* private mode */
    }
  };
  const visibles = HG.HANGAR.filter((a) => a.id === avion || pasaFiltro(filtro, a.id, libres));
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
          <h2 className="logo-dui text-2xl font-black sm:text-3xl [@media(max-height:500px)]:text-xl">🛩️ HANGAR</h2>
          <div role="group" aria-label="Filtrar aviones" className="flex flex-wrap gap-1">
            {FILTROS.map(([f, txt]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtro === f}
                onClick={() => setFiltro(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-black ${filtro === f ? 'bg-[#3a2a6a] text-white' : 'bg-white/80 text-[#6b4f3a]'}`}
              >
                {txt} <span className="opacity-70">{HG.HANGAR.filter((a) => pasaFiltro(f, a.id, libres)).length}</span>
              </button>
            ))}
          </div>
          <button type="button" autoFocus onClick={onClose} className={GO + ' py-2 text-sm'}>Listo ✓</button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-8 [@media(max-height:500px)]:grid-cols-8 [@media(max-height:500px)]:gap-1">
          {visibles.map((a) => {
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
            <li>🚀 {sel.kit.misil.nombre} ×{sel.rack} <span className="font-semibold text-[#a08060]">· {sel.kit.misil.nota}</span></li>
            <li>🔫 {sel.kit.metralla ? sel.kit.metralla.nombre : 'Sin metralla'}{sel.kit.metralla && <span className="font-semibold text-[#a08060]"> · {sel.kit.metralla.nota}</span>}</li>
            <li>✨ {sel.kit.bengala.nombre} ×{sel.flareRack}</li>
            <li>💣 Bodega: {sel.bombRack} {sel.bombs > 1 ? `(suelta ${sel.bombs} a la vez)` : ''}{sel.sigilo > 0 ? ' · 👻 furtivo' : ''}</li>
          </ul>
        </div>
        <p className="mt-2 text-sm font-black">💣 Bombas</p>
        <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-5 [@media(max-height:500px)]:grid-cols-6 [@media(max-height:500px)]:gap-1">
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
                {libre ? <div className={`text-[10px] font-bold opacity-80 ${elegida ? '' : '[@media(max-height:500px)]:hidden'}`}>{info.texto}</div> : <div className="text-[10px] font-black">🔒 {HG.corto(info.desbloqueo)}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type FiltroHangar = 'todos' | 'helice' | 'jet' | 'libres';
const FILTROS: [FiltroHangar, string][] = [['todos', 'Todos'], ['helice', '🌀 Hélice'], ['jet', '🔥 Reacción'], ['libres', '🔓 Libres']];
function pasaFiltro(f: FiltroHangar, id: Avion, libres: Avion[]) {
  if (f === 'libres') return libres.includes(id);
  if (f === 'helice') return PARAMS[id].helice;
  if (f === 'jet') return !PARAMS[id].helice;
  return true;
}

/** A one-line kind for each plane, under its name in the hangar. */
const TIPO_AVION: Record<Avion, string> = {
  avioneta: 'De la casa', caza: 'De la casa', bombardero: 'De la casa',
  raptor: 'Caza furtivo', sukhoi: 'Caza supermaniobrable', b2: 'Bombardero furtivo', ovni: 'De otro mundo',
  tomcat: 'Caza de portaaviones', a10: 'Ataque a tierra', spitfire: 'Caza clásico de hélice',
  stuka: 'Bombardero en picada', mustang: 'Caza clásico de escolta', corsair: 'Caza clásico naval',
  f16: 'Caza polivalente', mig29: 'Caza de superioridad',
  pillan: 'Entrenador chileno', zero: 'Caza clásico naval', hurricane: 'Cazatanques de hélice', bf109: 'Caza clásico de hélice',
  p38: 'Caza bimotor de dos colas', mosquito: 'Bimotor de madera', a37: 'Ataque ligero', a4: 'Ataque naval', f5: 'Caza ligero',
  mig21: 'Interceptor', harrier: 'Despegue vertical', mirage: 'Caza delta', gripen: 'Caza ligero delta', rafale: 'Caza polivalente',
  typhoon: 'Caza de superioridad', f35: 'Caza furtivo', carton: '¿Avión?',
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
    <div role="status" aria-live="polite" className="pointer-events-none absolute left-3 z-20 max-w-[min(22rem,46vw)] animate-[aparece_0.2s_ease-out]" style={{ top: top + 6, marginLeft: 'env(safe-area-inset-left)' }}>
      <div className="hud-panel hud-radio items-start gap-2 whitespace-normal px-2 py-1.5">
        <span className="hud-socket mt-0.5 grid h-7 w-7 shrink-0 place-items-center" aria-hidden>
          <Px i="raton" s={2} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-[#7af0a0]">
            <Px i="antena" s={1.5} className="hud-parpadeo" />
            {limpio(quien)}
          </div>
          <div className="text-xs font-bold leading-snug">
            {limpio(texto).slice(0, n)}
            <span className="sr-only">{limpio(texto).slice(n)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Turns /aviones into an installable app while the game is open: adds the manifest,
 * the iOS home-screen tags and the offline service worker, and catches the browser's
 * install prompt. Returns the cleanup (the rest of the site isn't the game app).
 */
function usarWebApp(alPedir: (e: { prompt: () => Promise<unknown> } | null) => void) {
  const puestos: HTMLElement[] = [];
  const poner = (tag: 'link' | 'meta', attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
    puestos.push(el);
  };
  poner('link', { rel: 'manifest', href: '/aviones.webmanifest' });
  poner('link', { rel: 'apple-touch-icon', href: '/aviones-apple.png' });
  poner('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  poner('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  poner('meta', { name: 'apple-mobile-web-app-title', content: 'Escuadrón Dui' });
  poner('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/aviones-sw.js', { scope: '/aviones' }).catch(() => {});
  const onPrompt = (e: Event) => {
    e.preventDefault();
    alPedir(e as unknown as { prompt: () => Promise<unknown> });
  };
  const onInstalada = () => alPedir(null);
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalada);
  return () => {
    for (const el of puestos) el.remove();
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalada);
  };
}

/** Touch control schemes the player can pick in the pause menu. */
type Control = 'mitades' | 'joystick' | 'volante' | 'tocar';
const CONTROLES: { id: Control; nombre: string; texto: string }[] = [
  { id: 'mitades', nombre: 'Pantalla dividida', texto: 'Mantén un lado para girar' },
  { id: 'joystick', nombre: 'Joystick', texto: 'Arrastra a la izquierda hacia donde volar' },
  { id: 'volante', nombre: 'Volante', texto: 'Inclina el teléfono para girar' },
  { id: 'tocar', nombre: 'Tocar', texto: 'El avión va hacia tu dedo' },
];

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
  const [quien, setQuien] = useState<Piloto>(() => readSave()?.pilot ?? 'dui');
  const [hud, setHud] = useState<Hud | null>(null);
  // Installable web app: the game's manifest and offline cache while on /aviones,
  // and the browser's install prompt (Android/desktop) or iOS instructions.
  const [instalar, setInstalar] = useState<{ prompt: () => Promise<unknown> } | null>(null);
  const [ayudaIos, setAyudaIos] = useState(false);
  const instalada = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const esIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => usarWebApp((e) => setInstalar(e)), []);
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
  useEffect(() => game.current?.setArriba(barraH), [barraH]);
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
  // The HUD's switches (square cream key caps) and its icon scale.
  const tecla = movil ? `${TECLA_M} w-7` : `${TECLA} w-8 [@media(min-height:500px)]:w-9`;
  // Phones: a compact HUD, so the sky and the thumbs get the screen.
  const ic = movil ? 1.25 : 2;
  const [verticalOk, setVerticalOk] = useState(false);

  /*
   * The story (historia.ts, Cinematica.tsx): the prologue before the first
   * take-off, a chapter on the first trip to each map and a short epilogue
   * after each boss beaten for the first time. In-game scenes wait in a queue
   * and play on the wave card (the game stopped, nothing to dodge).
   */
  const [cine, setCine] = useState<{ guion: HI.GuionId; luego?: () => void } | null>(null);
  const [cola, setCola] = useState<HI.GuionId[]>([]);
  const encolar = useCallback((id: HI.GuionId | null) => {
    if (!id || HI.vista(id)) return;
    setCola((c) => (c.includes(id) ? c : [...c, id]));
  }, []);
  // Development only: /aviones?cine=cap-oceano plays any script straight away.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = new URLSearchParams(location.search).get('cine') as HI.GuionId | null;
    if (id && id in HI.HISTORIA) setCine({ guion: id });
  }, []);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const jefeVencido = useRef<(tipo: string) => void>(() => {});
  jefeVencido.current = (tipo) => {
    if (phaseRef.current === 'play') encolar(HI.guionDeJefe(tipo));
  };

  useEffect(() => {
    // A variable, not a literal: motor.ts may call the optional `onJefeVencido(tipo)`
    // when a flying boss falls (see the story queue below).
    const hooks = {
      onHud: setHud,
      onOver: (r: Result) => {
        setResult(r);
        setSaved(readSave());
        setPhase('over');
      },
      onJefeVencido: (tipo: string) => jefeVencido.current(tipo),
    };
    const g = createVuelo(canvasRef.current!, boxRef.current!, hooks);
    game.current = g;
    g.setArriba(barraRef.current?.getBoundingClientRect().height ?? 64);
    try {
      g.setZoomAuto(localStorage.getItem('vuelo-zoomauto') !== '0');
    } catch {
      /* private mode: stays on */
    }
    try {
      g.setAutoGun(localStorage.getItem('vuelo-autogun') !== '0');
    } catch {
      /* private mode: stays on */
    }
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
    const out = {} as Record<Piloto, { plane: string; pilot: string }>;
    // Each pilot in their own plane (the painter's pilot is borrowed and given back).
    const antes = dibujo.pilotoActual();
    for (const p of ESCUADRON) {
      dibujo.fijarPiloto(p.id);
      out[p.id] = { plane: dibujo.planeSprite(p.avion).toDataURL(), pilot: dibujo.pilotPortrait(p.id).toDataURL() };
    }
    dibujo.fijarPiloto(antes);
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
      // The audio just woke up: bake the battle sounds now, during the intro and menus,
      // so nothing is left to synthesize when the pilot boards the plane.
      window.setTimeout(() => AB.precalentar(), 700);
      window.setTimeout(() => AB.precalentarArsenal(), 2500);
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
    if (from) setQuien(from.pilot);
    game.current?.start(from ? from.pilot : quien, from, false, avion ?? undefined, bomba ?? undefined);
    setSaved(null);
    setPhase('play');
  }, [muted, quien, avion, bomba]);

  // Character select: who is confirmed (playing their pose) before take-off.
  const [confirmado, setConfirmado] = useState<Piloto | null>(null);
  const elegir = useCallback((m: Piloto) => {
    setQuien(m);
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
    setConfirmado(quien);
    jingleStart();
    confirmTimer.current = window.setTimeout(() => {
      confirmando.current = false;
      setConfirmado(null);
      // A new game's first take-off waits for the prologue (once per device).
      if (HI.vista('prologo')) play();
      else setCine({ guion: 'prologo', luego: () => play() });
    }, 1300);
  }, [confirmado, quien, play]);
  useEffect(() => {
    if (phase !== 'menu') return;
    const onKey = (e: KeyboardEvent) => {
      if (confirmado) return;
      const i = ESCUADRON.findIndex((p) => p.id === quien);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') elegir(ESCUADRON[(i + ESCUADRON.length - 1) % ESCUADRON.length].id);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') elegir(ESCUADRON[(i + 1) % ESCUADRON.length].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, quien, confirmado, elegir]);

  // Vibration on the thumb keys, remembered on this device (on by default).
  const [vibra, setVibra] = useState(() => {
    try {
      return localStorage.getItem('vuelo-vibrar') !== '0';
    } catch {
      return true;
    }
  });
  const toggleVibra = (on: boolean) => {
    setVibra(on);
    try {
      localStorage.setItem('vuelo-vibrar', on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (on) vibrar(20);
  };
  // Automatic machine gun on phones (on by default); off, it only fires from the button.
  const [autoGun, setAutoGunUi] = useState(() => {
    try {
      return localStorage.getItem('vuelo-autogun') !== '0';
    } catch {
      return true;
    }
  });
  const toggleAutoGun = (on: boolean) => {
    setAutoGunUi(on);
    try {
      localStorage.setItem('vuelo-autogun', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => game.current?.setAutoGun(autoGun), [autoGun]);
  // Auto zoom by speed (on by default).
  const [zoomAuto, setZoomAutoUi] = useState(() => {
    try {
      return localStorage.getItem('vuelo-zoomauto') !== '0';
    } catch {
      return true;
    }
  });
  const toggleZoomAuto = (on: boolean) => {
    setZoomAutoUi(on);
    try {
      localStorage.setItem('vuelo-zoomauto', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => game.current?.setZoomAuto(zoomAuto), [zoomAuto]);
  // PC: fly with the mouse (on by default): the nose follows the cursor, the buttons fire.
  const [ratonOn, setRatonOn] = useState(() => {
    try {
      return localStorage.getItem('vuelo-raton') !== '0';
    } catch {
      return true;
    }
  });
  const toggleRaton = (on: boolean) => {
    setRatonOn(on);
    try {
      localStorage.setItem('vuelo-raton', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
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

  // «Modo GORE» (blood, mice blown to pieces): opt-in, off by default, remembered on this device.
  // The +18 (gore) version needs an adult's confirmation first, kept on this device only.
  const mayorEdad = () => {
    try {
      return !!localStorage.getItem('vuelo-gore-18');
    } catch {
      return false;
    }
  };
  const [gore, setGore] = useState(() => {
    try {
      return localStorage.getItem('vuelo-gore') === '1' && !!localStorage.getItem('vuelo-gore-18');
    } catch {
      return false;
    }
  });
  const [avisoGore, setAvisoGore] = useState(false);
  const toggleGore = (on: boolean) => {
    if (on && !mayorEdad()) {
      setAvisoGore(true);
      return;
    }
    setGore(on);
    game.current?.setGore(on);
    try {
      localStorage.setItem('vuelo-gore', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    game.current?.setGore(gore);
  }, [gore]);

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
      if (e.code === 'Escape' && (phase === 'creditos' || phase === 'ajustes' || (phase === 'menu' && !confirmado))) setPhase('titulo');
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
  // Touch control scheme, remembered on this device.
  const [control, setControl] = useState<Control>(() => {
    try {
      const v = localStorage.getItem('vuelo-control') as Control | null;
      if (v && CONTROLES.some((c) => c.id === v)) return v;
    } catch {
      /* private mode */
    }
    return 'mitades';
  });
  const elegirControl = (c: Control) => {
    setControl(c);
    try {
      localStorage.setItem('vuelo-control', c);
    } catch {
      /* private mode */
    }
    // iOS asks for permission to read the tilt, and only from a tap.
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (c === 'volante' && DM?.requestPermission) DM.requestPermission().catch(() => {});
    neutro.current = null;
    game.current?.girar(0);
    game.current?.apuntar(null);
    game.current?.touch({ x: 0, y: 0 });
  };
  // Joystick: where the thumb landed (the base) and where it is now, in screen px.
  const [stick, setStick] = useState<{ id: number; bx: number; by: number; x: number; y: number } | null>(null);
  const neutro = useRef<number | null>(null);
  const [inclinacion, setInclinacion] = useState(0);
  // «Volante»: tilt the phone like a steering wheel; the lean when it starts is neutral.
  useEffect(() => {
    if (phase !== 'play' || !touchUi || control !== 'volante' || paused) return;
    const onMove = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const ang = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
      // Gravity in screen coordinates: x across the screen.
      const gx = g.x * Math.cos(ang) + g.y * Math.sin(ang);
      if (neutro.current === null) neutro.current = gx;
      const k = Math.max(-1, Math.min(1, -(gx - neutro.current) / 4.5));
      game.current?.girar(k);
      setInclinacion(Math.round(k * 10) / 10);
    };
    window.addEventListener('devicemotion', onMove);
    return () => {
      window.removeEventListener('devicemotion', onMove);
      game.current?.girar(0);
    };
  }, [phase, touchUi, control, paused]);
  // No sound baking while flying (it would hitch frames); it resumes in menus and pause.
  useEffect(() => AB.pausarHorneado(phase === 'play' && !paused), [phase, paused]);
  // PC mouse mode: the cursor over the sky steers, left button = machine gun, right = missile.
  const conRaton = phase === 'play' && !touchUi && ratonOn && !paused;
  useEffect(() => {
    const g = game.current;
    const box = boxRef.current;
    if (!g || !box) return;
    g.setModoRaton(conRaton);
    if (!conRaton) return;
    const mueve = (e: MouseEvent) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (r) g.ratonEn(e.clientX - r.left, e.clientY - r.top);
    };
    const sale = () => g.ratonEn(null);
    // Left: machine gun; right: flares; middle: bomb (missiles on Space).
    const baja = (e: MouseEvent) => {
      if (e.button === 0) g.touch({ gun: true });
      else if (e.button === 2) g.touch({ flare: true });
      else if (e.button === 1) {
        e.preventDefault();
        g.touch({ bomb: true });
      }
    };
    const sube = (e: MouseEvent) => {
      if (e.button === 0) g.touch({ gun: false });
      else if (e.button === 2) g.touch({ flare: false });
      else if (e.button === 1) g.touch({ bomb: false });
    };
    const menu = (e: Event) => e.preventDefault();
    box.style.cursor = 'crosshair';
    box.addEventListener('mousemove', mueve);
    box.addEventListener('mouseleave', sale);
    box.addEventListener('mousedown', baja);
    window.addEventListener('mouseup', sube);
    box.addEventListener('contextmenu', menu);
    return () => {
      box.style.cursor = '';
      box.removeEventListener('mousemove', mueve);
      box.removeEventListener('mouseleave', sale);
      box.removeEventListener('mousedown', baja);
      window.removeEventListener('mouseup', sube);
      box.removeEventListener('contextmenu', menu);
      g.touch({ gun: false, flare: false, bomb: false });
      g.ratonEn(null);
    };
  }, [conRaton]);
  // «Tocar»: the plane flies towards the finger.
  const puntoEnCanvas = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] as const : null;
  };
  const fingers = useRef(new Map<number, 1 | -1>());
  const [turning, setTurning] = useState(0);
  /*
   * First flight on a touch screen: three short steps (turn with both halves, fire a
   * missile, drop flares), each one gone once it's done; then never again on this device.
   * 0…2 = the step showing, 3 = done.
   */
  const [tuto, setTuto] = useState(() => {
    try {
      return localStorage.getItem('vuelo-tutorial') === '1' ? 3 : 0;
    } catch {
      return 3;
    }
  });
  const tutoRef = useRef(tuto);
  tutoRef.current = tuto;
  const pasoTuto = useCallback((hecho: number) => {
    if (tutoRef.current !== hecho) return;
    const sig = hecho + 1;
    tutoRef.current = sig;
    setTuto(sig);
    if (sig >= 3) {
      try {
        localStorage.setItem('vuelo-tutorial', '1');
      } catch {
        /* private mode */
      }
    }
  }, []);
  // Step 1 is done when both halves have been held a moment (one climbs, the other dives).
  const giroTuto = useRef({ lado: 0, desde: 0, usados: new Set<number>() });
  const applyTurn = () => {
    let l = false, r = false;
    for (const side of fingers.current.values()) {
      if (side === 1) l = true;
      else r = true;
    }
    const dir = l === r ? 0 : l ? 1 : -1;
    game.current?.steer(dir);
    setTurning(dir);
    const gt = giroTuto.current;
    const now = performance.now();
    if (gt.lado && now - gt.desde > 350) gt.usados.add(gt.lado);
    gt.lado = dir;
    gt.desde = now;
    if (gt.usados.size === 2) pasoTuto(0);
  };
  // Other touch schemes have their own steering hint: the tutorial starts at the weapons.
  useEffect(() => {
    if (control !== 'mitades') pasoTuto(0);
  }, [control, pasoTuto]);
  // The flares step can't wait for a missile forever.
  useEffect(() => {
    if (tuto !== 2 || phase !== 'play' || paused) return;
    const id = window.setTimeout(() => pasoTuto(2), 15000);
    return () => window.clearTimeout(id);
  }, [tuto, phase, paused, pasoTuto]);
  /** Ajustes: show the first-flight steps again. */
  const repetirTuto = () => {
    try {
      localStorage.removeItem('vuelo-tutorial');
    } catch {
      /* private mode */
    }
    giroTuto.current = { lado: 0, desde: 0, usados: new Set<number>() };
    // The turning step is only for «Pantalla dividida».
    const desde = control === 'mitades' ? 0 : 1;
    tutoRef.current = desde;
    setTuto(desde);
  };
  // Once airborne; it steps aside for the missile alarm, which uses the same spot.
  const tutoVisible = phase === 'play' && touchUi && !paused && !cine && tuto < 3 && !!hud && !hud.enTierra && !hud.resumen && !hud.warn;

  // Phones: the thumb buttons' width along the right edge (the camera frames the plane in
  // the rest), and the radar's slot in the HUD bar, measured and handed to the engine.
  const botonesRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLSpanElement>(null);
  const [derechaBotones, setDerechaBotones] = useState(0);
  const conBotones = phase === 'play' && touchUi && !paused;
  useEffect(() => {
    if (!conBotones) return;
    const medir = () => {
      const b = botonesRef.current?.getBoundingClientRect();
      const px = b ? Math.max(0, window.innerWidth - b.left) : 0;
      setDerechaBotones(px);
      game.current?.setDerecha(px);
      const r = radarRef.current?.getBoundingClientRect();
      // The radar hangs from the HUD bar, so it must also end left of the key column.
      game.current?.setRadar(r ? { x: b ? Math.min(r.right, b.left - 6) : r.right, y: r.top } : null);
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (botonesRef.current) ro.observe(botonesRef.current);
    if (barraRef.current) ro.observe(barraRef.current);
    window.addEventListener('resize', medir);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, [conBotones, movil, barraH]);
  useEffect(() => {
    if (movil) return;
    game.current?.setRadar(null);
  }, [movil]);
  // A missile locking on: a double buzz, the same moment the flares key starts blinking.
  // The nuke key leaves with the last nuke: if it was held, its «up» never comes and the next nuke wouldn't fire.
  const hayNukes = !!hud?.nukes;
  useEffect(() => {
    if (!hayNukes) game.current?.touch({ nuke: false });
  }, [hayNukes]);
  const avisoMisil = phase === 'play' && !!hud?.warn && touchUi;
  useEffect(() => {
    if (avisoMisil) vibrar([30, 40, 30]);
  }, [avisoMisil]);
  const onSkyDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (control === 'volante') return;
    if (control === 'tocar') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that already ended */
      }
      const q = puntoEnCanvas(e);
      if (q) game.current?.apuntar(q[0], q[1]);
      return;
    }
    if (control === 'joystick') {
      const box0 = e.currentTarget.getBoundingClientRect();
      // The stick lives on the left half; the right is for the weapon buttons.
      if (stick || e.clientX - box0.left > box0.width * 0.55) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that already ended */
      }
      setStick({ id: e.pointerId, bx: e.clientX, by: e.clientY, x: e.clientX, y: e.clientY });
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const side: 1 | -1 = e.clientX - box.left < box.width / 2 ? 1 : -1;
    // No nitro from the sky any more: quick taps there are turn nudges (the nitro is
    // a double tap on the accelerate button).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that already ended */
    }
    fingers.current.set(e.pointerId, side);
    applyTurn();
  };
  const onSkyMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (control === 'tocar' && e.buttons) {
      const q = puntoEnCanvas(e);
      if (q) game.current?.apuntar(q[0], q[1]);
    } else if (control === 'joystick' && stick && e.pointerId === stick.id) {
      const R = 46;
      let dx = e.clientX - stick.bx, dy = e.clientY - stick.by;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      setStick({ ...stick, x: stick.bx + dx, y: stick.by + dy });
      // Screen direction where to fly (up is +y for the game), with a small dead zone.
      const k = Math.max(0, (Math.min(d, R) - 6) / (R - 6));
      game.current?.touch({ x: d > 6 ? (dx / Math.max(1, Math.hypot(dx, dy))) * k : 0, y: d > 6 ? (-dy / Math.max(1, Math.hypot(dx, dy))) * k : 0 });
    }
  };
  const onSkyUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (control === 'tocar') {
      game.current?.apuntar(null);
      return;
    }
    if (control === 'joystick') {
      if (stick && e.pointerId === stick.id) {
        setStick(null);
        game.current?.touch({ x: 0, y: 0 });
      }
      return;
    }
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
      if (key === 'fire') pasoTuto(1);
      else if (key === 'flare') pasoTuto(2);
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

  // Story queue: a boss that leaves the HUD while the game goes on was beaten
  // (Margarita on her cart, her carrier, her fighter); flying bosses come
  // through `onJefeVencido`. Losing or leaving the game forgets the queue.
  const jefeAntes = useRef<string | null>(null);
  const jefeAhora = phase === 'play' ? hud?.boss?.name ?? null : null;
  useEffect(() => {
    const antes = jefeAntes.current;
    jefeAntes.current = jefeAhora;
    if (phase !== 'play') {
      setCola((c) => (c.length ? [] : c));
      return;
    }
    if (antes && antes !== jefeAhora) encolar(HI.guionDeJefe(antes));
  }, [phase, jefeAhora, encolar]);
  // The first trip to each map: its chapter, on the wave card that announces it.
  const destino = tiendaAbierta ? hud?.resumen?.destino ?? '' : '';
  useEffect(() => {
    if (destino) encolar(HI.guionDeMapa(destino));
  }, [destino, encolar]);
  useEffect(() => {
    if (phase !== 'play' || !tiendaAbierta || cine || paused || hangar || !cola.length) return;
    // A beat after the card shows, so it doesn't jump in the player's face.
    const id = window.setTimeout(() => {
      setCola((c) => c.slice(1));
      setCine({ guion: cola[0] });
    }, 700);
    return () => window.clearTimeout(id);
  }, [phase, tiendaAbierta, cine, paused, hangar, cola]);
  // The world holds still under an in-game scene (and its sounds stop).
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const enCine = !!cine && phase === 'play';
  useEffect(() => {
    if (!enCine) return;
    game.current?.setPaused(true);
    return () => game.current?.setPaused(pausedRef.current);
  }, [enCine]);
  const finCine = useCallback(() => {
    const luego = cine?.luego;
    setCine(null);
    luego?.();
  }, [cine]);

  const elegido = ESCUADRON.find((p) => p.id === quien)!;
  const spec = elegido.spec;

  return (
    <div className="pixel-isla fixed inset-0 overflow-hidden select-none font-cozy text-[#5b4636] touch-none">
      <div ref={boxRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block" aria-label="Escuadrón Dui: juego de aviones" />
      </div>

      {/* Top bar: the instrument panel on the left, the cockpit switches on the right. */}
      <div
        ref={barraRef}
        className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 ${
          movil
            ? 'p-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pl-[max(0.375rem,env(safe-area-inset-left))] pr-[max(0.375rem,env(safe-area-inset-right))]'
            : 'p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]'
        }`}
      >
        <div className={`pointer-events-auto flex flex-wrap items-center ${movil ? 'gap-1' : 'gap-2'}`}>
          {phase === 'intro' || phase === 'titulo' || phase === 'creditos' || phase === 'ajustes' ? null : phase === 'menu' ? (
            <span className={`${chip} px-3`}>
              <Px i="avion" s={ic} />
              <span className="hud-lectura text-[#fff8e7]">Escuadrón Dui</span>
            </span>
          ) : (
            hud && (
              <>
                {/* Airframe: planes left, the hull's segments, and the «Salud» armour. */}
                <span className={`${chip} ${hud.lost.length ? 'hud-danado' : ''}`}>
                  <span className="inline-flex items-center gap-1" title="Aviones que te quedan" aria-label={`Aviones: ${hud.lives}`}>
                    <Px i="avion" s={ic} />
                    <span className="hud-lectura">×{hud.lives}</span>
                  </span>
                  <span className="hud-sep" />
                  <span
                    className="inline-flex items-center gap-1"
                    title={hud.lost.length ? `Dañado: ${hud.lost.join(', ')}` : 'Avión intacto'}
                    aria-label={`Blindaje: ${hud.hp} de ${hud.hpMax}${hud.lost.length ? `. Perdiste ${hud.lost.join(', ')}` : ''}`}
                  >
                    <Segs
                      n={hud.hp}
                      max={hud.hpMax}
                      ancho={movil ? 5 : 7}
                      color={hud.hp / hud.hpMax > 0.5 ? '#7af0a0' : hud.hp / hud.hpMax > 0.25 ? '#ffd84a' : '#ff5a6a'}
                      alerta={hud.hp / hud.hpMax <= 0.25}
                    />
                    {!movil && <span className="hud-lectura text-[0.8em] text-[#c8c0e0]">{hud.hp}/{hud.hpMax}</span>}
                  </span>
                  {hud.mejoras.coraza > 0 && (
                    <>
                      <span className="hud-sep" />
                      <span className="inline-flex items-center gap-1" title="Coraza de la mejora «Salud»: cada una absorbe un golpe" aria-label={`Coraza: ${hud.mejoras.coraza}`}>
                        <Px i="corazon" s={ic} />
                        <span className="hud-lectura text-[#ff8ab8]">×{hud.mejoras.coraza}</span>
                      </span>
                    </>
                  )}
                </span>
                <span className={`${chip} ${hud.stolen ? 'hud-alerta' : ''}`} title="Pescado en la despensa" aria-label={`Despensa: ${hud.meta} de ${hud.metaMax}`}>
                  <Sockets i="pez" n={hud.meta} max={hud.metaMax} s={ic} />
                </span>
                <span className={`${chip} hud-panel-crema`} title="Puntos" aria-label={`Puntos: ${hud.score}`}>
                  <Px i="estrella" s={ic} />
                  <Contador v={hud.score} />
                </span>
                {hud.mision && !hud.resumen && !movil && (
                  <span
                    className={`hud-panel min-h-8 max-w-[22rem] gap-1.5 whitespace-normal px-2 py-1 text-xs ${hud.mision.hecha ? 'hud-panel-ok' : hud.mision.fallida ? 'opacity-70' : ''}`}
                    aria-label={`Misión${hud.mision.hecha ? ' cumplida' : hud.mision.fallida ? ' fallida' : ''}: ${hud.mision.texto}${hud.mision.meta > 1 && !hud.mision.hecha ? `, ${hud.mision.prog} de ${hud.mision.meta}` : ''}`}
                  >
                    <Px i={hud.mision.hecha ? 'medalla' : 'diana'} s={ic} />
                    <span className={`font-black leading-tight ${hud.mision.fallida ? 'line-through' : ''}`}>{hud.mision.texto}</span>
                    {hud.mision.meta > 1 && !hud.mision.hecha && <span className="hud-lectura text-[#ffd84a]">{hud.mision.prog}/{hud.mision.meta}</span>}
                  </span>
                )}
                {hud.nukes > 0 && (
                  <span className={`${chip} hud-panel-lima`} title="Bomba nuclear: tecla N o el botón nuclear" aria-label={`Bombas nucleares: ${hud.nukes}`}>
                    <Px i="nuclear" s={ic} />
                    <span className="hud-lectura">×{hud.nukes}</span>
                  </span>
                )}
                {hud.boost && (
                  <span className={`${chip} hud-panel-rosa`} title="Mejora especial de un avión derribado" aria-label={`Mejora ${hud.boost}: ${hud.boostT} segundos`}>
                    <Px i="estrella" s={ic} className="hud-parpadeo" />
                    <span className="font-black">{hud.boost}</span>
                    <span className="hud-lectura">{hud.boostT}s</span>
                  </span>
                )}
                <span className={chip} aria-label={`Oleada ${hud.wave}, quedan ${hud.left} ratones`}>
                  <span className="inline-flex items-center gap-1" title="Oleada">
                    <Px i="ola" s={ic} />
                    <span className="hud-lectura">{hud.wave}</span>
                  </span>
                  <span className="hud-sep" />
                  <span className="inline-flex items-center gap-1" title="Ratones que quedan">
                    <Px i="raton" s={ic} />
                    <span className="hud-lectura">{hud.left}</span>
                  </span>
                </span>
                <span className={chip}>
                  <span className="inline-flex items-center gap-1" title="Altura" aria-label={`Altura: ${hud.altitude.toLocaleString('es-CL')} metros`}>
                    <Px i="montana" s={ic} />
                    <span className="hud-lectura">
                      {hud.altitude.toLocaleString('es-CL')}
                      <small className={`ml-0.5 text-[#c8c0e0] ${movil ? 'text-[1em]' : 'text-[0.75em]'}`}>m</small>
                    </span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1 max-[899px]:hidden"
                    title="Viento: empuja las bombas y el humo"
                    aria-label={`Viento ${Math.abs(hud.wind)} hacia la ${hud.wind < 0 ? 'izquierda' : 'derecha'}`}
                  >
                    <span className="hud-sep" />
                    <Px i="manga" s={ic} style={hud.wind < 0 ? { transform: 'scaleX(-1)' } : undefined} />
                    <span className="hud-viento" aria-hidden>
                      {[0, 1, 2].map((k) => (
                        <i key={k} className={k < Math.min(3, Math.ceil(Math.abs(hud.wind) / 4)) ? 'on' : ''} style={hud.wind < 0 ? { transform: 'scaleX(-1)' } : undefined} />
                      ))}
                    </span>
                  </span>
                </span>
                {/* The weapons rack: one socket per hardpoint, then nitro and the gun's heat. */}
                <span
                  className={chip}
                  title="Armamento: atrapa los globos de los enemigos para ganar más puestos"
                  aria-label={`Misiles ${hud.ammo} de ${hud.rack}, bombas ${hud.bombs} de ${hud.bombMax}, bengalas ${hud.flares} de ${hud.flareMax}`}
                >
                  <Sockets i="misil" n={hud.ammo} max={hud.rack} s={ic} />
                  <span className="hud-sep" />
                  <Sockets i="bomba" n={hud.bombs} max={hud.bombMax} s={ic} />
                  <span className="hud-sep" />
                  <Sockets i="bengala" n={hud.flares} max={hud.flareMax} s={ic} />
                  <span className="hud-sep" />
                  <span
                    className="inline-flex items-center gap-1"
                    title="Nitro: mantén acelerar; se recalienta como la metralla"
                    aria-label={`Nitro: ${hud.nitro === 'activo' ? 'encendido' : hud.nitro === 'listo' ? 'listo' : 'recalentado'}, ${Math.round(hud.nitroK * 100)} % frío`}
                  >
                    <Px i="llama" s={ic} className={hud.nitro === 'activo' ? 'hud-parpadeo' : hud.nitro === 'carga' ? 'opacity-50' : ''} />
                    <Segs
                      n={Math.ceil(hud.nitroK * 5)}
                      max={5}
                      ancho={movil ? 3 : 4}
                      color={hud.nitro === 'activo' ? '#7ad8ff' : hud.nitro === 'listo' ? '#ffd84a' : '#f0a45d'}
                    />
                    {hud.nitro === 'carga' && !movil && <span className="hud-lectura text-[0.75em] text-[#c8c0e0]">{Math.round(hud.nitroK * 100)}%</span>}
                  </span>
                  {/* Phones: the gun fires by itself and its key says «¡Calor!» when hot, so the heat bar gives its room to the radar. */}
                  {!movil && (
                    <>
                      <span className="hud-sep" />
                      <span
                        className="inline-flex items-center gap-1"
                        title="Metralla: si la mantienes mucho se calienta y debe enfriarse"
                        aria-label={hud.hot ? 'Metralla recalentada' : `Metralla: calor ${Math.round(hud.heat * 100)} %`}
                      >
                        <Px i="bala" s={ic} />
                        <Segs
                          n={hud.hot ? 6 : Math.ceil(hud.heat * 6)}
                          max={6}
                          ancho={4}
                          color={hud.hot ? '#ff5a6a' : (k: number) => (k < 3 ? '#7af0a0' : k < 5 ? '#ffd84a' : '#ff5a6a')}
                          alerta={hud.hot}
                        />
                      </span>
                    </>
                  )}
                </span>
              </>
            )
          )}
        </div>
        <div className={`pointer-events-auto flex items-center justify-end gap-2 ${movil ? 'shrink-0 flex-nowrap' : 'flex-wrap'}`}>
          {/* Phones: the radar is drawn in this slot (left of the pause key), so the HUD chips
              never run under it and the thumb buttons get the whole right edge below. */}
          {phase === 'play' && movil && <span ref={radarRef} aria-hidden className="pointer-events-none block h-5 w-[150px] shrink-0" />}
          {phase === 'play' && (
            <button type="button" aria-label={paused ? 'Seguir' : 'Pausa'} title={paused ? 'Seguir (Esc)' : 'Pausa (Esc o P)'} onClick={togglePause} className={`${tecla} ${movil ? "relative after:absolute after:-inset-2 after:content-['']" : ''}`}>
              <Px i={paused ? 'play' : 'pausa'} s={ic} />
            </button>
          )}
          {phase === 'play' && hud && !movil && (
            <button type="button" aria-label={`Cielo: ${CIELO_NOMBRE[hud.sky]}. Cambiar`} title="Cambiar el cielo" onClick={() => game.current?.cycleSky()} className={tecla}>
              <Px i={CIELO_ICONO[hud.sky] ?? 'auto'} s={ic} />
            </button>
          )}
          {phase === 'play' && hud && hud.zoom[0] > 1 && !movil && (
            <button type="button" aria-label={hud.zoom[1] === hud.zoom[0] - 1 ? 'Volver a acercar' : 'Alejar la cámara'} title="Zoom (Z)" onClick={() => game.current?.zoom()} className={tecla}>
              <Px i={hud.zoom[1] ? 'lupaMas' : 'lupaMenos'} s={ic} />
            </button>
          )}
          {!movil && (
            <>
              <button type="button" aria-label={muted ? 'Activar sonido' : 'Silenciar'} title={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute} className={tecla}>
                <Px i={muted ? 'mudo' : 'parlante'} s={ic} />
              </button>
              <button type="button" aria-label="Ir al portafolio danieleduardo.cl" onClick={() => navigate('/clasico')} className={`${TECLA} hud-key-amarilla px-3`}>
                danieleduardo.cl
              </button>
            </>
          )}
        </div>
      </div>

      {/* First flight on a phone: one short step at a time, low and left of the thumb
          buttons (the plane mostly flies in the upper half, where a card would hide it). */}
      {tutoVisible && (
        <div
          className="pointer-events-none absolute left-0 z-10 flex justify-center px-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
          style={{ right: derechaBotones }}
        >
          <div role="status" className="hud-panel max-w-[24rem] items-center gap-2 whitespace-normal px-2.5 py-1.5 text-xs font-black leading-snug">
            <span className="hud-socket grid h-7 w-8 shrink-0 place-items-center text-[11px] text-[#ffd84a]">{tuto + 1}/3</span>
            <span>
              {tuto === 0
                ? 'Mantén un lado de la pantalla para girar: «Sube» levanta la nariz, «Baja» la baja.'
                : tuto === 1
                  ? 'La metralla dispara sola. Toca Misil para lanzar uno.'
                  : 'Si un misil te sigue, Bengalas parpadea: tócalo.'}
            </span>
          </div>
        </div>
      )}
      {/* Wave banner and missile alarm. */}
      {phase === 'play' && hud?.banner && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 text-center ${hud.boss ? '' : movil ? '' : 'top-[22%]'}`} style={hud.boss ? { top: barraH + 52 } : movil ? { top: barraH + 6 } : undefined}>
          <span className={`hud-panel hud-panel-crema max-w-[90vw] justify-center whitespace-normal font-black ${movil ? 'gap-1.5 px-3 py-1 text-sm' : 'gap-3 px-6 py-3 text-2xl md:text-3xl'}`}>
            {iconoDe(hud.banner) && <Px i={iconoDe(hud.banner)!} s={movil ? 2 : 4} />}
            <span>{limpio(hud.banner)}</span>
          </span>
        </div>
      )}
      {phase === 'play' && zoneSign && !paused && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 text-center ${movil ? '' : 'top-[14%]'}`} style={movil ? { top: barraH + 44 } : undefined}>
          <span className={`hud-panel gap-2 font-black tracking-wide text-[#fff6d0] ${movil ? 'px-3 py-1 text-sm' : 'px-5 py-2 text-lg'}`}>
            <Px i="montana" s={2} />
            {limpio(zoneSign)}
          </span>
        </div>
      )}
      {/* Cockpit alerts, all in one place: up to three, most urgent first, under the HUD bar on the left. */}
      {phase === 'play' && !paused && !hud?.resumen && !!hud?.alertas.length && (
        <div aria-live="polite" className="pointer-events-none absolute left-0 z-20 flex flex-col items-start gap-1 pl-[max(0.5rem,env(safe-area-inset-left))]" style={{ top: barraH + (hud.boss ? 46 : 4) + (hud.radio ? (movil ? 58 : 66) : 0) }}>
          {hud.alertas.slice(0, movil ? 2 : 3).map((a) => (
            <span
              key={a.k}
              className={`hud-panel gap-1 px-2 py-0.5 font-black uppercase tracking-wide ${movil ? 'text-[10px]' : 'text-xs'} ${
                a.nivel === 'rojo' ? 'hud-panel-roja hud-alerta-suave' : a.nivel === 'verde' ? 'hud-panel-ok hud-parpadeo' : 'text-[#ffd84a]'
              }`}
            >
              {a.t}
            </span>
          ))}
        </div>
      )}
      {/* Phones: low, beside the blinking flares key it's about (the plane is usually mid-screen). */}
      {phase === 'play' && hud?.warn && !paused && (
        <div
          className={`pointer-events-none absolute z-10 text-center ${movil ? 'left-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))]' : 'inset-x-0 top-[38%]'}`}
          style={movil ? { right: derechaBotones } : undefined}
        >
          <span className="hud-panel hud-panel-roja hud-alerta-suave gap-2 px-4 py-1.5 text-sm font-black">
            <Px i="alerta" s={2} />
            ¡Misil! Gira fuerte o suelta bengalas
          </span>
        </div>
      )}
      {phase === 'play' && hud?.pista && !hud.resumen && !paused && !tutoVisible && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4 ${hud.enTierra && touchUi ? '' : 'bottom-28 [@media(max-height:500px)]:bottom-24'}`}
          style={hud.enTierra && touchUi ? { top: barraH + (hud.banner ? 48 : 6) } : undefined}
        >
          <span className={`hud-panel gap-2 whitespace-normal px-3 py-1.5 text-center text-sm font-black ${touchUi ? 'max-w-[55%] text-xs' : ''}`}>
            <Px i="bombilla" s={2} />
            <span>{limpio(hud.pista)}</span>
          </span>
        </div>
      )}
      {phase === 'play' && hud?.resumen && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-[45] flex justify-center px-4 [@media(max-height:500px)]:top-2">
          <div className="w-full max-w-sm animate-[aparece_0.35s_ease-out] overflow-auto rounded-[1.6rem] bg-[#fff8e7]/95 p-4 text-center [@media(max-height:500px)]:pointer-events-auto [@media(max-height:500px)]:max-h-[calc(100dvh-1rem)] [@media(max-height:500px)]:p-2 shadow-[0_6px_0_rgba(91,70,54,0.2)] ring-4 ring-[#ead6b3]">
            <div className="flex items-center justify-center gap-3">
              <img src={thumbs[quien].pilot} alt="" className="h-12 w-12 animate-bounce rounded-full bg-white p-0.5 ring-2 ring-[#f0a45d]" style={{ imageRendering: 'pixelated' }} />
              <h2 className="text-xl font-black text-[#e8742a]">¡Oleada {hud.resumen.oleada} superada!</h2>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5 text-[#6b4f3a]">
              {[
                ['raton', hud.resumen.enemigos, 'enemigos'],
                ['estrella', hud.resumen.puntos, 'puntos'],
                ['reloj', minSeg(hud.resumen.tiempo), 'tiempo'],
                ['pez', hud.resumen.pescado, 'pescado'],
                ['avion', hud.resumen.aviones, 'aviones'],
              ].map(([icon, value, label]) => (
                <div
                  key={label as string}
                  title={label === 'tiempo' ? `Tiempo de la oleada: ${duracion(hud.resumen!.tiempo)}` : undefined}
                  role="group"
                  aria-label={label === 'tiempo' ? `Tiempo: ${duracion(hud.resumen!.tiempo)}` : `${label}: ${value}`}
                  className="hud-panel flex-col justify-center gap-1 px-1 py-1.5 [@media(max-height:500px)]:gap-0.5 [@media(max-height:500px)]:py-1">
                  <Px i={icon as PxIcon} s={2} />
                  <div className="hud-lectura text-sm">{value}</div>
                  <div className="text-[9px] font-bold text-[#c8c0e0]">{label}</div>
                </div>
              ))}
            </div>
            {hud.resumen.mision && (
              <p className={`mt-2 flex items-center justify-center gap-1.5 text-sm font-black ${hud.resumen.cumplida ? 'text-[#2f8a4a]' : 'text-[#a08060]'}`}>
                <Px i={hud.resumen.cumplida ? 'medalla' : 'diana'} s={2} tinta={hud.resumen.cumplida ? undefined : '#c8b89a'} />
                <span>
                  Misión: {limpio(hud.resumen.mision)} {hud.resumen.cumplida ? '✓' : ''}
                </span>
              </p>
            )}
            {hud.resumen.destino ? (
              <p className="hud-panel hud-panel-cielo hud-alerta-suave mt-3 w-full justify-center gap-1.5 whitespace-normal px-3 py-1 text-sm font-black">
                <Px i="llama" s={2} />
                <span>
                  ¡Super nitro! Rumbo{' '}
                  {({ oceano: 'al mar de San Antonio', valparaiso: 'a Valparaíso', tormenta: 'a la tormenta', valle: 'a San Antonio' } as Record<string, string>)[hud.resumen.destino]}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-xs font-bold text-[#8a6e55]">Próxima oleada: {limpio(String(hud.resumen.siguiente))}</p>
            )}
            {hud.resumen.dato && (
              <p className="mt-2 flex items-start gap-2 rounded-xl bg-[#ffe3a3]/60 px-3 py-1.5 text-left text-xs font-bold text-[#6b4f3a] [@media(max-height:500px)]:hidden">
                <Px i="bombilla" s={2} className="mt-0.5" />
                <span>¿Sabías que…? {limpio(hud.resumen.dato)}</span>
              </p>
            )}
            {hud.resumen.nuevos && hud.resumen.nuevos.length > 0 && (
              <p className="hud-panel hud-alerta-suave mt-2 w-full justify-center gap-1.5 whitespace-normal px-3 py-1 text-sm font-black text-[#ffd84a]">
                <Px i="candado" s={2} />
                <span>Nuevo en el hangar: {limpio(HG.resumirNuevos(hud.resumen.nuevos))}</span>
              </p>
            )}
            {hud.mejoras.tienda && (
              // The upgrade shop: the break waits until «Seguir».
              <div className="hud-panel pointer-events-auto mt-3 flex w-full flex-col items-stretch whitespace-normal p-2">
                <p className="flex items-center justify-center gap-1.5 text-sm font-black">
                  <Px i="estrella" s={2} />
                  Mejoras: tienes <span className="hud-lectura">{hud.mejoras.puntos}</span> {hud.mejoras.puntos === 1 ? 'punto' : 'puntos'}
                </p>
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
                        aria-label={`${m.nombre}: nivel ${nivel} de 5. ${max ? 'Al máximo' : `Cuesta ${costo} ${costo === 1 ? 'punto' : 'puntos'}`}`}
                        className="hud-key hud-mejora flex-col gap-1 px-1 py-1.5 text-center [@media(max-height:500px)]:gap-0.5 [@media(max-height:500px)]:py-1"
                      >
                        <span className="hud-socket grid h-7 w-9 place-items-center [@media(max-height:500px)]:h-5 [@media(max-height:500px)]:w-8">
                          <Px i={m.icono} s={2} />
                        </span>
                        <div className="text-xs font-black">{m.nombre}</div>
                        <Segs n={nivel} max={5} ancho={6} color="#f0a45d" />
                        <div className="whitespace-normal text-[9px] font-bold opacity-80 [@media(max-height:500px)]:hidden">{m.efecto}</div>
                        <div className="flex items-center gap-1 text-[10px] font-black">
                          {max ? 'MÁX' : (
                            <>
                              {costo} <Px i="estrella" s={1.5} />
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => { menu.aceptar(); setHangar(true); }} className={`${TECLA} px-3`}>
                    <Px i="hangar" s={2} />
                    Hangar: {HG.especDe(hud.hangar.avion).real ?? HG.especDe(hud.hangar.avion).name}
                  </button>
                  <button type="button" ref={seguirRef} onClick={() => game.current?.cerrarTienda()} className={`${TECLA} hud-key-amarilla px-4`}>
                    Seguir
                    <Px i="play" s={1.5} />
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
        <div className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 ${movil ? '' : 'top-[30%]'}`} style={movil ? { top: barraH + (hud.banner ? 48 : 6) } : undefined}>
          <span
            role={hud.congelado ? 'alert' : 'status'}
            className={`hud-panel hud-panel-hielo gap-2 whitespace-normal px-4 py-1.5 text-center text-sm font-black ${hud.congelado ? 'hud-alerta-suave' : ''}`}
          >
            <Px i={hud.congelado ? 'hielo' : 'copo'} s={2} />
            {!hud.congelado && (
              <Segs n={Math.round(hud.hielo * 6)} max={6} ancho={4} color="#4a7ae0" />
            )}
            <span>
              {hud.congelado
                ? '¡Avión congelado! Los controles no responden… cayendo hasta descongelar'
                : `¡Frío extremo! Baja o te congelarás · hielo ${Math.round(hud.hielo * 100)}%`}
            </span>
          </span>
        </div>
      )}
      {phase === 'play' && hud?.stall && !paused && (
        <div className={`pointer-events-none absolute bottom-20 z-10 text-center ${movil ? 'left-0' : 'inset-x-0'}`} style={movil ? { right: derechaBotones } : undefined}>
          <span className="hud-panel hud-panel-amarilla hud-alerta-suave gap-2 px-4 py-1.5 text-sm font-black">
            <Px i="alerta" s={2} />
            ¡Vas muy lento! Apunta hacia abajo y acelera
          </span>
        </div>
      )}
      {phase === 'play' && hud?.radio && !paused && !hud.resumen && <Radio key={hud.radio.texto + hud.radio.quien} quien={hud.radio.quien} texto={hud.radio.texto} top={barraH + (hud.boss ? 48 : 0)} />}
      {phase === 'play' && hud?.boss && (
        <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4" style={{ top: barraH }}>
          <div
            className="hud-panel hud-jefe flex w-full max-w-sm items-center gap-2 px-2 py-1.5"
            role="status"
            aria-label={`${limpio(hud.boss.name)}: ${Math.ceil(hud.boss.hp * 100)} % de vida`}
          >
            <span className="hud-socket grid h-8 w-8 shrink-0 place-items-center" aria-hidden>
              <Px i="abuela" s={2} />
            </span>
            <div className="min-w-0 flex-1" aria-hidden>
              <div className="flex items-center justify-between gap-2 text-xs font-black text-[#ffc8d8]">
                <span className="truncate">{limpio(hud.boss.name)}</span>
                <span className="hud-lectura">{Math.ceil(hud.boss.hp * 100)}%</span>
              </div>
              <div className="hud-jefe-barra mt-1">
                <div className="transition-[width] duration-200" style={{ width: `${hud.boss.hp * 100}%` }} />
              </div>
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
                <Key k="E (mantener)" label="Nitro (se recalienta)" on={hud?.nitro === 'activo'} />
                <Key k="E rápido ×3 · ×5 · ×7" label="Super · Hiper · Mega nitro (mientras sigas tocando o lo mantengas)" />
                <Key k="Q · Ctrl" label="Frenar (apaga el nitro)" on={hud?.throttle === -1} />
                {ratonOn ? (
                  <>
                    <Key k="Mouse" label="El avión sigue al cursor" />
                    <Key k="Clic izq." label="Metralla" />
                    <Key k="Clic der." label="Bengalas" />
                    <Key k="Espacio" label="Misil" />
                    <Key k="B · K · rueda clic" label="Bomba" />
                  </>
                ) : (
                  <>
                    <Key k="Espacio" label="Misil (sale por la nariz)" />
                    <Key k="K" label="Bomba" />
                  </>
                )}
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
                {ESCUADRON.map((p, i) => (
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
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#120c24]/50 via-transparent to-[#120c24]/50 p-4 [@media(max-height:500px)]:gap-3">
          <h1 className="logo-dui text-5xl font-black leading-none sm:text-7xl [@media(max-height:500px)]:text-4xl">
            ESCUADRÓN DUI
          </h1>
          {/* Phones in landscape: two columns, or the logo and the last buttons fall off the screen. */}
          <nav aria-label="Menú principal" className="flex w-full max-w-xs flex-col gap-2.5 [@media(max-height:500px)]:grid [@media(max-height:500px)]:max-w-lg [@media(max-height:500px)]:grid-cols-2 [@media(max-height:500px)]:gap-2">
            {saved && (
              <button type="button" autoFocus onClick={() => play(true)} className={`${GO} w-full [@media(max-height:500px)]:col-span-2`}>
                ▶ Continuar · oleada {saved.wave}
              </button>
            )}
            <button type="button" autoFocus={!saved} onClick={() => { menu.aceptar(); setPhase('menu'); }} className={saved ? `${BTN} h-12 w-full text-base` : `${GO} w-full`}>
              ✈️ {saved ? 'Nueva partida' : 'Jugar'}
            </button>
            <button type="button" onClick={() => { menu.aceptar(); setCine({ guion: 'prologo' }); }} className={`${BTN} inline-flex h-12 w-full items-center justify-center gap-2 text-base`}>
              <Px i="pez" s={2} />
              Ver historia
            </button>
            <button type="button" onClick={() => { menu.aceptar(); setPhase('ajustes'); }} className={`${BTN} h-12 w-full text-base`}>
              ⚙️ Ajustes
            </button>
            <button type="button" onClick={() => { menu.aceptar(); setPhase('creditos'); }} className={`${BTN} h-12 w-full text-base`}>
              🎬 Créditos
            </button>
            {!instalada && (instalar || esIos) && (
              <button
                type="button"
                onClick={() => {
                  menu.aceptar();
                  if (instalar) instalar.prompt().then(() => setInstalar(null)).catch(() => {});
                  else setAyudaIos((v) => !v);
                }}
                className={`${BTN} h-12 w-full text-base`}
              >
                ⬇️ Instalar la app
              </button>
            )}
            {ayudaIos && (
              <p className="rounded-xl bg-[#1a1438]/85 px-3 py-2 text-left text-xs font-bold text-white ring-2 ring-[#7af0a0]/60 [@media(max-height:500px)]:col-span-2">
                En iPhone/iPad: toca <b>Compartir</b> (el cuadrado con la flecha) y luego <b>«Agregar a inicio»</b>. Se abrirá a pantalla completa como una app.
              </p>
            )}
            <button type="button" aria-label="Ir al portafolio danieleduardo.cl" onClick={() => navigate('/clasico')} className={`${BTN} h-12 w-full text-base`}>
              🏠 danieleduardo.cl
            </button>
          </nav>
          <p className="text-xs font-bold text-white/80 drop-shadow">© 2026 {AUTOR} · danieleduardo.cl</p>
        </div>
      )}

      {/* Credits: a slow SNES-style roll; every role is the author's. */}
      {/* Settings from the title menu: sound, reduced motion and the touch control scheme. */}
      {phase === 'ajustes' && (
        <div role="dialog" aria-modal="true" aria-label="Ajustes" className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-[#120c24]/75 p-4">
          <div className="hud-panel w-full max-w-md flex-col items-stretch gap-3 whitespace-normal p-4 text-left">
            <h2 className="logo-dui text-3xl font-black">Ajustes</h2>
            <div className="hud-ajustes">
              <label className="hud-ajuste">
                <span className="flex items-center gap-2">
                  <Px i={muted ? 'mudo' : 'parlante'} s={2} tinta="#fff8e7" />
                  Sonido
                </span>
                <input type="checkbox" role="switch" autoFocus checked={!muted} onChange={toggleMute} className="hud-switch" />
              </label>
              <label className="hud-ajuste">
                <span>
                  Menos movimiento
                  <small className="block text-[11px] font-bold text-[#c8c0e0]">Sin sacudidas ni destellos fuertes</small>
                </span>
                <input type="checkbox" role="switch" checked={calma} onChange={(e) => toggleCalma(e.target.checked)} className="hud-switch" />
              </label>
              <label className="hud-ajuste">
                <span>
                  Zoom automático
                  <small className="block text-[11px] font-bold text-[#c8c0e0]">A toda velocidad la cámara se aleja para ver lo que viene</small>
                </span>
                <input type="checkbox" role="switch" checked={zoomAuto} onChange={(e) => toggleZoomAuto(e.target.checked)} className="hud-switch" />
              </label>
              <label className="hud-ajuste">
                <span>
                  Versión +18 (GORE)
                  <small className="block text-[11px] font-bold text-[#c8c0e0]">Sangre y mutilaciones. Solo mayores de 18; pide confirmar la edad.</small>
                </span>
                <input type="checkbox" role="switch" checked={gore} onChange={(e) => toggleGore(e.target.checked)} className="hud-switch" />
              </label>
              {!touchUi && (
                <label className="hud-ajuste">
                  <span>
                    Apuntar con el mouse
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">El avión sigue al cursor. Clic izquierdo: metralla · clic derecho: bengalas · Espacio: misil · B: bomba</small>
                  </span>
                  <input type="checkbox" role="switch" checked={ratonOn} onChange={(e) => toggleRaton(e.target.checked)} className="hud-switch" />
                </label>
              )}
              {touchUi && (
                <label className="hud-ajuste">
                  <span>
                    Metralla automática
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">Dispara sola con un enemigo en la mira. Apagada, solo con el botón Balas</small>
                  </span>
                  <input type="checkbox" role="switch" checked={autoGun} onChange={(e) => toggleAutoGun(e.target.checked)} className="hud-switch" />
                </label>
              )}
              {touchUi && (
                <label className="hud-ajuste">
                  <span>
                    Vibración
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">Un toque corto al apretar y al acercarse un misil</small>
                  </span>
                  <input type="checkbox" role="switch" checked={vibra} onChange={(e) => toggleVibra(e.target.checked)} className="hud-switch" />
                </label>
              )}
              <div className="mt-2">
                <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-[#c8c0e0]">Control táctil {touchUi ? '' : '(en teléfonos y tablets)'}</div>
                <div role="radiogroup" aria-label="Control táctil" className="grid grid-cols-2 gap-1.5">
                  {CONTROLES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={control === c.id}
                      onClick={() => elegirControl(c.id)}
                      className={`${TECLA} !h-auto flex-col items-start whitespace-normal px-2.5 py-1.5 text-left ${control === c.id ? 'hud-key-amarilla' : ''}`}
                    >
                      <span className="text-xs font-black">{c.nombre}</span>
                      <span className="text-[11px] font-bold opacity-75">{c.texto}</span>
                    </button>
                  ))}
                </div>
                {touchUi && (
                  <button type="button" onClick={repetirTuto} disabled={tuto === 0} className={`${TECLA} mt-1.5 px-3 text-xs disabled:opacity-50`}>
                    {tuto === 0 ? 'El tutorial saldrá en el próximo vuelo' : 'Repetir el tutorial del primer vuelo'}
                  </button>
                )}
              </div>
            </div>
            <button type="button" onClick={() => { menu.volver(); setPhase('titulo'); }} className={`${TECLA} self-start px-3`}>
              ← Volver
            </button>
          </div>
        </div>
      )}

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

      {/* Character select, arcade style: five framed pilots, the chosen one big and animated; confirm and they strike a pose. */}
      {phase === 'menu' && (
        <div role="dialog" aria-modal="true" aria-label="Elige tu piloto" className={`absolute inset-0 ${hangar ? 'z-[45]' : 'z-30'} flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#120c24]/70 p-3 pt-16 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:pt-12`}>
          <div className="flex w-full max-w-5xl items-center justify-between gap-2">
            <button type="button" onClick={() => { menu.volver(); setPhase('titulo'); }} className={`${BTN} h-9`} disabled={!!confirmado}>← Volver</button>
            <h1 className="logo-dui text-3xl font-black sm:text-5xl [@media(max-height:500px)]:text-2xl">ELIGE TU PILOTO</h1>
            <span className="w-20" />
          </div>
          <div className="grid w-full max-w-5xl grid-cols-5 gap-1.5 sm:gap-3">
            {ESCUADRON.map((p) => {
              const sel = quien === p.id;
              const pose: Pose = confirmado === p.id ? 'listo' : sel ? 'elegido' : 'quieto';
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!!confirmado}
                  onClick={() => (sel ? confirmar() : elegir(p.id))}
                  aria-pressed={sel}
                  aria-label={`${p.pilot}, ${p.spec.name}`}
                  className={`tarjeta-piloto relative overflow-hidden rounded-xl text-center transition-transform duration-200 ${
                    sel ? 'z-10 scale-[1.04] ring-4 ring-[#ffd84a] shadow-[0_0_24px_rgba(255,216,74,0.6)]' : 'opacity-70 ring-2 ring-[#3a2a6a] hover:opacity-90'
                  } ${confirmado === p.id ? 'tarjeta-confirmada' : ''}`}
                >
                  <FondoTarjeta m={p.id} />
                  {sel && !confirmado && <span className="absolute left-1.5 top-1.5 z-10 rounded bg-[#ff4a5a] px-1.5 text-[10px] font-black text-white">P1</span>}
                  <div className="relative z-10 flex flex-col items-center px-0.5 pb-2 pt-2 sm:px-1">
                    <Retrato m={p.id} pose={pose} className="aspect-square w-full max-w-[10rem] [@media(max-height:500px)]:max-w-[4.5rem]" />
                    <span className="mt-1 max-w-full truncate text-[11px] font-black text-white drop-shadow-[0_2px_0_#3a2a6a] sm:text-xl [@media(max-height:500px)]:text-xs">{p.pilot.toUpperCase()}</span>
                    <span className="text-[9px] font-black leading-tight text-[#ffe3a3] drop-shadow sm:text-sm [@media(max-height:500px)]:text-[10px]">{p.spec.name}</span>
                    <img src={thumbs[p.id].plane} alt="" className="mt-1 h-6 w-auto sm:h-10 [@media(max-height:500px)]:hidden" style={{ imageRendering: 'pixelated' }} />
                  </div>
                  {confirmado === p.id && <span className="sello-listo absolute inset-x-0 top-1/3 z-20 text-lg font-black text-[#ffd84a] sm:text-4xl">¡LISTO!</span>}
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
                ▶ Continuar · {ESCUADRON.find((p) => p.id === saved.pilot)?.pilot}, oleada {saved.wave}
              </button>
            )}
            <button type="button" disabled={!!confirmado} onClick={() => { menu.aceptar(); setHangar(true); }} className={`${BTN} h-12`}>
              🛩️ Hangar · {HG.especDe(avion ?? CASA[quien]).real ?? HG.especDe(avion ?? CASA[quien]).name}
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
              piloto={quien}
              avion={avion ?? CASA[quien]}
              bomba={bomba ?? HG.especDe(avion ?? CASA[quien]).bomba}
              libres={HG.HANGAR.filter((a) => HG.avionLibrePara(a.id, quien)).map((a) => a.id)}
              bombas={HG.TIPOS_BOMBA.filter((b) => HG.bombaLibre(b, avion ?? CASA[quien]))}
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

      {cine && <Cinematica key={cine.guion} guion={cine.guion} piloto={quien} calma={calma} alTerminar={finCine} />}

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

      {/* Starts under the HUD bar (it stays on top, with the resume key): on short screens the plate would slide under the chips. */}
      {phase === 'play' && paused && (
        <div role="dialog" aria-modal="true" aria-labelledby="pausa-titulo" className="hud-pausa-fondo absolute inset-0 z-30 grid place-items-center overflow-auto p-4 [@media(max-height:500px)]:p-2" style={{ paddingTop: barraH + 8 }}>
          <div className="hud-pausa w-full max-w-md [@media(max-height:500px)]:max-w-2xl">
            <div className="grid gap-4 [@media(max-height:500px)]:grid-cols-[1.1fr_1fr] [@media(max-height:500px)]:gap-3">
              <div>
                <div className="flex items-end justify-between gap-3">
                  <h2 id="pausa-titulo" className="hud-pausa-titulo pb-1.5 text-4xl leading-none [@media(max-height:500px)]:text-3xl">Pausa</h2>
                  {hud && (
                    <p className="hud-lectura pb-1 text-right text-xs text-[#c8c0e0]">
                      Oleada {hud.wave}, {hud.score.toLocaleString('es-CL')} puntos
                    </p>
                  )}
                </div>
                <div className="mt-4 grid gap-2 [@media(max-height:500px)]:mt-3">
                  <button type="button" autoFocus onClick={togglePause} className="hud-key hud-key-amarilla hud-opcion">
                    <Px i="play" s={2} />
                    <span>Seguir volando</span>
                    {!touchUi && <kbd className="hud-tecla-hint">Esc</kbd>}
                  </button>
                  <button type="button" onClick={toHangar} className="hud-key hud-opcion">
                    <Px i="hangar" s={2} />
                    <span>Salir al hangar</span>
                  </button>
                  <button type="button" onClick={toMenu} className="hud-key hud-opcion">
                    <Px i="casa" s={2} />
                    <span>Menú principal</span>
                  </button>
                </div>
              </div>
              <div className="hud-ajustes">
                <h3 className="hud-stencil">Ajustes</h3>
                <label className="hud-ajuste">
                  <span className="flex items-center gap-2">
                    <Px i={muted ? 'mudo' : 'parlante'} s={2} tinta="#fff8e7" />
                    Sonido
                  </span>
                  <input type="checkbox" role="switch" checked={!muted} onChange={toggleMute} className="hud-switch" />
                </label>
                <label className="hud-ajuste">
                  <span>
                    Menos movimiento
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">Sin sacudidas ni destellos fuertes</small>
                  </span>
                  <input type="checkbox" role="switch" checked={calma} onChange={(e) => toggleCalma(e.target.checked)} className="hud-switch" />
                </label>
                <label className="hud-ajuste">
                  <span>
                    Zoom automático
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">A toda velocidad la cámara se aleja para ver lo que viene</small>
                  </span>
                  <input type="checkbox" role="switch" checked={zoomAuto} onChange={(e) => toggleZoomAuto(e.target.checked)} className="hud-switch" />
                </label>
                <label className="hud-ajuste">
                  <span>
                    Versión +18 (GORE)
                    <small className="block text-[11px] font-bold text-[#c8c0e0]">Sangre y mutilaciones. Solo mayores de 18; pide confirmar la edad.</small>
                  </span>
                  <input type="checkbox" role="switch" checked={gore} onChange={(e) => toggleGore(e.target.checked)} className="hud-switch" />
                </label>
                {!touchUi && (
                  <label className="hud-ajuste">
                    <span>
                      Apuntar con el mouse
                      <small className="block text-[11px] font-bold text-[#c8c0e0]">El avión sigue al cursor. Clic izquierdo: metralla · clic derecho: bengalas · Espacio: misil · B: bomba</small>
                    </span>
                    <input type="checkbox" role="switch" checked={ratonOn} onChange={(e) => toggleRaton(e.target.checked)} className="hud-switch" />
                  </label>
                )}
                {touchUi && (
                  <label className="hud-ajuste">
                    <span>
                      Metralla automática
                      <small className="block text-[11px] font-bold text-[#c8c0e0]">Dispara sola con un enemigo en la mira. Apagada, solo con el botón Balas</small>
                    </span>
                    <input type="checkbox" role="switch" checked={autoGun} onChange={(e) => toggleAutoGun(e.target.checked)} className="hud-switch" />
                  </label>
                )}
                {touchUi && (
                  <label className="hud-ajuste">
                    <span>
                      Vibración
                      <small className="block text-[11px] font-bold text-[#c8c0e0]">Un toque corto al apretar y al acercarse un misil</small>
                    </span>
                    <input type="checkbox" role="switch" checked={vibra} onChange={(e) => toggleVibra(e.target.checked)} className="hud-switch" />
                  </label>
                )}
                {touchUi && (
                  <div className="mt-2">
                    <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-[#c8c0e0]">Control táctil</div>
                    <div role="radiogroup" aria-label="Control táctil" className="grid grid-cols-2 gap-1.5">
                      {CONTROLES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={control === c.id}
                          onClick={() => elegirControl(c.id)}
                          className={`${TECLA} !h-auto flex-col items-start whitespace-normal px-2.5 py-1.5 text-left ${control === c.id ? 'hud-key-amarilla' : ''}`}
                        >
                          <span className="text-xs font-black">{c.nombre}</span>
                          <span className="text-[11px] font-bold opacity-75">{c.texto}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={repetirTuto} disabled={tuto === 0} className={`${TECLA} mt-1.5 px-3 text-xs disabled:opacity-50`}>
                      {tuto === 0 ? 'El tutorial saldrá en el próximo vuelo' : 'Repetir el tutorial del primer vuelo'}
                    </button>
                  </div>
                )}
                {touchUi && hud && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" aria-label={`Cielo: ${CIELO_NOMBRE[hud.sky]}. Cambiar`} onClick={() => game.current?.cycleSky()} className={`${TECLA} gap-1.5 px-2.5`}>
                      <Px i={CIELO_ICONO[hud.sky] ?? 'auto'} s={2} />
                      Cielo: {CIELO_NOMBRE[hud.sky]}
                    </button>
                    {hud.zoom[0] > 1 && (
                      <button type="button" onClick={() => game.current?.zoom()} className={`${TECLA} gap-1.5 px-2.5`}>
                        <Px i={hud.zoom[1] ? 'lupaMas' : 'lupaMenos'} s={2} />
                        Zoom
                      </button>
                    )}
                    <button type="button" aria-label="Ir al portafolio danieleduardo.cl" onClick={() => navigate('/clasico')} className={`${TECLA} px-2.5`}>
                      <Px i="casa" s={2} />
                      danieleduardo.cl
                    </button>
                  </div>
                )}
              </div>
            </div>
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
      {avisoGore && (
        <AvisoMayorEdad
          onCancelar={() => setAvisoGore(false)}
          onAceptar={() => {
            try {
              localStorage.setItem('vuelo-gore-18', new Date().toISOString());
            } catch {
              /* private mode: it will ask again next time */
            }
            setAvisoGore(false);
            setGore(true);
            game.current?.setGore(true);
            try {
              localStorage.setItem('vuelo-gore', '1');
            } catch {
              /* private mode */
            }
          }}
        />
      )}
      {phase === 'play' && touchUi && !paused && (
        <>
          <div className="absolute inset-x-0 bottom-0 top-16 z-10 flex touch-none" onPointerDown={onSkyDown} onPointerMove={onSkyMove} onPointerUp={onSkyUp} onPointerCancel={onSkyUp} onLostPointerCapture={onSkyUp}>
            {control === 'joystick' && stick && (
              <div aria-hidden className="pointer-events-none fixed z-20" style={{ left: stick.bx - 46, top: stick.by - 46 }}>
                <div className="h-[92px] w-[92px] rounded-full border-2 border-[#fff8e7]/50 bg-[#1a1438]/35" />
                <div className="absolute h-10 w-10 rounded-full border-2 border-[#1a1438] bg-[#ffd84a]/85" style={{ left: 26 + stick.x - stick.bx, top: 26 + stick.y - stick.by }} />
              </div>
            )}
            {control === 'volante' && (
              <div aria-hidden className="hud-panel pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 px-3 py-1 text-[11px] font-black opacity-80">
                Volante
                <span className="ml-2 inline-block h-2 w-20 overflow-hidden rounded-sm bg-[#1a1438]">
                  <span className="block h-full bg-[#ffd84a]" style={{ width: '4px', marginLeft: `${38 + inclinacion * 38}px` }} />
                </span>
              </div>
            )}
            {control === 'mitades' && (
              <>
                {/* Two invisible halves: hold one to turn. A soft glow on that edge, and at each
                    edge the rotation arrow with what it does right now: «Sube» or «Baja» depends
                    on which way the plane flies, so the label swaps when it turns around. */}
                <div className="pointer-events-none relative h-full w-1/2">
                  <div className={`absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white/25 to-transparent transition-opacity duration-150 ${turning === 1 ? 'opacity-100' : 'opacity-0'}`} />
                  <GuiaLado lado={1} nariz={hud?.nariz ?? 1} on={turning === 1} resalta={tuto === 0} />
                </div>
                <div className="pointer-events-none relative h-full w-1/2">
                  <div className={`absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white/25 to-transparent transition-opacity duration-150 ${turning === -1 ? 'opacity-100' : 'opacity-0'}`} />
                  <GuiaLado lado={-1} nariz={hud?.nariz ?? 1} on={turning === -1} resalta={tuto === 0} margen={derechaBotones} />
                </div>
              </>
            )}
          </div>
          {/* Right thumb: every key in one column along the right edge, from under the HUD bar
              to the bottom; the flares and missile get the most room, nuke on top when there is one. */}
          <div
            ref={botonesRef}
            className="absolute right-2 z-10 flex w-[3.75rem] flex-col gap-1 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] box-content"
            style={{ top: barraH + 4, bottom: 6 }}
          >
            {!!hud?.nukes && (
              <TouchButton fila label={`Nuclear ×${hud.nukes}`} corto="Nuclear" {...hold('nuke')}>
                <Px i="nuclear" s={2.5} />
              </TouchButton>
            )}
            <TouchButton fila big label={hud?.warn ? 'Bengalas: ¡misil encima!' : 'Bengalas'} corto="Bengalas" alerta={!!hud?.warn} guia={tutoVisible && tuto === 2} {...hold('flare')}>
              <Px i="bengala" s={3} />
            </TouchButton>
            <TouchButton fila big label={hud?.disparaYa ? 'Misil: blanco fijado, ¡dispara!' : 'Misil'} guia={(tutoVisible && tuto === 1) || !!hud?.disparaYa} {...hold('fire')}>
              <Px i="misil" s={3} />
            </TouchButton>
            <TouchButton fila label={hud?.hot ? 'Metralla: recalentada' : 'Metralla'} corto={hud?.hot ? '¡Calor!' : 'Balas'} active={!!hud?.hot} {...hold('gun')}>
              <Px i="bala" s={2.5} />
            </TouchButton>
            <TouchButton fila label="Bomba" {...hold('bomb')}>
              <Px i="bomba" s={2.5} />
            </TouchButton>
            <TouchButton fila label={hud?.nitro === 'carga' ? 'Acelerar (nitro recalentado)' : 'Acelerar y nitro (mantener)'} corto={hud?.nitro === 'carga' ? '¡Calor!' : 'Nitro'} active={hud?.throttle === 1 || hud?.nitro === 'activo'} {...throttle(1)}>
              {hud?.nitro === 'activo' ? <Px i="llama" s={2.5} /> : (
                <span className="relative inline-flex">
                  <Px i="acelerar" s={2.5} />
                  {hud?.nitro === 'listo' && <Px i="llama" s={1.25} className="absolute -right-2.5 -top-2" />}
                </span>
              )}
            </TouchButton>
            <TouchButton fila label="Frenar" corto="Freno" active={hud?.throttle === -1} {...throttle(-1)}>
              <Px i="frenar" s={2.5} />
            </TouchButton>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * «Pantalla dividida»: the hint at the edge of each half. The left half (lado 1) turns the
 * nose counterclockwise, so it climbs while the plane flies right (nariz 1) and dives while
 * it flies left; the right half the opposite. Near vertical only the rotation arrow shows.
 */
function GuiaLado({ lado, nariz, on, resalta, margen = 0 }: { lado: 1 | -1; nariz: number; on: boolean; resalta: boolean; margen?: number }) {
  const sube = nariz === 0 ? null : lado * nariz > 0;
  return (
    <span
      aria-hidden
      className={`absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 transition-opacity ${on ? 'opacity-95' : resalta ? 'hud-guia-pulso opacity-85' : 'opacity-45'}`}
      style={lado === 1 ? { left: 'max(0.5rem, env(safe-area-inset-left))' } : { right: margen + 10 }}
    >
      <span className="hud-giro">
        <Px i="giro" s={3} style={lado === 1 ? { transform: 'scaleX(-1)' } : undefined} />
      </span>
      {sube !== null && (
        <span className={`hud-panel gap-1 px-1.5 py-0.5 text-[11px] font-black leading-none ${sube ? 'text-[#7af0a0]' : 'text-[#ffd84a]'}`}>
          <span className={`hud-flechita ${sube ? '' : 'rotate-180'}`} />
          {sube ? 'Sube' : 'Baja'}
        </span>
      )}
    </span>
  );
}

/** A short buzz under the thumb, unless the player turned vibration off in Ajustes. */
function vibrar(ms: number | number[]) {
  try {
    if (localStorage.getItem('vuelo-vibrar') === '0') return;
  } catch {
    /* private mode: vibrate anyway */
  }
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration */
  }
}

/**
 * A thumb key: the icon, and under it a short word (`corto`, 11 px so it reads on a phone;
 * the full `label` is what screen readers hear). It sinks while held (tracked by hand: with
 * pointer capture `:active` isn't reliable on every phone), and `guia` rings it while the
 * first-flight tutorial points at it.
 */
/**
 * Age gate and notices for the +18 (gore) version: two boxes to tick (age, and having
 * read the notice) before «Activar» unlocks. Nothing leaves the device.
 */
function AvisoMayorEdad({ onAceptar, onCancelar }: { onAceptar: () => void; onCancelar: () => void }) {
  const [edad, setEdad] = useState(false);
  const [leido, setLeido] = useState(false);
  useEffect(() => {
    // The notice owns the keyboard: Esc (or P) must not also resume the game or leave Ajustes behind it.
    const esc = (e: KeyboardEvent) => {
      if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space') return;
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onCancelar]);
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0c0818]/85 p-3" role="dialog" aria-modal="true" aria-labelledby="aviso18-titulo">
      <div className="hud-panel flex max-h-[92vh] w-full max-w-lg flex-col items-stretch gap-3 overflow-y-auto whitespace-normal p-4 text-left text-[13px] font-bold leading-snug">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[#d01a34] text-sm font-black text-white">+18</span>
          <h2 id="aviso18-titulo" className="text-base font-black text-[#ffd84a]">Versión +18 · Contenido violento</h2>
        </div>
        <p>Antes de activarla, lee esto:</p>
        <ul className="list-disc space-y-1.5 pl-5 text-[#e8e0f8]">
          <li><b>Contenido:</b> violencia gráfica en pixel art, con sangre, mutilación y desmembramiento de personajes animados (ratones). Material NSFW, no apto para el trabajo ni para lugares públicos.</li>
          <li><b>Solo para mayores de 18 años</b> o la mayoría de edad que exija la ley de tu país, si es mayor. No es apto para menores ni para personas sensibles a la violencia.</li>
          <li><b>Es ficción:</b> personajes y situaciones inventados con fines de humor y entretenimiento. No promueve, glorifica ni incita la violencia contra personas ni animales reales.</li>
          <li><b>Salud:</b> tiene destellos y efectos intensos. Si eres sensible a ellos (por ejemplo, epilepsia fotosensible), activa «Menos movimiento» o no la uses.</li>
          <li><b>Privacidad:</b> tu confirmación se guarda solo en este dispositivo; no se envía ni se registra ningún dato personal.</li>
          <li><b>Tu responsabilidad:</b> al aceptar declaras que cumples la edad mínima y que la usas bajo tu propia responsabilidad. Si compartes el dispositivo con menores, desactívala al terminar (Ajustes). El autor no se hace responsable del uso por menores ni de un uso indebido.</li>
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded bg-black/20 p-2">
          <input type="checkbox" checked={edad} onChange={(e) => setEdad(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#ffd84a]" />
          <span>Confirmo que tengo <b>18 años o más</b> (o la mayoría de edad de mi país).</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded bg-black/20 p-2">
          <input type="checkbox" checked={leido} onChange={(e) => setLeido(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#ffd84a]" />
          <span>Leí el aviso y acepto ver contenido violento y explícito.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onCancelar} className={`${TECLA} px-4`}>
            No, volver
          </button>
          <button type="button" disabled={!(edad && leido)} onClick={onAceptar} className={`${TECLA} hud-key-amarilla px-4 disabled:cursor-not-allowed disabled:opacity-40`}>
            Activar versión +18
          </button>
        </div>
      </div>
    </div>
  );
}

function TouchButton({ label, corto, big, fila, active, alerta, guia, children, ...rest }: { label: string; corto?: string; big?: boolean; fila?: boolean; active?: boolean; alerta?: boolean; guia?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className={`hud-touch flex flex-col items-center justify-center ${active ? 'hud-touch-on' : ''} ${down ? 'hud-touch-down' : ''} ${alerta ? 'hud-touch-alerta' : ''} ${guia ? 'hud-touch-guia' : ''} ${
        // In the single right-edge column the keys share its height (the big ones a larger share).
        fila
          ? `min-h-0 w-full ${big ? 'flex-[1.45]' : 'flex-1'}`
          : big
          ? 'h-20 w-20 [@media(max-height:420px)]:h-[4.5rem] [@media(max-height:420px)]:w-[4.5rem]'
          : // Short (landscape phone) screens: 48 px, then the 44 px minimum, so the column clears the radar even with the nuke key.
            'h-14 w-14 [@media(min-height:421px)_and_(max-height:500px)]:h-12 [@media(min-height:421px)_and_(max-height:500px)]:w-12 [@media(max-height:420px)]:h-11 [@media(max-height:420px)]:w-11'
      }`}
      {...rest}
      onPointerDown={(e) => {
        setDown(true);
        vibrar(big ? 18 : 10);
        rest.onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        setDown(false);
        rest.onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        setDown(false);
        rest.onPointerCancel?.(e);
      }}
      onLostPointerCapture={() => setDown(false)}
    >
      <span aria-hidden className="grid min-h-6 place-items-center leading-none">{children}</span>
      <span aria-hidden className="mt-0.5 whitespace-nowrap text-[11px] font-black leading-none tracking-tight text-[#3a2a6a]">{corto ?? label}</span>
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
