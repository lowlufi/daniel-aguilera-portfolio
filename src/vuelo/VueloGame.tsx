import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { initAudio, jingleIntro, jingleStart, pauseAudio, setMusicMood, setMusicVolume, setMuted as setAudioMuted, sfx } from '../game/audio';
import { cargarSonidos } from './sonido';
import { PLANES, createVuelo, dibujo, readSave, type Hud, type Result, type SavedGame, type Vuelo } from './motor';
import type { ModeloAvion } from './fisica-tipos';
import { FPS, FRAMES, fondoTarjeta, retrato, type Pose } from './retratos';

/*
 * "Escuadrón Dui": the plane game around the canvas engine in motor.ts. This
 * file only does the intro, the title screen, the credits, the hangar, the
 * HUD, the pause and the touch controls.
 */

/** intro → titulo (title menu over a self-playing game) → menu (hangar) → play → over. */
type Phase = 'intro' | 'titulo' | 'creditos' | 'menu' | 'play' | 'over';

const AUTOR = 'Daniel Aguilera Campusano';
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
  ['Dui', 'el gato naranjo, piloto del Caza Mandarina'],
  ['Lulu', 'la gatita negra de ojos amarillos, Avioneta Mostaza'],
  ['Almendrita', 'la yorkshire, Bombardero Nube'],
  ['Vecina Margarita', 'ella misma (y su portaaviones)'],
  ['Los ratones', 'muchos, muchísimos ratones'],
];
/** CC0 sound recordings (no attribution required; thanked anyway). */
const SONIDOS_CC0 = ['modusmogulus', 'craigsmith', 'qubodup', 'unfa', 'josecruz98', 'Alxy', 'Anthousai', 'Rocotilos'];

const CHIP = 'inline-flex h-8 [@media(min-height:500px)]:h-10 items-center gap-1 rounded-full bg-[#fff8e7]/95 px-2.5 [@media(min-height:500px)]:px-3 text-xs [@media(min-height:500px)]:text-sm whitespace-nowrap font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] tabular-nums';
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

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} de 5`} className="tracking-tight text-[#f0a45d]">
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
  const [result, setResult] = useState<Result | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [touchUi, setTouchUi] = useState(false);
  const [portrait, setPortrait] = useState(false);

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
    const id = window.setTimeout(() => setIntroStep((n) => Math.min(3, n + 1)), introStep === 1 ? 2300 : 1300);
    return () => window.clearTimeout(id);
  }, [phase, introStep]);
  useEffect(() => {
    if (phase !== 'intro') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
    sfx.open();
    setResult(null);
    setPaused(false);
    game.current?.setPaused(false);
    const from = resume ? readSave() : null;
    if (from) setPlane(from.pilot);
    game.current?.start(from ? from.pilot : plane, from);
    setSaved(null);
    setPhase('play');
  }, [muted, plane]);

  // Character select: who is confirmed (playing their pose) before take-off.
  const [confirmado, setConfirmado] = useState<ModeloAvion | null>(null);
  const elegir = useCallback((m: ModeloAvion) => {
    setPlane(m);
    sfx.select();
  }, []);
  const confirmar = useCallback(() => {
    if (confirmado) return;
    setConfirmado(plane);
    jingleStart();
    window.setTimeout(() => {
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
      return !p;
    });
  }, [phase]);

  /** Back to the hangar to pick another plane (the self-playing game keeps flying behind). */
  const toHangar = useCallback(() => {
    game.current?.attract();
    game.current?.setPaused(false);
    setPaused(false);
    setSaved(readSave());
    tituloMusica();
    setPhase('menu');
  }, [tituloMusica]);

  const toMenu = useCallback(() => {
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
      if (e.code === 'Escape' && (phase === 'creditos' || phase === 'menu')) setPhase('titulo');
    };
    const onHide = () => {
      if (document.hidden && phase === 'play' && !paused) togglePause();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [togglePause, play, phase, paused]);

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
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, side);
    applyTurn();
  };
  const onSkyUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.delete(e.pointerId)) return;
    applyTurn();
  };
  const throttle = (v: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
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
  const hold = (key: 'fire' | 'bomb' | 'flare' | 'gun' | 'nuke') => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
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
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {phase === 'intro' || phase === 'titulo' || phase === 'creditos' ? null : phase === 'menu' ? (
            <span className={`${CHIP} px-4`}>✈️ Escuadrón Dui</span>
          ) : (
            hud && (
              <>
                <span className={CHIP} title="Aviones que te quedan" aria-label={`Aviones: ${hud.lives}`}>
                  ✈️ ×{hud.lives}
                </span>
                <span
                  className={`${CHIP} ${hud.lost.length ? 'ring-2 ring-[#ff4a5a]' : ''}`}
                  title={hud.lost.length ? `Dañado: ${hud.lost.join(', ')}` : 'Avión intacto'}
                  aria-label={`Blindaje: ${hud.hp} de ${hud.hpMax}${hud.lost.length ? `. Perdiste ${hud.lost.join(', ')}` : ''}`}
                >
                  <Pips n={hud.hp} max={hud.hpMax} on="🛡️" off="💥" />
                  <span className="ml-1 tabular-nums text-[10px] opacity-70">{hud.hp}/{hud.hpMax}</span>
                </span>
                <span className={`${CHIP} ${hud.stolen ? 'animate-pulse ring-4 ring-[#ff4a5a]' : ''}`} title="Pescado en la despensa" aria-label={`Despensa: ${hud.meta} de ${hud.metaMax}`}>
                  <Pips n={hud.meta} max={hud.metaMax} on="🐟" off="🦴" />
                </span>
                <span className={CHIP}>⭐ {hud.score}</span>
                {hud.nukes > 0 && (
                  <span className={`${CHIP} bg-[#f4ffc0] text-[#4a5a1a]`} title="Bomba nuclear: tecla N o botón ☢️">
                    ☢️ ×{hud.nukes}
                  </span>
                )}
                {hud.boost && (
                  <span className={`${CHIP} animate-pulse bg-[#ffe0f0] text-[#c8507a]`} title="Mejora especial de un avión derribado">
                    ⭐ {hud.boost} · {hud.boostT} s
                  </span>
                )}
                <span className={CHIP}>🌊 {hud.wave} · 🐭 {hud.left}</span>
                <span className={CHIP} title="Altura">⛰️ {hud.altitude.toLocaleString('es-CL')} m</span>
                <span className={`${CHIP} max-[899px]:hidden`} title="Viento: empuja las bombas y el humo" aria-label={`Viento ${Math.abs(hud.wind)} hacia la ${hud.wind < 0 ? 'izquierda' : 'derecha'}`}>
                  🌬️ {hud.wind < 0 ? '◀'.repeat(Math.min(3, Math.ceil(-hud.wind / 4))) : hud.wind > 0 ? '▶'.repeat(Math.min(3, Math.ceil(hud.wind / 4))) : '·'}
                </span>
                <span
                  className={CHIP}
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
        <div className="pointer-events-auto flex items-center gap-1.5">
          {phase === 'play' && (
            <button type="button" aria-label={paused ? 'Seguir' : 'Pausa'} onClick={togglePause} className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}>
              {paused ? '▶️' : '⏸️'}
            </button>
          )}
          {phase === 'play' && hud && (
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
          {phase === 'play' && hud && hud.zoom[0] > 1 && (
            <button type="button" aria-label={hud.zoom[1] ? 'Acercar' : 'Alejar la cámara'} title="Zoom (Z)" onClick={() => game.current?.zoom()} className={`${BTN} w-8 [@media(min-height:500px)]:w-10 px-0 md:px-0`}>
              {hud.zoom[1] ? '🔎' : '🔍'}
            </button>
          )}
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
        </div>
      </div>

      {/* Wave banner and missile alarm. */}
      {phase === 'play' && hud?.banner && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-10 text-center">
          <span className="inline-block rounded-3xl bg-[#fff8e7]/95 px-6 py-3 text-2xl md:text-3xl font-black text-[#6b4f3a] shadow-[0_5px_0_rgba(91,70,54,0.2)]">
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
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center px-4 [@media(max-height:500px)]:bottom-24">
          <span className="rounded-full bg-[#3a2a6a]/75 px-4 py-1.5 text-center text-sm font-black text-white shadow">💡 {hud.pista}</span>
        </div>
      )}
      {phase === 'play' && hud?.mision && !hud.resumen && !paused && (
        <div className="pointer-events-none absolute left-3 top-[6.5rem] z-10 [@media(max-height:500px)]:top-[5.5rem]">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black shadow ${
              hud.mision.hecha ? 'bg-[#c8f0c8] text-[#2f6a3a]' : hud.mision.fallida ? 'bg-[#ead6b3]/80 text-[#a08060] line-through' : 'bg-[#fff8e7]/90 text-[#6b4f3a]'
            }`}
          >
            {hud.mision.hecha ? '🏅' : '🎯'} {hud.mision.texto}
            {hud.mision.meta > 1 && !hud.mision.hecha ? ` (${hud.mision.prog}/${hud.mision.meta})` : ''}
          </span>
        </div>
      )}
      {phase === 'play' && hud?.resumen && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex justify-center px-4">
          <div className="w-full max-w-sm animate-[aparece_0.35s_ease-out] rounded-[1.6rem] bg-[#fff8e7]/95 p-4 text-center shadow-[0_6px_0_rgba(91,70,54,0.2)] ring-4 ring-[#ead6b3]">
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
                🔥 ¡Super nitro! Rumbo a{' '}
                {({ oceano: 'el mar de San Antonio 🌊', valparaiso: 'Valparaíso 🏘️', tormenta: 'la tormenta ⛈️', valle: 'San Antonio 🏠' } as Record<string, string>)[hud.resumen.destino]}
              </p>
            ) : (
              <p className="mt-2 text-xs font-bold text-[#8a6e55]">Próxima oleada: {hud.resumen.siguiente}</p>
            )}
            {hud.resumen.dato && (
              <p className="mt-2 rounded-xl bg-[#ffe3a3]/60 px-3 py-1.5 text-left text-xs font-bold text-[#6b4f3a]">💡 ¿Sabías que…? {hud.resumen.dato}</p>
            )}
            <p className="mt-1 text-[10px] font-bold text-[#a08060]">Partida guardada ✓ · puedes seguir otro día</p>
          </div>
        </div>
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
      {phase === 'play' && hud?.boss && (
        <div className="pointer-events-none absolute inset-x-0 top-[3.6rem] [@media(min-height:500px)]:top-[4.4rem] z-10 flex justify-center px-4">
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
                <Key k="Q · Ctrl" label="Frenar" on={hud?.throttle === -1} />
                <Key k="Espacio" label="Misil (sale por la nariz)" />
                <Key k="K" label="Bomba" />
                <Key k="L" label="Bengalas" />
                <Key k="H · F" label="Metralla (se calienta)" />
                <Key k="N" label="Bomba nuclear (de los ovnis)" />
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
            <button type="button" autoFocus={!saved} onClick={() => { sfx.select(); setPhase('menu'); }} className={saved ? `${BTN} h-12 w-full text-base` : `${GO} w-full`}>
              ✈️ {saved ? 'Nueva partida' : 'Jugar'}
            </button>
            <button type="button" onClick={() => { sfx.select(); setPhase('creditos'); }} className={`${BTN} h-12 w-full text-base`}>
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
          <button type="button" autoFocus onClick={() => setPhase('titulo')} className={`${BTN} absolute bottom-5 left-1/2 h-12 -translate-x-1/2`}>
            ← Volver
          </button>
        </div>
      )}

      {/* Character select, arcade style: three framed pilots, the chosen one big and animated; confirm and they strike a pose. */}
      {phase === 'menu' && (
        <div role="dialog" aria-modal="true" aria-label="Elige tu piloto" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#120c24]/70 p-3 pt-16 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:pt-12">
          <div className="flex w-full max-w-4xl items-center justify-between gap-2">
            <button type="button" onClick={() => setPhase('titulo')} className={`${BTN} h-9`} disabled={!!confirmado}>← Volver</button>
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
            <button type="button" autoFocus disabled={!!confirmado} onClick={confirmar} className={GO}>
              ✈️ ¡A volar con {spec.pilot}!
            </button>
          </div>
          <p className="text-center text-[11px] font-bold text-white/80 [@media(max-height:500px)]:hidden">
            {touchUi ? 'Toca un piloto para elegirlo y otra vez para confirmar.' : '← → elige · Enter confirma · Esc vuelve'}
          </p>
          {portrait && <p className="text-center text-xs font-black text-[#ffe3a3]">📱 Gira el teléfono para jugar más cómodo.</p>}
        </div>
      )}

      {phase === 'over' && result && (
        <div role="dialog" aria-modal="true" aria-label="Fin del vuelo" className="absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4 [@media(max-height:500px)]:p-2">
          <div className="w-full max-w-md rounded-[2rem] bg-[#fff8e7]/95 p-6 [@media(max-height:500px)]:p-3 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h2 className="text-3xl font-black text-[#e8742a]">{result.reason === 'avion' ? '¡Derribaron tus tres aviones!' : '¡Vaciaron la despensa!'}</h2>
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
                ? 'Tip: cuando un misil se acerque, gira fuerte en el último momento o suelta bengalas ✨'
                : 'Tip: vuela bajo y vigila el pescado 🐟; las flechas del borde te llevan a los ratones'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {saved && (
                <button type="button" autoFocus onClick={() => play(true)} className={GO}>
                  Seguir desde la oleada {saved.wave}
                </button>
              )}
              <button type="button" autoFocus={!saved} onClick={() => play()} className={saved ? `${BTN} h-12` : GO}>Otra vez</button>
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
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm font-black text-[#6b4f3a]">
              <input type="checkbox" checked={calma} onChange={(e) => toggleCalma(e.target.checked)} className="h-5 w-5 accent-[#f0a45d]" />
              Menos movimiento (sin sacudidas ni destellos fuertes)
            </label>
          </div>
        </div>
      )}

      {phase === 'play' && touchUi && !paused && (
        <>
          <div className="absolute inset-x-0 bottom-0 top-16 z-10 flex touch-none" onPointerDown={onSkyDown} onPointerUp={onSkyUp} onPointerCancel={onSkyUp}>
            {/* Each half lights up while held; big round arrows say which way the nose turns. */}
            <div className={`pointer-events-none relative h-full w-1/2 transition-colors ${turning === 1 ? 'bg-white/10' : ''}`}>
              <span className={`absolute bottom-10 left-5 grid h-16 w-16 place-items-center rounded-full text-3xl font-black text-white ring-2 ring-white/60 drop-shadow ${turning === 1 ? 'bg-white/40' : 'bg-white/15'}`}>⟲</span>
            </div>
            <div className={`pointer-events-none relative h-full w-1/2 transition-colors ${turning === -1 ? 'bg-white/10' : ''}`}>
              <span className={`absolute bottom-28 right-5 grid h-16 w-16 place-items-center rounded-full text-3xl font-black text-white ring-2 ring-white/60 drop-shadow [@media(max-height:420px)]:bottom-24 ${turning === -1 ? 'bg-white/40' : 'bg-white/15'}`}>⟳</span>
            </div>
            {turns < 3 && (
              <span className="pointer-events-none absolute bottom-28 left-5 rounded-full bg-[#3a2a6a]/50 px-3 py-1 text-[11px] font-black text-white [@media(max-height:420px)]:bottom-[6.5rem]">
                Mantén izquierda o derecha para girar · doble toque: 🔥 nitro
              </span>
            )}
          </div>
          <div className="absolute bottom-5 right-3 z-10 flex items-end gap-2 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]">
            <div className="flex flex-col gap-2">
              <TouchButton label={hud?.nitro === 'listo' ? 'Acelerar ×2🔥' : 'Acelerar'} active={hud?.throttle === 1 || hud?.nitro === 'activo'} {...throttle(1)}>
                {hud?.nitro === 'activo' ? '🔥' : '⏩'}
              </TouchButton>
              <TouchButton label="Frenar" active={hud?.throttle === -1} {...throttle(-1)}>🛑</TouchButton>
            </div>
            <div className="flex flex-col gap-2">
              <TouchButton label="Bengalas" {...hold('flare')}>✨</TouchButton>
              <TouchButton label="Bomba" {...hold('bomb')}>💣</TouchButton>
            </div>
            <div className="flex flex-col gap-2">
              <TouchButton label="Metralla" active={hud?.hot} {...hold('gun')}>💥</TouchButton>
              {!!hud?.nukes && (
                <TouchButton label={`Nuclear ×${hud.nukes}`} {...hold('nuke')}>☢️</TouchButton>
              )}
            </div>
            <TouchButton label="Misil" big {...hold('fire')}>🚀</TouchButton>
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
      className={`flex flex-col items-center justify-center rounded-full shadow-[0_4px_0_rgba(91,70,54,0.25)] ring-2 active:translate-y-0.5 ${
        active ? 'bg-[#ffe3a3] ring-[#f0a45d]' : 'bg-[#fff8e7]/85 ring-white/70'
      } ${big ? 'h-20 w-20 text-3xl [@media(max-height:420px)]:h-16 [@media(max-height:420px)]:w-16' : 'h-14 w-14 text-xl [@media(max-height:420px)]:h-12 [@media(max-height:420px)]:w-12'} opacity-90`}
      {...rest}
    >
      <span aria-hidden className="leading-none">{children}</span>
      <span aria-hidden className="mt-0.5 text-[9px] font-black leading-none text-[#6b4f3a]">{label}</span>
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
