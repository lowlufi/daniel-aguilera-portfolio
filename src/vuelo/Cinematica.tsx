import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { menu } from '../game/audio';
import type { Piloto } from './fisica-tipos';
import { PILOTOS } from './pilotos';
import { ESC_H, ESC_W, pintarEscena, retratoExtra } from './escenas';
import { HABLANTES, HISTORIA, marcarVista, type Guion, type GuionId, type Hablante } from './historia';
import { FPS, FRAMES, retrato } from './retratos';

/*
 * The cutscene player: one pixel stage (escenas.ts) under a gentle camera,
 * a typewriter dialog box with the speaker's portrait, and the way out at any
 * moment («Saltar», Esc, or holding a finger down).
 *
 *   <Cinematica guion="prologo" piloto="dui" alTerminar={(como) => …} />
 *
 * Enter / Space / → / a tap: finish the line, then the next one.
 * Esc / «Saltar» / a long press: skip the whole scene.
 * When it ends or is skipped the script is remembered as seen (historia.ts).
 */

export type FinCinematica = 'fin' | 'saltada';

type Props = {
  /** The script, or its id in HISTORIA. */
  guion: Guion | GuionId;
  /** The pilot the player picked: who «piloto» lines belong to and who's in front. */
  piloto?: Piloto;
  /** Called once, when the last line is done or the scene is skipped. */
  alTerminar: (como: FinCinematica) => void;
  /** «Menos movimiento»: no camera moves and no flashes (the system setting counts too). */
  calma?: boolean;
  /** Remember it as seen (default true). */
  marcar?: boolean;
};

/** Output canvas: twice the stage, so camera moves land on half pixels. */
const OUT_W = ESC_W * 2;
const OUT_H = ESC_H * 2;
const HOLD_MS = 900;
const LETRA_MS = 28;

const suave = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** A tiny pixel glyph (triangle «next», double triangle «skip»). */
function Glifo({ i, s = 2, color = '#3a2a6a' }: { i: 'sig' | 'saltar'; s?: number; color?: string }) {
  const filas = i === 'sig' ? ['k....', 'kkk..', 'kkkkk', 'kkk..', 'k....'] : ['k...k...', 'kk..kk..', 'kkk.kkk.', 'kk..kk..', 'k...k...'];
  return (
    <svg aria-hidden width={filas[0].length * s} height={filas.length * s} viewBox={`0 0 ${filas[0].length} ${filas.length}`} shapeRendering="crispEdges" className="shrink-0">
      {filas.flatMap((f, y) => [...f].map((ch, x) => (ch === 'k' ? <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
    </svg>
  );
}

export default function Cinematica({ guion, piloto = 'dui', alTerminar, calma, marcar = true }: Props) {
  const g = useMemo(() => (typeof guion === 'string' ? HISTORIA[guion] : guion), [guion]);
  const quieto = useMemo(() => !!calma || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches), [calma]);
  const [b, setB] = useState(0);
  const [l, setL] = useState(0);
  const [n, setN] = useState(0);
  const beat = g.beats[b];
  const linea = beat.lineas[l];
  const quien: Exclude<Hablante, 'piloto'> = linea.quien === 'piloto' ? piloto : linea.quien;
  const info = HABLANTES[quien];
  const texto = linea.texto;
  const escribiendo = n < texto.length;

  const lienzo = useRef<HTMLCanvasElement>(null);
  const cara = useRef<HTMLCanvasElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const terminado = useRef(false);
  // The loop reads these without restarting.
  const vivo = useRef({ b, quien, escribiendo, t0: performance.now() });
  vivo.current.quien = quien;
  vivo.current.escribiendo = escribiendo;

  const terminar = useCallback(
    (como: FinCinematica) => {
      if (terminado.current) return;
      terminado.current = true;
      if (marcar) marcarVista(g.id);
      if (como === 'saltada') menu.volver();
      alTerminar(como);
    },
    [alTerminar, g.id, marcar],
  );

  // A new beat: its clock restarts and its sound plays.
  useEffect(() => {
    vivo.current.b = b;
    vivo.current.t0 = performance.now();
    const s = g.beats[b].sonido;
    if (s) menu[s]();
  }, [b, g]);

  // The typewriter, with a soft tick every few letters.
  useEffect(() => {
    setN(0);
  }, [b, l]);
  useEffect(() => {
    if (!escribiendo) return;
    const id = window.setTimeout(() => {
      setN((k) => Math.min(texto.length, k + 1));
      if (n % 4 === 0 && texto[n] !== ' ') menu.mover();
    }, LETRA_MS);
    return () => window.clearTimeout(id);
  }, [n, escribiendo, texto]);

  const avanzar = useCallback(() => {
    if (terminado.current) return;
    if (n < texto.length) return setN(texto.length);
    if (l < beat.lineas.length - 1) {
      setL(l + 1);
      return;
    }
    if (b < g.beats.length - 1) {
      setL(0);
      setB(b + 1);
      return;
    }
    terminar('fin');
  }, [n, texto, l, beat, b, g, terminar]);

  // The stage and the portrait, ~30 fps.
  useEffect(() => {
    const out = lienzo.current;
    const face = cara.current;
    if (!out || !face) return;
    const og = out.getContext('2d')!;
    og.imageSmoothingEnabled = false;
    const fg = face.getContext('2d')!;
    const buf = document.createElement('canvas');
    buf.width = ESC_W;
    buf.height = ESC_H;
    const bg = buf.getContext('2d')!;
    let raf = 0;
    let ultimo = 0;
    const pinta = (now: number) => {
      raf = requestAnimationFrame(pinta);
      if (now - ultimo < 32) return;
      ultimo = now;
      const v = vivo.current;
      const bt = g.beats[v.b];
      const t = (now - v.t0) / 1000;
      pintarEscena(bg, bt.escena, t, piloto, quieto);
      // The camera eases from «desde» to «hasta» over the beat (fixed when calm).
      const largo = Math.max(5, bt.lineas.reduce((s, x) => s + x.texto.length, 0) / 22);
      const k = quieto ? 1 : suave(t / largo);
      const a = bt.desde ?? [128, 72, 1], z = bt.hasta ?? a;
      const cx = a[0] + (z[0] - a[0]) * k, cy = a[1] + (z[1] - a[1]) * k, zoom = Math.max(1, a[2] + (z[2] - a[2]) * k);
      const sw = ESC_W / zoom, sh = ESC_H / zoom;
      const sx = Math.max(0, Math.min(ESC_W - sw, cx - sw / 2)), sy = Math.max(0, Math.min(ESC_H - sh, cy - sh / 2));
      og.drawImage(buf, Math.round(sx * 2) / 2, Math.round(sy * 2) / 2, sw, sh, 0, 0, OUT_W, OUT_H);
      // Each beat opens out of black.
      if (t < 0.45) {
        og.globalAlpha = 1 - t / 0.45;
        og.fillStyle = '#0a0716';
        og.fillRect(0, 0, OUT_W, OUT_H);
        og.globalAlpha = 1;
      }
      // The speaker: the pilots' big portraits, or a small bust for the others.
      fg.clearRect(0, 0, face.width, face.height);
      const q = v.quien;
      if ((PILOTOS as string[]).includes(q)) {
        const m = q as Piloto;
        const pose = v.escribiendo && !quieto ? 'elegido' : 'quieto';
        const f = quieto ? 0 : Math.floor(t * FPS[pose]) % FRAMES[pose];
        fg.drawImage(retrato(m, pose, f), 0, 0, face.width, face.height);
      } else if (q === 'margarita' || q === 'raton' || q === 'emperador') {
        const boca = v.escribiendo && Math.floor(t * 8) % 2 === 0;
        const parpado = t % 3.2 > 3.05;
        fg.drawImage(retratoExtra(q, boca, parpado), 0, 0, face.width, face.height);
      }
    };
    raf = requestAnimationFrame(pinta);
    return () => cancelAnimationFrame(raf);
  }, [g, piloto, quieto]);

  // The keyboard belongs to the scene while it plays (nothing reaches the game or the menus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') return;
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      const enSaltar = (e.target as HTMLElement | null)?.dataset?.cine === 'saltar';
      if (e.code === 'Escape') {
        e.preventDefault();
        terminar('saltada');
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'KeyZ') {
        e.preventDefault();
        if (e.repeat) return;
        if (enSaltar) terminar('saltada');
        else avanzar();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [avanzar, terminar]);

  // Focus in on open, back where it was on close.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    raiz.current?.focus({ preventScroll: true });
    return () => {
      if (antes && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, []);

  // Tap to advance; hold to skip (a ring fills up under the finger).
  const [hold, setHold] = useState<{ id: number; x: number; y: number; t0: number } | null>(null);
  const [holdK, setHoldK] = useState(0);
  useEffect(() => {
    if (!hold) return setHoldK(0);
    let raf = 0;
    const paso = () => {
      const k = (performance.now() - hold.t0) / HOLD_MS;
      setHoldK(k);
      if (k >= 1) {
        setHold(null);
        terminar('saltada');
        return;
      }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [hold, terminar]);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that already ended */
    }
    setHold({ id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now() });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hold || e.pointerId !== hold.id) return;
    const corto = performance.now() - hold.t0 < 350;
    setHold(null);
    if (corto) avanzar();
  };

  const narrador = quien === 'narrador';
  const ultimo = b === g.beats.length - 1 && l === beat.lineas.length - 1;
  return (
    <div
      ref={raiz}
      role="dialog"
      aria-modal="true"
      aria-label={g.nombre}
      tabIndex={-1}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => setHold(null)}
      className="cine pointer-events-auto fixed inset-0 z-[80] flex touch-none select-none flex-col overflow-hidden bg-[#0a0716] outline-none"
    >
      {/* The stage takes what the dialog box leaves, letterboxed (nothing hides behind the text). */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={lienzo} width={OUT_W} height={OUT_H} className="cine-lienzo absolute inset-0" aria-hidden />
      </div>

      {beat.titulo && (
        <div key={`t${b}`} aria-hidden className="cine-titulo pointer-events-none absolute inset-x-0 top-[18%] px-4 text-center">
          <p className="logo-dui text-3xl font-black leading-tight sm:text-5xl [@media(max-height:500px)]:text-2xl">{beat.titulo}</p>
        </div>
      )}

      {/* Top: the scene's name, where we are, and the way out. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <span className="hud-panel h-8 gap-2 px-2 text-xs">
          <span className="font-black">{g.nombre}</span>
          <span aria-hidden className="inline-flex gap-1">
            {g.beats.map((_, i) => (
              <i key={i} className={`block h-1.5 w-1.5 ${i <= b ? 'bg-[#ffd84a]' : 'bg-[#55467f]'}`} />
            ))}
          </span>
        </span>
        <button type="button" data-cine="saltar" onClick={() => terminar('saltada')} className="hud-key h-9 gap-1.5 px-3 text-sm">
          Saltar
          <Glifo i="saltar" s={1.5} />
          <span className="hidden text-[10px] font-bold opacity-60 sm:inline">Esc</span>
        </button>
      </div>

      {/* The dialog box. */}
      <div className="relative flex shrink-0 justify-center p-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="cine-dialogo hud-panel w-full max-w-3xl items-stretch gap-3 whitespace-normal p-2.5 [@media(max-height:500px)]:p-2">
          <span className={`hud-socket shrink-0 self-center overflow-hidden ${narrador ? 'hidden' : 'grid'} h-16 w-16 place-items-center sm:h-20 sm:w-20 [@media(max-height:500px)]:h-14 [@media(max-height:500px)]:w-14`}>
            <canvas ref={cara} width={96} height={96} aria-hidden className="h-full w-full" style={{ imageRendering: 'pixelated' }} />
          </span>
          <div className="min-w-0 flex-1">
            {!narrador && (
              <div className="text-sm font-black uppercase tracking-wide" style={{ color: info.color }}>
                {info.nombre}
              </div>
            )}
            <p aria-hidden className={`min-h-[2.8em] text-[15px] font-bold leading-snug sm:text-lg ${narrador ? 'text-center italic text-[#ffe3a3]' : ''}`}>
              {texto.slice(0, n)}
              <span className="opacity-0">{texto.slice(n)}</span>
            </p>
          </div>
          <span aria-hidden className={`self-end pb-1 ${escribiendo ? 'opacity-0' : 'cine-sigue'}`}>
            <Glifo i="sig" s={2} color="#ffd84a" />
          </span>
        </div>
      </div>
      {/* Read out whole, once per line. */}
      <p className="sr-only" aria-live="polite">
        {narrador ? texto : `${info.nombre}: ${texto}`}
      </p>
      <p className="sr-only">{ultimo ? 'Enter para terminar' : 'Enter para seguir'}, Escape para saltar la escena.</p>

      {hold && holdK > 0.22 && (
        <div aria-hidden className="pointer-events-none fixed z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: hold.x, top: hold.y }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="26" fill="rgba(18,12,36,0.6)" stroke="#55467f" strokeWidth="6" />
            <circle cx="32" cy="32" r="26" fill="none" stroke="#ffd84a" strokeWidth="6" strokeDasharray={`${Math.min(1, holdK) * 163} 163`} transform="rotate(-90 32 32)" />
          </svg>
          <span className="hud-panel absolute left-1/2 top-full mt-1 -translate-x-1/2 px-2 py-0.5 text-[11px]">Mantén para saltar</span>
        </div>
      )}
    </div>
  );
}
