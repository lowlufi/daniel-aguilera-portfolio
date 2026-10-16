import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import type { GameEvents, GameStore } from './store';
import { sfx } from './audio';
import type { WeatherId } from './weather';
import {
  DANIEL,
  DOCK,
  GARDEN,
  GARDEN_PLOTS,
  HOUSE,
  INTERACTABLES,
  ISLAND_R,
  MAILBOX,
  PATH_STONES,
  PLAZA,
  PROJECT_SIGNS,
  STAR_SPOTS,
  STATION,
  TREES,
  WELCOME,
  WORKSHOP,
  blocksGrass,
  onDock,
  resolveCollisions,
  type InteractableId,
} from './world';

/*
 * The island drawn with text.
 *
 * The 3D island (three.js + post-processing) dragged on low-end phones and
 * laptops without a GPU. This draws the same world, with the same rules, as a
 * grid of characters in a <pre>: no WebGL, no shaders, a few thousand
 * characters per frame at most, and only when something on screen changed.
 *
 * It keeps the contract the 3D scene had with IslandGame (store + events), so
 * the notebook, dialogs, stamps, stars and achievements work unchanged.
 *
 * Only plain ASCII is used for the map: symbols outside it (♣ ★ ≈) fall back
 * to other fonts on Android and break the grid.
 */

type Props = {
  store: GameStore;
  events: MutableRefObject<GameEvents>;
  onWalkTo: (id: InteractableId) => void;
  weather: WeatherId;
  reduceMotion: boolean;
  paused: boolean;
};

// World meters per character. A monospace cell is about twice as tall as it
// is wide, so a row covers twice the distance of a column.
const CX = 0.6;
const CZ = 1.2;
const X0 = -34;
const Z0 = -34;
const COLS = Math.ceil(68 / CX);
const ROWS = Math.ceil(70 / CZ);

const toCol = (x: number) => Math.floor((x - X0) / CX);
const toRow = (z: number) => Math.floor((z - Z0) / CZ);
const cellX = (c: number) => X0 + (c + 0.5) * CX;
const cellZ = (r: number) => Z0 + (r + 0.5) * CZ;

// Color classes, defined in index.css under .ascii-isla (one palette per weather).
type Ink =
  | 'sea' | 'sea2' | 'sand' | 'grass' | 'cut' | 'path' | 'wood' | 'tree' | 'pine' | 'bloom'
  | 'wall' | 'roof' | 'dui' | 'daniel' | 'star' | 'glint' | 'red' | 'cyan' | 'yellow' | 'orange'
  | 'pink' | 'white' | 'label' | 'goal' | 'seen' | 'rain' | 'dim'
  | `p${number}`;

type Cell = { ch: string; ink: Ink };

/* ── The static map, built once ─────────────────────────────────────────── */

const base: Cell[] = new Array(COLS * ROWS);
const grassCells: number[] = [];

function put(c: number, r: number, ch: string, ink: Ink) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
  base[r * COLS + c] = { ch, ink };
}
function art(x: number, z: number, lines: string[], ink: Ink, roofInk?: Ink) {
  const c0 = toCol(x) - Math.floor(lines[0].length / 2);
  const r0 = toRow(z) - Math.floor(lines.length / 2);
  lines.forEach((line, dr) =>
    [...line].forEach((ch, dc) => {
      if (ch !== ' ') put(c0 + dc, r0 + dr, ch, dr < 2 && roofInk ? roofInk : ink);
    }),
  );
}

(function buildBase() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = cellX(c);
      const z = cellZ(r);
      const d = Math.hypot(x, z);
      let cell: Cell;
      if (onDock(x, z)) cell = { ch: '=', ink: 'wood' };
      else if (d > ISLAND_R + 0.5) cell = { ch: '~', ink: 'sea' };
      else if (d > ISLAND_R - 0.3) cell = { ch: '.', ink: 'sand' };
      else if (!blocksGrass(x, z)) {
        cell = { ch: '"', ink: 'grass' };
        grassCells.push(r * COLS + c);
      } else cell = { ch: ' ', ink: 'grass' };
      base[r * COLS + c] = cell;
    }
  for (const s of PATH_STONES) put(toCol(s.x), toRow(s.z), ':', 'path');
  // Dock posts on both sides of the planks.
  for (let z = DOCK.z0; z < DOCK.z1; z += CZ) {
    put(toCol(DOCK.x - DOCK.halfW) - 1, toRow(z), '|', 'wood');
    put(toCol(DOCK.x + DOCK.halfW) + 1, toRow(z), '|', 'wood');
  }
  for (const t of TREES) {
    const ink: Ink = t.kind === 'pine' ? 'pine' : t.kind === 'blossom' ? 'bloom' : 'tree';
    const ch = t.kind === 'pine' ? '^' : 'Y';
    const c = toCol(t.x);
    const r = toRow(t.z);
    put(c, r, ch, ink);
    if (t.scale > 1.05) {
      put(c - 1, r, ch, ink);
      put(c + 1, r, ch, ink);
    }
  }
  art(HOUSE.x, HOUSE.z, ['  ______  ', ' /      \\ ', '/________\\', '| [] [] |', '|___##___|'], 'wall', 'roof');
  art(WORKSHOP.x, WORKSHOP.z, ['  _______  ', ' /=======\\ ', '/_________\\', '| TALLER  |', '|___[_]___|'], 'wall', 'roof');
  art(PLAZA.x, PLAZA.z, ['[===]'], 'wood');
  art(WELCOME.x, WELCOME.z, ['T'], 'label');
  art(STATION.x, STATION.z, ['!'], 'cyan');
  art(MAILBOX.x, MAILBOX.z, ['M'], 'red');
  for (const p of GARDEN_PLOTS) {
    const [ch, ink]: [string, Ink] =
      p.kind === 'sunflower' ? ['Q', 'yellow'] : p.kind === 'tomato' ? ['o', 'red'] : p.kind === 'carrot' ? ['v', 'orange'] : ['%', 'tree'];
    art(p.x, p.z, [`${ch} ${ch}`, ` ${ch} `], ink);
  }
  // Fence around the garden.
  for (let dx = -3.4; dx <= 3.4; dx += CX) {
    put(toCol(GARDEN.x + dx), toRow(GARDEN.z - 3.2), '-', 'wood');
    if (Math.abs(dx) > 1.2) put(toCol(GARDEN.x + dx), toRow(GARDEN.z + 3.2), '-', 'wood');
  }
})();

type Label = { text: string; x: number; z: number; goal?: InteractableId; nearOnly?: number };
const LABELS: Label[] = [
  { text: 'Casa de Daniel', x: HOUSE.x, z: HOUSE.z - 3.6 },
  { text: 'Taller', x: WORKSHOP.x, z: WORKSHOP.z - 3.6 },
  { text: 'Proyectos', x: PLAZA.x, z: PLAZA.z - 1.2, goal: 'board' },
  { text: 'Huerto de habilidades', x: GARDEN.x, z: GARDEN.z - 4.4, goal: 'garden' },
  { text: 'Buzón', x: MAILBOX.x, z: MAILBOX.z - 1.2, goal: 'mailbox' },
  { text: '¡Bienvenid@!', x: WELCOME.x, z: WELCOME.z - 1.2, goal: 'welcome' },
  { text: 'Daniel', x: DANIEL.x, z: DANIEL.z - 1.2, goal: 'daniel' },
  // Below the antenna: above it, it ran into the garden's label.
  { text: 'Estación ESP32', x: STATION.x, z: STATION.z + 1.2 },
  { text: 'Muelle', x: DOCK.x, z: DOCK.z1 + 1, nearOnly: 5 },
  ...PROJECT_SIGNS.map((s) => ({ text: s.project.title, x: s.x, z: s.z - 1.2, nearOnly: 2.6 })),
];

const IDLE_HINT_AFTER = 8;
const REGROW_AFTER = 45;

const esc = (ch: string) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch);

export default function AsciiScene({ store, events, onWalkTo, weather, reduceMotion, paused }: Props) {
  const pre = useRef<HTMLPreElement>(null);
  const view = useRef({ cols: 60, rows: 30, cw: 9, ch: 18, c0: 0, r0: 0, w: 0, h: 0 });
  const props = useRef({ weather, reduceMotion, onWalkTo });
  props.current = { weather, reduceMotion, onWalkTo };

  // Per-session state the 3D scene kept in its components.
  const sim = useRef({
    cutAt: new Float64Array(COLS * ROWS).fill(-1),
    stars: STAR_SPOTS.map((_, i) => ({ revealed: store.starsTaken.has(i), taken: store.starsTaken.has(i) })),
    particles: [] as { x: number; z: number; vx: number; vz: number; life: number; ch: string; ink: Ink }[],
    drops: [] as { c: number; r: number; life: number }[],
    dir: new THREE.Vector2(0, 1),
    stuck: { t: 0, d: Infinity, target: null as THREE.Vector3 | null },
    idle: 0,
    stepT: 0,
    nearT: 0,
    lastDraw: 0,
    dirty: true,
    time: 0,
  });

  /* Hooks the UI calls into: cutting, stars, particle bursts. */
  useEffect(() => {
    const s = sim.current;
    store.grassTotal = grassCells.length;
    store.cutAt = (x, z, r) => {
      const now = s.time;
      let n = 0;
      for (let rr = toRow(z - r); rr <= toRow(z + r); rr++)
        for (let cc = toCol(x - r); cc <= toCol(x + r); cc++) {
          if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) continue;
          const i = rr * COLS + cc;
          if (base[i].ch !== '"' || s.cutAt[i] >= 0) continue;
          if ((cellX(cc) - x) ** 2 + (cellZ(rr) - z) ** 2 > r * r) continue;
          s.cutAt[i] = now;
          n++;
        }
      if (n) s.dirty = true;
      return n;
    };
    store.revealAt = (x, z, r) => {
      s.stars.forEach((st, i) => {
        if (st.revealed) return;
        const p = STAR_SPOTS[i];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + 0.5) ** 2) {
          st.revealed = true;
          s.dirty = true;
          sfx.reveal();
          events.current.onStarRevealed();
        }
      });
    };
    store.burst = (kind, x, z) => {
      if (props.current.reduceMotion) return;
      const R = Math.random;
      const add = (n: number, spread: number, ch: string, inks: Ink[], life: number, up = 0) => {
        for (let k = 0; k < n; k++)
          s.particles.push({ x: x + (R() - 0.5) * spread, z: z + (R() - 0.5) * spread, vx: (R() - 0.5) * 2, vz: -up - R() * up, life: life * (0.6 + R() * 0.6), ch, ink: inks[k % inks.length] });
      };
      if (kind === 'hearts') add(6, 1, '+', ['pink', 'red'], 0.9, 2.5);
      else if (kind === 'water') add(30, 6, "'", ['cyan', 'white'], 1.2);
      else if (kind === 'harvest') add(20, 5, 'o', ['orange', 'red', 'yellow', 'tree'], 1.3, 2);
      else add(60, 16, '*', ['pink', 'yellow', 'cyan', 'orange', 'tree'], 3, 0.5);
      s.dirty = true;
    };
  }, [store, events]);

  /*
   * Fit the font so the view shows a sensible number of columns.
   *
   * Measured again whenever the box changes size (checked on every draw, not
   * only by ResizeObserver): the first measure can run before the stylesheet
   * applies, with a proportional font and the wrong box, and on phones the
   * map then spilled off-screen and taps landed on the wrong cell.
   */
  const fit = useCallback(() => {
    const el = pre.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(40);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;font-size:100px';
    el.appendChild(probe);
    const ratio = probe.getBoundingClientRect().width / 40 / 100 || 0.6;
    probe.remove();
    // ~40 columns on a phone, up to ~110 on a wide screen.
    const want = Math.max(40, Math.min(110, Math.round(w / 13)));
    const fs = w / want / ratio;
    el.style.fontSize = `${fs}px`;
    const v = view.current;
    v.cw = fs * ratio;
    v.ch = fs * 1.2;
    v.cols = Math.ceil(w / v.cw);
    v.rows = Math.ceil(h / v.ch);
    v.w = w;
    v.h = h;
    sim.current.dirty = true;
    if (import.meta.env.DEV) (window as unknown as { __ascii?: unknown }).__ascii = { ...v, ratio, fs };
  }, []);

  useEffect(() => {
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  /* The loop: same movement rules as the 3D scene, drawing only on change. */
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    const s = sim.current;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      s.time += dt;
      const st = store;
      const k = st.keys;

      let ix = 0;
      let iz = 0;
      if (!st.frozen) {
        if (k.has('w') || k.has('arrowup')) iz -= 1;
        if (k.has('s') || k.has('arrowdown')) iz += 1;
        if (k.has('a') || k.has('arrowleft')) ix -= 1;
        if (k.has('d') || k.has('arrowright')) ix += 1;
        ix += st.joy.x;
        iz += st.joy.z;
      }
      let len = Math.hypot(ix, iz);
      if (len > 1) {
        ix /= len;
        iz /= len;
        len = 1;
      }
      let want = 0;
      if (len > 0.08) {
        st.target = null;
        st.targetId = null;
        const run = k.has('shift') || Math.hypot(st.joy.x, st.joy.z) > 0.92;
        // The map is seen from straight above: up is up, no camera to rotate.
        s.dir.set(ix, iz).normalize();
        want = len * (run ? 6.4 : 3.8);
      } else if (st.target && !st.frozen) {
        const dx = st.target.x - st.pos.x;
        const dz = st.target.z - st.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          const id = st.targetId;
          st.target = null;
          st.targetId = null;
          if (id) events.current.onArrive(id);
        } else {
          s.dir.set(dx / d, dz / d);
          want = Math.min(5.2, d * 3 + 1.2);
          if (s.stuck.target !== st.target) {
            s.stuck = { t: 0, d, target: st.target };
          }
          if (d < s.stuck.d - 0.05) {
            s.stuck.t = 0;
            s.stuck.d = d;
          } else if ((s.stuck.t += dt) > 1.2) {
            const id = st.targetId;
            st.target = null;
            st.targetId = null;
            s.stuck = { t: 0, d: Infinity, target: null };
            if (id && d < 3) events.current.onArrive(id);
          }
        }
      } else {
        s.stuck = { t: 0, d: Infinity, target: null };
      }

      st.speed += (want - st.speed) * (1 - Math.exp(-12 * dt));
      if (st.speed > 0.05) {
        const before = toCol(st.pos.x) * 10000 + toRow(st.pos.z);
        st.pos.x += s.dir.x * st.speed * dt;
        st.pos.z += s.dir.y * st.speed * dt;
        resolveCollisions(st.pos);
        if (toCol(st.pos.x) * 10000 + toRow(st.pos.z) !== before) s.dirty = true;
        if ((s.stepT += dt) > 0.32 && st.speed > 1) {
          s.stepT = 0;
          sfx.step();
        }
      }
      if (want > 0) st.facing = Math.atan2(s.dir.x, s.dir.y);

      // Cutting: hold Space / F or the on-screen scissors.
      st.swing = Math.max(0, st.swing - dt);
      const cutting = !st.frozen && (k.has(' ') || k.has('f') || st.cutHeld);
      if (cutting && st.swing <= 0) {
        st.swing = 0.32;
        s.dirty = true;
        const fx = st.pos.x + Math.sin(st.facing) * 0.95;
        const fz = st.pos.z + Math.cos(st.facing) * 0.95;
        const n = st.cutAt(fx, fz, 1.3);
        st.revealAt(fx, fz, 1.3);
        if (n > 0) {
          sfx.snip();
          events.current.onCut(n);
        }
      }

      // Stars: walk over a revealed one to take it.
      s.stars.forEach((sp, i) => {
        if (!sp.revealed || sp.taken) return;
        const p = STAR_SPOTS[i];
        if ((st.pos.x - p.x) ** 2 + (st.pos.z - p.z) ** 2 < 1.1) {
          sp.taken = true;
          s.dirty = true;
          sfx.star();
          events.current.onStar(i);
        }
      });

      // Idle hint.
      if (st.started && !st.frozen && st.speed < 0.1) {
        if (s.idle >= 0 && (s.idle += dt) > IDLE_HINT_AFTER) {
          s.idle = -1;
          events.current.onIdleHint?.();
        }
      } else if (st.speed > 0.3) s.idle = 0;

      if ((s.nearT += dt) > 0.1) {
        s.nearT = 0;
        let best: InteractableId | null = null;
        let bestD = Infinity;
        for (const it of INTERACTABLES) {
          const d = Math.hypot(it.x - st.pos.x, it.z - st.pos.z);
          if (d < it.radius && d < bestD) {
            best = it.id;
            bestD = d;
          }
        }
        if (best !== st.nearId) {
          st.nearId = best;
          s.dirty = true;
          events.current.onNear(best);
        }
      }

      // Particles and weather drops.
      if (s.particles.length) {
        for (const p of s.particles) {
          p.life -= dt;
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          p.vz += 3 * dt;
        }
        s.particles = s.particles.filter((p) => p.life > 0);
        s.dirty = true;
      }

      // Something changes every so often even standing still (waves, stars,
      // rain); 5 frames a second is plenty for that.
      const ambient = !props.current.reduceMotion && now - s.lastDraw > 200;
      if (s.dirty || ambient) draw(now);
    };

    const draw = (now: number) => {
      const el = pre.current;
      if (!el) return;
      s.dirty = false;
      s.lastDraw = now;
      const box = el.parentElement;
      if (box && (box.clientWidth !== view.current.w || box.clientHeight !== view.current.h)) fit();
      const v = view.current;
      const st = store;
      const { weather: w, reduceMotion: still } = props.current;
      const t = still ? 0 : Math.floor(s.time * 2.5);

      // Camera: centered on Dui, clamped to the map (centered if the map is smaller).
      const pc = toCol(st.pos.x);
      const pr = toRow(st.pos.z);
      v.c0 = COLS <= v.cols ? Math.floor((COLS - v.cols) / 2) : Math.min(Math.max(0, pc - Math.floor(v.cols / 2)), COLS - v.cols);
      v.r0 = ROWS <= v.rows ? Math.floor((ROWS - v.rows) / 2) : Math.min(Math.max(0, pr - Math.floor(v.rows / 2)), ROWS - v.rows);

      const over = new Map<number, Cell>();
      const at = (c: number, r: number, ch: string, ink: Ink) => {
        if (c >= 0 && r >= 0 && c < COLS && r < ROWS) over.set(r * COLS + c, { ch, ink });
      };

      // Grass grows back.
      for (const i of grassCells) {
        const ct = s.cutAt[i];
        if (ct >= 0 && s.time - ct > REGROW_AFTER) s.cutAt[i] = -1;
      }

      // Project signs: read ones turn green.
      PROJECT_SIGNS.forEach((sg, i) => at(toCol(sg.x), toRow(sg.z), 'T', st.seenProjects.has(sg.project.id) ? 'seen' : (`p${i % 8}` as Ink)));

      // Stars: hidden ones glint now and then through the grass.
      s.stars.forEach((sp, i) => {
        if (sp.taken) return;
        const p = STAR_SPOTS[i];
        if (sp.revealed) at(toCol(p.x), toRow(p.z), '*', (t + i) % 2 ? 'star' : 'yellow');
        else if (!still && Math.sin(s.time * 2.2 + i * 1.7) > 0.93) at(toCol(p.x), toRow(p.z), '+', 'glint');
      });

      at(toCol(DANIEL.x), toRow(DANIEL.z), 'D', 'daniel');

      for (const p of s.particles) at(toCol(p.x), toRow(p.z), p.ch, p.ink);

      // Rain and snow fall over everything within view.
      if ((w === 'lluvia' || w === 'nieve') && !still) {
        if (s.drops.length < 40) for (let k = 0; k < 8; k++) s.drops.push({ c: v.c0 + Math.floor(Math.random() * v.cols), r: v.r0 + Math.floor(Math.random() * v.rows), life: 0.6 + Math.random() });
        for (const d of s.drops) {
          d.life -= 0.2;
          d.r += 1;
          if (w === 'lluvia') d.c -= 1;
        }
        s.drops = s.drops.filter((d) => d.life > 0);
        for (const d of s.drops) at(d.c, d.r, w === 'lluvia' ? '/' : '.', w === 'lluvia' ? 'rain' : 'white');
      } else s.drops.length = 0;

      // Labels: always for landmarks, near-only for project signs and the dock.
      for (const l of LABELS) {
        const d = Math.hypot(l.x - st.pos.x, l.z - st.pos.z);
        if (l.nearOnly && d > l.nearOnly) continue;
        const isGoal = !!l.goal && l.goal === st.goalId;
        const text = isGoal ? `> ${l.text} <` : l.text;
        const c0 = toCol(l.x) - Math.floor(text.length / 2);
        const r = toRow(l.z);
        [...text].forEach((ch, j) => at(c0 + j, r, ch, isGoal ? 'goal' : 'label'));
      }

      // Dui last, so no label or raindrop ever hides him; and the swipe in
      // front of him while cutting.
      at(pc, pr, '@', 'dui');
      if (st.swing > 0) {
        const fx = st.pos.x + Math.sin(st.facing) * 1;
        const fz = st.pos.z + Math.cos(st.facing) * 1.2;
        at(toCol(fx), toRow(fz), Math.abs(Math.sin(st.facing)) > 0.5 ? '/' : '-', 'white');
      }

      // Fog: only what is close to Dui keeps its color.
      const fogR = w === 'niebla' ? 11 : Infinity;

      let html = '';
      for (let r = v.r0; r < v.r0 + v.rows; r++) {
        let run = '';
        let runInk: Ink | '' = '';
        for (let c = v.c0; c < v.c0 + v.cols; c++) {
          let cell: Cell;
          if (c < 0 || r < 0 || c >= COLS || r >= ROWS) cell = { ch: (c + r + t) % 3 ? '~' : '-', ink: 'sea' };
          else {
            const i = r * COLS + c;
            cell = over.get(i) ?? base[i];
            if (cell === base[i]) {
              if (cell.ch === '"' && s.cutAt[i] >= 0) cell = { ch: ',', ink: 'cut' };
              else if (cell.ink === 'sea') cell = (c * 7 + r * 3 + t) % 5 === 0 ? { ch: '-', ink: 'sea2' } : cell;
            }
          }
          let ink = cell.ink;
          if (fogR < Infinity && Math.hypot(cellX(c) - st.pos.x, cellZ(r) - st.pos.z) > fogR && ink !== 'dui') ink = 'dim';
          if (ink !== runInk) {
            if (run) html += runInk ? `<span class="a-${runInk}">${run}</span>` : run;
            run = '';
            runInk = ink;
          }
          run += esc(cell.ch);
        }
        if (run) html += `<span class="a-${runInk}">${run}</span>`;
        html += '\n';
      }
      el.innerHTML = html;
    };

    draw(performance.now());
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, events, paused, fit]);

  /* Tap or click: pet Dui, walk to a place, or walk to the spot. */
  const onPointerDown = (e: ReactPointerEvent<HTMLPreElement>) => {
    if (store.frozen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const v = view.current;
    const c = v.c0 + Math.floor((e.clientX - rect.left) / v.cw);
    const r = v.r0 + Math.floor((e.clientY - rect.top) / v.ch);
    const x = cellX(c);
    const z = cellZ(r);
    if (Math.abs(c - toCol(store.pos.x)) <= 1 && Math.abs(r - toRow(store.pos.z)) <= 1) {
      sfx.purr();
      if (Math.random() < 0.35) sfx.meow();
      store.burst('hearts', store.pos.x, store.pos.z);
      events.current.onPet?.();
      return;
    }
    let best: InteractableId | null = null;
    let bestD = 2.2;
    for (const it of INTERACTABLES) {
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < bestD) {
        best = it.id;
        bestD = d;
      }
    }
    if (best) {
      props.current.onWalkTo(best);
      return;
    }
    store.target = new THREE.Vector3(x, 0, z);
    store.targetId = null;
  };

  return (
    <div className={`ascii-isla absolute inset-0 overflow-hidden clima-${weather}`} aria-hidden="true">
      <pre ref={pre} onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()} className="m-0 leading-[1.2] whitespace-pre cursor-pointer" style={{ touchAction: 'none' }} />
    </div>
  );
}
