import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { initAudio, pauseAudio, setMusicMood, setMuted as setAudioMuted, sfx } from '../game/audio';
import { cargarSonidos } from './sonido';
import { PLANES, createVuelo, dibujo, type Hud, type Result, type Vuelo } from './motor';
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
  const [plane, setPlane] = useState<ModeloAvion>('caza');
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

  const play = useCallback(() => {
    initAudio(muted);
    setMusicMood('vuelo');
    cargarSonidos();
    sfx.open();
    setResult(null);
    setPaused(false);
    game.current?.setPaused(false);
    game.current?.start(plane);
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
    const mag = Math.min(1, len / R);
    const n = len > 6 ? 1 / Math.max(len, 1) : 0;
    game.current?.touch({ x: dx * n * mag * (R / Math.max(Math.hypot(dx, dy), 1)), y: -dy * n * mag * (R / Math.max(Math.hypot(dx, dy), 1)), gas: len > R * 1.6 ? 1 : 0 });
    setKnob({ x: st.x, y: st.y, dx, dy });
  };
  const onStickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    game.current?.touch({ x: 0, y: 0, gas: 0 });
    setKnob(null);
  };
  const hold = (key: 'fire' | 'bomb' | 'flare') => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      game.current?.touch({ [key]: true });
    },
    onPointerUp: () => game.current?.touch({ [key]: false }),
    onPointerCancel: () => game.current?.touch({ [key]: false }),
  });

  const spec = PLANES.find((p) => p.id === plane)!;

  return (
    <div className="pixel-isla fixed inset-0 overflow-hidden select-none font-cozy text-[#5b4636] touch-none">
      <div ref={boxRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block" aria-label="Escuadrón Dui: juego de aviones" />
      </div>

      {/* Top bar: score on the left, the way out on the right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {phase === 'menu' ? (
            <span className={`${CHIP} px-4`}>✈️ Escuadrón Dui</span>
          ) : (
            hud && (
              <>
                <span className={CHIP} title="Vidas del avión" aria-label={`Vidas: ${hud.hp} de ${hud.hpMax}`}>
                  <Pips n={hud.hp} max={hud.hpMax} on="❤️" off="🤍" />
                </span>
                <span className={CHIP} title="Pescado en la despensa" aria-label={`Despensa: ${hud.meta} de ${hud.metaMax}`}>
                  <Pips n={hud.meta} max={hud.metaMax} on="🐟" off="🦴" />
                </span>
                <span className={CHIP}>⭐ {hud.score}</span>
                <span className={`${CHIP} hidden sm:inline-flex`}>🌊 Oleada {hud.wave} · 🐭 {hud.left}</span>
                <span className={`${CHIP} hidden lg:inline-flex`} title="Misiles y bengalas">
                  🚀 <Pips n={hud.ammo} max={hud.rack} on="▮" off="▯" /> · ✨ {hud.flares}
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
      {phase === 'play' && hud?.warn && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 text-center">
          <span className="inline-block animate-pulse rounded-full bg-[#ff4a5a] px-4 py-1.5 text-sm font-black text-white shadow-[0_3px_0_#a01a3a]">
            ⚠️ ¡Misil! Gira fuerte o suelta bengalas
          </span>
        </div>
      )}

      {/* Menu: the story, the hangar and the controls. */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto p-4 pt-20">
          <div className="w-full max-w-2xl rounded-[2rem] bg-[#fff8e7]/95 p-5 md:p-7 shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h1 className="text-center text-3xl md:text-4xl font-black text-[#e8742a]">Escuadrón Dui</h1>
            <p className="mx-auto mt-2 max-w-lg text-center text-[15px] font-bold leading-snug">
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
                  className={`flex items-center gap-3 rounded-2xl p-3 text-left transition-colors sm:flex-col sm:text-center ${
                    plane === p.id ? 'bg-[#ffe3a3] ring-4 ring-[#f0a45d]' : 'bg-white/70 ring-2 ring-[#ead6b3] hover:bg-white'
                  }`}
                >
                  <span className="flex shrink-0 items-center gap-1.5">
                    <img
                      src={thumbs[p.id].pilot}
                      alt=""
                      className="h-10 w-10 rounded-full bg-[#fff8e7] p-0.5 ring-2 ring-[#ead6b3] sm:h-12 sm:w-12"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <img src={thumbs[p.id].plane} alt="" className="h-10 w-auto sm:h-12" style={{ imageRendering: 'pixelated' }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-black">{p.pilot}</span>
                    <span className="block text-xs font-black text-[#e8742a]">{p.name}</span>
                    <span className="block text-xs font-bold leading-snug text-[#8a6e55]">{p.blurb}</span>
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
            <div className="mt-5 flex flex-col items-center gap-3">
              <button type="button" onClick={play} className={GO}>
                ¡A volar!
              </button>
              {touchUi ? (
                <p className="text-center text-xs font-bold text-[#8a6e55]">Arrastra en la mitad izquierda para pilotear (hasta el borde = turbo). Botones a la derecha: misil, bomba y bengalas.</p>
              ) : (
                <p className="text-center text-xs font-bold text-[#8a6e55]">
                  Flechas o WASD: pilotear · Shift: turbo · Espacio o J: misil · K: bomba · L: bengalas · Esc: pausa
                </p>
              )}
              {portrait && <p className="text-center text-xs font-black text-[#e8742a]">📱 Gira el teléfono para jugar más cómodo.</p>}
            </div>
          </div>
        </div>
      )}

      {phase === 'over' && result && (
        <div className="absolute inset-0 z-30 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-[#fff8e7]/95 p-6 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h2 className="text-3xl font-black text-[#e8742a]">{result.reason === 'avion' ? '¡Te derribaron!' : '¡Vaciaron la despensa!'}</h2>
            <p className="mt-1 font-bold text-[#8a6e55]">
              {result.reason === 'avion' ? `${result.pilot} saltó en paracaídas y está bien.` : 'Los ratones se llevaron todo el pescado.'}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 font-black">
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Puntos</div>{result.score}</div>
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Oleada</div>{result.wave}</div>
              <div className="rounded-2xl bg-white/70 p-2"><div className="text-xs text-[#a08060]">Vehículos</div>{result.kills}</div>
            </div>
            <p className="mt-3 font-black">{result.record ? '🏆 ¡Nuevo récord!' : `Récord: ${result.best}`}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={play} className={GO}>Otra vez</button>
              <button type="button" onClick={toMenu} className={`${BTN} h-12`}>Cambiar avión</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'play' && paused && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[#3a2a6a]/30 p-4">
          <div className="rounded-[2rem] bg-[#fff8e7]/95 p-6 text-center shadow-[0_8px_0_rgba(91,70,54,0.18)] ring-4 ring-[#ead6b3]">
            <h2 className="text-3xl font-black">Pausa</h2>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={togglePause} className={GO}>Seguir</button>
              <button type="button" onClick={toMenu} className={`${BTN} h-12`}>Salir al hangar</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'play' && touchUi && !paused && (
        <>
          <div className="absolute bottom-0 left-0 top-16 z-10 w-1/2" onPointerDown={onStickDown} onPointerMove={onStickMove} onPointerUp={onStickUp} onPointerCancel={onStickUp}>
            {knob && (
              <div className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25 ring-2 ring-white/60" style={{ left: knob.x, top: knob.y - 64 }}>
                <div className="absolute left-1/2 top-1/2 h-10 w-10 rounded-full bg-white/80 shadow" style={{ transform: `translate(calc(-50% + ${knob.dx}px), calc(-50% + ${knob.dy}px))` }} />
              </div>
            )}
          </div>
          <div className="absolute bottom-6 right-4 z-10 flex items-end gap-3 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]">
            <TouchButton label="Bengalas" {...hold('flare')}>✨</TouchButton>
            <TouchButton label="Bomba" {...hold('bomb')}>💣</TouchButton>
            <TouchButton label="Misil" big {...hold('fire')}>🚀</TouchButton>
          </div>
        </>
      )}
    </div>
  );
}

function TouchButton({ label, big, children, ...rest }: { label: string; big?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`grid place-items-center rounded-full bg-[#fff8e7]/85 shadow-[0_4px_0_rgba(91,70,54,0.25)] ring-2 ring-white/70 active:translate-y-0.5 ${big ? 'h-20 w-20 text-4xl' : 'h-14 w-14 text-2xl'}`}
      {...rest}
    >
      {children}
    </button>
  );
}
