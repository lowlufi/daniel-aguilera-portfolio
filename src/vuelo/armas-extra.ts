import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R } from './dibujo';
import type { BombaNueva } from './fisica-tipos';
import type { FormaNueva, LookMisil } from './hangar';

/*
 * The second batch of player weapons, drawn: the new missile and rocket
 * bodies (armas-dibujo.ts's drawMisilKit hands them over here) and the new
 * bomb casings (drawBombaTipo hands those over). Screen coordinates, nose
 * to +x before rotating; static sprites are painted once and cached through
 * D.outlined, the rest is a few rects per frame.
 */

type Ctx = CanvasRenderingContext2D;

const FORMAS = new Set<string>(['mini', 'wgr21', 'zuni', 'python', 'mica', 'iris', 'meteor', 'brimstone', 'r60', 's530', 'jsm', 'fuegos']);
/** True for the missile bodies drawn here. */
export const esFormaExtra = (f: string): f is FormaNueva => FORMAS.has(f);

/** Outline colour per look, worked out once (looks are static objects). */
const tintas = new WeakMap<LookMisil, string>();
function tinta(l: LookMisil) {
  let c = tintas.get(l);
  if (!c) {
    c = D.tone(l.aletas, -0.55);
    tintas.set(l, c);
  }
  return c;
}

/** Body thickness (px) per family. */
const GROSOR: Record<FormaNueva, number> = {
  mini: 2, wgr21: 6, zuni: 5, python: 3, mica: 3, iris: 3, meteor: 3, brimstone: 4, r60: 2, s530: 4, jsm: 4, fuegos: 4,
};

/**
 * A player missile of the second batch pointing along `angle` (screen radians).
 * Same rules as drawMisilKit: fins behind, body, nose, then the family's
 * wings, strakes or scoops, and the motor flame while it burns.
 */
export function drawMisilExtra(g: Ctx, x: number, y: number, angle: number, burning: boolean, t: number, l: LookMisil & { forma: FormaNueva }): void {
  const f = l.forma;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(angle / 0.1) * 0.1);
  const len = Math.max(6, Math.round(l.largo * (f === 'fuegos' ? 0.6 : 0.85)));
  const th = GROSOR[f];
  const h = th >> 1;
  const x0 = -(len >> 1);
  const xn = x0 + len;
  const ink = tinta(l);
  if (f === 'fuegos') {
    // A firework: a long wooden stick trailing behind a paper tube with a star cap.
    R(g, x0 - 9, 0, 10, 1, '#8a5a2a');
    R(g, x0 - 9, 1, 10, 1, '#5a3a1a');
  }
  // Tail fins.
  if (f === 'zuni') {
    // Wrap-around fins flicked open.
    R(g, x0 - 1, -h - 3, 4, th + 6, ink);
    R(g, x0, -h - 2, 2, th + 4, l.aletas);
  } else if (f === 'wgr21') {
    // Tiny spin vanes on a fat tube.
    R(g, x0 - 1, -h - 1, 2, th + 2, ink);
  } else if (f === 'mini' || f === 'r60') {
    R(g, x0 - 1, -h - 2, 3, th + 4, ink);
    R(g, x0, -h - 1, 1, th + 2, l.aletas);
  } else if (f !== 'fuegos') {
    const fh = f === 's530' || f === 'brimstone' || f === 'jsm' ? 3 : 2;
    R(g, x0 - 1, -h - fh - 1, 3, th + fh * 2 + 2, ink);
    R(g, x0, -h - fh, 2, th + fh * 2, l.aletas);
  }
  // Body.
  R(g, x0, -h - 1, len, th + 2, ink);
  R(g, x0 + 1, -h, len - 2, th, l.cuerpo);
  if (f === 'jsm') {
    // Faceted: a darker flat underside and a sharp chine.
    R(g, x0 + 1, h - 1, len - 2, 1, ink);
    R(g, x0 + 2, -h, len - 6, 1, '#9aa0ac');
  } else if (f === 'fuegos') {
    // Paper wrap in stripes.
    for (let i = x0 + 1; i < xn - 1; i += 2) R(g, i, -h, 1, th, l.punta);
  } else R(g, x0 + 2, -h, Math.max(1, len - 6), 1, P.white);
  // Nose.
  if (f === 'wgr21') {
    // Blunt, dark, with a fuze nub.
    R(g, xn - 2, -h, 2, th, l.punta);
    R(g, xn, -1, 1, 2, ink);
  } else if (f === 'brimstone') {
    // Rounded seeker dome with a glassy eye.
    R(g, xn - 2, -h, 2, th, l.punta);
    R(g, xn, -h + 1, 1, th - 2, l.punta);
    R(g, xn - 1, -1, 1, 1, '#ff4a8a');
  } else if (f === 'fuegos') {
    // A paper cone with a star tip.
    R(g, xn - 1, -h, 2, th, l.punta);
    R(g, xn + 1, -1, 1, 2, l.punta);
    R(g, xn + 2, 0, 1, 1, P.white);
  } else {
    R(g, xn - 2, -h, 2, th, l.punta);
    R(g, xn, -h + 1, 1, Math.max(1, th - 2), l.punta);
    if (th >= 5) R(g, xn + 1, -1, 1, 2, l.punta);
    R(g, xn + (th >= 5 ? 2 : 1), Math.max(-h + 1, -1), 1, Math.max(1, Math.min(2, th - 2)), ink);
  }
  // Family details.
  if (f === 'python') {
    // Two sets of canards behind the seeker.
    for (const dx of [4, 6]) {
      R(g, xn - dx, -h - 2, 1, th + 4, ink);
      R(g, xn - dx, -h - 1, 1, th + 2, l.aletas);
    }
  } else if (f === 'r60') {
    R(g, xn - 3, -h - 2, 1, th + 4, ink);
  } else if (f === 'mica') {
    // Long thin strakes along most of the body.
    R(g, x0 + 2, -h - 2, len - 7, 1, ink);
    R(g, x0 + 2, h + 1, len - 7, 1, ink);
    R(g, x0 + 3, -h - 1, len - 9, 1, l.aletas);
    R(g, x0 + 3, h, len - 9, 1, l.aletas);
  } else if (f === 'iris') {
    // Small mid fins and a green band.
    const wx = x0 + (len >> 1);
    R(g, wx, -h - 2, 2, th + 4, ink);
    R(g, wx, -h - 1, 1, th + 2, l.aletas);
    R(g, xn - 4, -h, 1, th, '#5ae84a');
  } else if (f === 'meteor') {
    // The ramjet's two intake scoops under the body.
    const wx = x0 + (len >> 1) - 2;
    R(g, wx - 1, h + 1, 5, 2, ink);
    R(g, wx, h + 1, 3, 1, l.aletas);
    R(g, wx + 3, h + 1, 1, 1, '#22262c');
  } else if (f === 's530') {
    // Long cruciform wings mid-body.
    const wx = x0 + (len >> 1) - 3;
    R(g, wx - 1, -h - 4, 6, 3, ink);
    R(g, wx - 1, h + 1, 6, 3, ink);
    R(g, wx, -h - 3, 4, 2, l.aletas);
    R(g, wx, h + 1, 4, 2, l.aletas);
    R(g, xn - 4, -h, 1, th, P.gold);
  } else if (f === 'brimstone') {
    const wx = x0 + (len >> 1) - 1;
    R(g, wx, -h - 2, 3, th + 4, ink);
    R(g, wx, -h - 1, 2, th + 2, l.aletas);
  } else if (f === 'jsm') {
    // Pop-out wings under the body.
    const wx = x0 + (len >> 1);
    for (let i = 0; i < 3; i++) R(g, wx - i, h + i, 3, 1, i === 2 ? ink : l.aletas);
  } else if (f === 'zuni' || f === 'wgr21') {
    R(g, x0 + 4, -h, 1, th, f === 'zuni' ? '#c8a040' : P.gold);
  }
  if (burning) {
    const big = th > 4 ? 2 : 0;
    const fl = 2 + (Math.floor(t * 30) % 2) + big;
    const azul = f === 'meteor' || f === 'jsm';
    const fx = f === 'fuegos' ? x0 - 10 : x0;
    R(g, fx - fl, -1, fl, 2, azul ? '#6ac0ff' : f === 'fuegos' ? '#ffe070' : '#ff9a3c');
    R(g, fx - 2, -1, 1, 1, azul ? '#e8f8ff' : P.gold1);
    if (f === 'fuegos' && Math.floor(t * 24) % 2) R(g, fx - fl - 2, Math.floor(t * 40) % 3 - 1, 1, 1, P.white);
  }
  g.restore();
}

/* ── Bomb casings ────────────────────────────────────────────────────────── */

export const BOMBA_EXTRA: Record<BombaNueva, () => HTMLCanvasElement> = {
  // Silver finless fire tank with a fuze at each end.
  napalm: () => D.outlined('bomba|napalm', '#5a5e6a', 20, 10, 10, 5, (g) => {
    D.oval(g, 0, 0, 8, 3, '#a8aeba');
    D.oval(g, 0, -1, 7, 2, '#d8dce4');
    R(g, -5, -2, 8, 1, P.white);
    R(g, 8, -1, 2, 2, '#ff7a2a');
    R(g, -10, -1, 2, 2, '#ff7a2a');
    R(g, -1, -3, 1, 7, '#ff5a1a');
  }),
  // Slim olive penetrator with its chute pack and a rocket ring.
  pista: () => D.outlined('bomba|pista', '#2e3a1e', 22, 10, 11, 5, (g) => {
    D.oval(g, 1, 0, 8, 2, '#5a6a3a');
    D.oval(g, 1, -1, 7, 1, '#8a9a5a');
    R(g, 8, -1, 2, 2, '#3a3a3a');
    R(g, -2, -2, 1, 5, P.gold);
    R(g, -10, -3, 4, 7, '#c8b890');
    R(g, -9, -2, 2, 5, '#e8dcb0');
  }),
  // Grey canister with a white band and vent holes.
  humo: () => D.outlined('bomba|humo', '#3a3e48', 18, 12, 9, 6, (g) => {
    R(g, -5, -3, 11, 7, '#8a909c');
    R(g, -5, -3, 11, 2, '#b8bec8');
    R(g, -1, -3, 2, 7, P.white);
    for (const x of [-4, 3]) R(g, x, 1, 1, 1, '#3a3e48');
    R(g, 6, -2, 1, 5, '#6a707c');
    R(g, -8, -4, 2, 9, '#5a606c');
  }),
  // A horned sea mine with a red lamp.
  mina: () => D.outlined('bomba|mina', '#1a2a24', 16, 16, 8, 8, (g) => {
    D.disc(g, 0, 0, 5, '#2e4a3e');
    D.disc(g, -1, -1, 3, '#4a6a5a');
    for (const [x, y] of [[0, -7], [0, 6], [-7, 0], [6, 0], [-5, -5], [4, 4], [4, -5], [-5, 4]]) R(g, x, y, 2, 2, '#8a9a92');
    R(g, 0, -1, 2, 2, '#ff3a3a');
  }),
  // A slim glide bomb with long wings folded along its back.
  planeadora: () => D.outlined('bomba|planeadora', '#3a3a4a', 24, 12, 12, 6, (g) => {
    D.oval(g, 0, 0, 9, 2, '#9a9aaa');
    D.oval(g, 0, -1, 8, 1, '#c4c4d4');
    R(g, -6, -3, 12, 1, '#5a5a6a');
    R(g, 8, -1, 2, 2, '#3a3a4a');
    R(g, 9, -1, 1, 1, '#7af0ff');
    R(g, -11, -3, 3, 7, '#6a6a7a');
  }),
  // A star piñata: a round body, coloured cones and paper fringe.
  pinata: () => D.outlined('bomba|pinata', '#8a2a5a', 18, 18, 9, 9, (g) => {
    for (const [x, y, c] of [[0, -7, '#ffd23a'], [6, 0, '#3ad8ff'], [0, 6, '#5ae84a'], [-7, 0, '#9a6aff'], [-5, -5, '#ff8a3a'], [4, 4, '#ff4a8a']] as [number, number, string][]) {
      D.disc(g, x, y, 2, c);
    }
    D.disc(g, 0, 0, 4, '#ff6aa8');
    D.disc(g, -1, -1, 2, '#ffb4d4');
    R(g, -4, 1, 9, 1, '#ffd23a');
    R(g, -3, 3, 7, 1, '#3ad8ff');
  }),
  // A dart dispenser: yellow and grey stripes, the dart tips peeking out.
  dardos: () => D.outlined('bomba|dardos', '#3a3a2a', 20, 12, 10, 6, (g) => {
    R(g, -6, -3, 13, 7, '#8a8a7a');
    for (let x = -5; x < 7; x += 3) R(g, x, -3, 1, 7, P.gold);
    R(g, -6, -3, 13, 1, '#b8b8a8');
    for (let y = -2; y <= 2; y += 2) R(g, 7, y, 2, 1, '#d8d8e0');
    R(g, -9, -4, 3, 9, '#5a5a4a');
  }),
  // A long streamlined earthquake bomb with canted fins.
  sismica: () => D.outlined('bomba|sismica', '#1e2a1a', 26, 12, 13, 6, (g) => {
    D.oval(g, 2, 0, 9, 3, '#3a4a2e');
    D.oval(g, 2, -1, 8, 2, '#5a6a44');
    R(g, -4, -2, 10, 1, '#7a8a5a');
    R(g, 10, -1, 2, 2, '#2a3420');
    R(g, -2, -3, 1, 7, P.gold);
    R(g, -12, -4, 5, 2, '#3a4a2e');
    R(g, -12, 3, 5, 2, '#3a4a2e');
    R(g, -11, -1, 4, 2, '#3a4a2e');
  }),
};
