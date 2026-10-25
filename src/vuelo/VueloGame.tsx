import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { initAudio, pauseAudio, setMusicMood, setMusicVolume, setMuted as setAudioMuted, sfx } from '../game/audio';
import { cargarSonidos } from './sonido';
import { PLANES, createVuelo, dibujo, readSave, type Hud, type Result, type SavedGame, type Vuelo } from './motor';
import type { ModeloAvion } from './fisica-tipos';

/*
 * "Escuadrón Dui": the plane game around the canvas engine in motor.ts. This
 * file only does the menus, the HUD, the pause and the touch controls.
 */

type Phase = 'menu' | 'play' | 'over';

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
  const [phase, setPhase] = useState<Phase>('menu');
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

  const togglePause = useCallback(() => {
    if (phase !== 'play') return;
    setPaused((p) => {
      game.current?.setPaused(!p);
      return !p;
    });
  }, [phase]);

  const toMenu = useCallback(() => {
    game.current?.demo();
    game.current?.setPaused(false);
    setPaused(false);
    setSaved(readSave());
    setPhase('menu');
  }, []);

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
      if (phase !== 'play' && e.code === 'Enter') play();
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

  /* Touch: a floating stick on the left half, buttons on the right. */
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const onStickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setKnob({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const onStickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = stick.current;
    if (!st || st.id !== e.pointerId) return;
    const R = 46;
    let dx = e.clientX - st.x;
    let dy = e.clientY - st.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    // Only the direction matters: the plane points its nose that way.
    const n = len > 6 ? 1 / len : 0;
    game.current?.touch({ x: dx * n, y: -dy * n });
    setKnob({ x: st.x, y: st.y, dx, dy });
  };
  const onStickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    game.current?.touch({ x: 0, y: 0 });
    setKnob(null);
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
  const hold = (key: 'fire' | 'bomb' | 'flare') => ({
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
          {phase === 'menu' ? (
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
      {phase === 'play' && !touchUi && !paused && (
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
                <Key k="Q · Ctrl" label="Frenar" on={hud?.throttle === -1} />
                <Key k="Espacio" label="Misil (sale por la nariz)" />
                <Key k="K" label="Bomba" />
                <Key k="L" label="Bengalas" />
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

      {/* Menu: the story, the hangar and the controls. */}
      {phase === 'menu' && (
        <div role="dialog" aria-modal="true" aria-label="Hangar" className="absolute inset-0 z-30 grid place-items-center overflow-y-auto p-4 pt-20 [@media(max-height:500px)]:pt-14 [@media(max-height:500px)]:pb-2">
          <div className="w-full max-w-2xl rounded-[2rem] bg-[#fff8e7]/95 p-5 md:p-7 [@media(max-height:500px)]:p-3 shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h1 className="text-center text-3xl md:text-4xl font-black text-[#e8742a] [@media(max-height:500px)]:text-2xl">Escuadrón Dui</h1>
            <p className="mx-auto mt-2 max-w-lg text-center text-[15px] font-bold leading-snug [@media(max-height:500px)]:hidden">
              Los ratones quieren llevarse el pescado de la despensa. Dui, Lulu y Almendrita despegan para detenerlos: esquiva sus misiles y frena sus vehículos antes de que lleguen.
            </p>
            <h2 className="mt-5 text-sm font-black uppercase tracking-wide text-[#a08060]">Elige piloto</h2>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PLANES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPlane(p.id);
                    sfx.select();
                  }}
                  aria-pressed={plane === p.id}
                  className={`flex items-center gap-3 rounded-2xl p-3 [@media(max-height:500px)]:p-1.5 text-left transition-colors sm:flex-col sm:text-center ${
                    plane === p.id ? 'bg-[#ffe3a3] ring-4 ring-[#f0a45d]' : 'bg-white/70 ring-2 ring-[#ead6b3] hover:bg-white'
                  }`}
                >
                  <span className="flex shrink-0 items-center gap-1.5">
                    <img
                      src={thumbs[p.id].pilot}
                      alt=""
                      className="h-10 w-10 rounded-full bg-[#fff8e7] p-0.5 ring-2 ring-[#ead6b3] sm:h-12 sm:w-12 [@media(max-height:500px)]:h-8 [@media(max-height:500px)]:w-8"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <img src={thumbs[p.id].plane} alt="" className="h-10 w-auto sm:h-12 [@media(max-height:500px)]:h-8" style={{ imageRendering: 'pixelated' }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-black">{p.pilot}</span>
                    <span className="block text-xs font-black text-[#e8742a]">{p.name}</span>
                    <span className="block text-xs font-bold leading-snug text-[#8a6e55] [@media(max-height:500px)]:hidden">{p.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-bold sm:grid-cols-4">
              <div><dt className="text-xs text-[#a08060]">Velocidad</dt><dd><Stars n={spec.stats.velocidad} /></dd></div>
              <div><dt className="text-xs text-[#a08060]">Blindaje</dt><dd><Stars n={spec.stats.blindaje} /></dd></div>
              <div><dt className="text-xs text-[#a08060]">Misiles</dt><dd><Stars n={spec.stats.misiles} /></dd></div>
              <div><dt className="text-xs text-[#a08060]">Bombas</dt><dd><Stars n={spec.stats.bombas} /></dd></div>
            </dl>
            <div className="sticky bottom-0 -mx-2 mt-5 flex flex-col items-center gap-3 rounded-2xl bg-[#fff8e7]/95 px-2 pt-2 [@media(max-height:500px)]:mt-2">
              {saved && (
                <button type="button" onClick={() => play(true)} className={GO}>
                  Continuar partida · {PLANES.find((p) => p.id === saved.pilot)?.pilot}, oleada {saved.wave}, ⭐ {saved.score}
                </button>
              )}
              <button type="button" onClick={() => play()} className={saved ? `${BTN} h-12` : GO}>
                {saved ? 'Nueva partida' : '¡A volar!'}
              </button>
              {touchUi ? (
                <p className="text-center text-xs font-bold text-[#8a6e55]">Arrastra en la mitad izquierda para pilotear. A la derecha: acelerar, frenar, misil, bomba y bengalas.</p>
              ) : (
                <p className="text-center text-xs font-bold text-[#8a6e55]">
                  Flechas o WASD: pilotear · E: acelerar · Q: frenar · Espacio: misil · K: bomba · L: bengalas · Z: zoom · Esc: pausa
                </p>
              )}
              {portrait && <p className="text-center text-xs font-black text-[#e8742a]">📱 Gira el teléfono para jugar más cómodo.</p>}
            </div>
          </div>
        </div>
      )}

      {phase === 'over' && result && (
        <div role="dialog" aria-modal="true" aria-label="Fin del vuelo" className="absolute inset-0 z-30 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-[#fff8e7]/95 p-6 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
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
              <button type="button" onClick={toMenu} className={`${BTN} h-12`}>Cambiar avión</button>
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
              <button type="button" onClick={toMenu} className={`${BTN} h-12`}>Salir al hangar</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'play' && touchUi && !paused && (
        <>
          <div className="absolute bottom-0 left-0 top-16 z-10 w-1/2" onPointerDown={onStickDown} onPointerMove={onStickMove} onPointerUp={onStickUp} onPointerCancel={onStickUp}>
            {!knob && (
              <div className="pointer-events-none absolute bottom-8 left-8 grid h-24 w-24 place-items-center rounded-full bg-white/20 ring-2 ring-white/60 pb-[env(safe-area-inset-bottom)]">
                <span className="text-center text-[10px] font-black leading-tight text-white drop-shadow">Arrastra<br />para pilotear</span>
              </div>
            )}
            {knob && (
              <div className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25 ring-2 ring-white/60" style={{ left: knob.x, top: knob.y - 64 }}>
                <div className="absolute left-1/2 top-1/2 h-10 w-10 rounded-full bg-white/80 shadow" style={{ transform: `translate(calc(-50% + ${knob.dx}px), calc(-50% + ${knob.dy}px))` }} />
              </div>
            )}
          </div>
          <div className="absolute bottom-5 right-3 z-10 flex items-end gap-2 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]">
            <div className="flex flex-col gap-2">
              <TouchButton label="Acelerar" active={hud?.throttle === 1} {...throttle(1)}>⏩</TouchButton>
              <TouchButton label="Frenar" active={hud?.throttle === -1} {...throttle(-1)}>🛑</TouchButton>
            </div>
            <div className="flex flex-col gap-2">
              <TouchButton label="Bengalas" {...hold('flare')}>✨</TouchButton>
              <TouchButton label="Bomba" {...hold('bomb')}>💣</TouchButton>
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
