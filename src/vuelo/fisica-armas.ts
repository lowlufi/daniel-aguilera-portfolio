/*
 * Física de armas y suelo del juego de aviones (vista lateral).
 *
 * Unidades: px de juego, segundos; y = ALTITUD (crece hacia arriba); ángulos
 * en rad CCW con 0 = +x. Ver `fisica-tipos.ts`.
 *
 * Todo integra con sub-pasos fijos de como mucho 1/240 s (Euler semi-implícito),
 * así que el resultado es casi idéntico con dt de 1/240 a 1/30 y nunca explota.
 */
import { ESCALA } from './fisica-vuelo';
import type { Avion, Bomba, Cuerpo, Explosion, Misil, Movil, Suelo, Vec, Vehiculo } from './fisica-tipos';

/**
 * Gravedad del juego, px/s²: la misma del modelo de vuelo (3,5 m por px y 1 s
 * de juego = 5 s reales ⇒ g ≈ 70 px/s²). Una bomba soltada a 120 px de altura
 * a 85 px/s cae en ~1,6 s y avanza ~175 px.
 */
export const GRAVEDAD = ESCALA.g;
const G = GRAVEDAD;

/** Paso máximo de integración interna. */
const H_MAX = 1 / 240;

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

const fin = (v: number, porDefecto = 0) => (Number.isFinite(v) ? v : porDefecto);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Diferencia angular envuelta a (-π, π]. */
const difAng = (a: number) => {
  a = fin(a) % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};
/** Número de sub-pasos para dt. */
const subpasos = (dt: number) => {
  dt = fin(dt);
  if (dt <= 0) return { n: 0, h: 0 };
  dt = Math.min(dt, 0.25); // un tirón de pestaña no debe teletransportar nada
  const n = Math.ceil(dt / H_MAX - 1e-9);
  return { n, h: dt / n };
};
/** Pendiente del suelo (dy/dx) por diferencia central. */
const pendiente = (suelo: Suelo, x: number) => fin((suelo(x + 1) - suelo(x - 1)) / 2);
const sueloSeguro = (suelo: Suelo, x: number) => fin(suelo(x));

/** Sanea un móvil: cualquier NaN/∞ se reemplaza para no envenenar al juego. */
function sanear(c: Movil & { t?: number }) {
  c.x = fin(c.x);
  c.y = fin(c.y);
  c.vx = fin(c.vx);
  c.vy = fin(c.vy);
  if (c.t !== undefined) c.t = fin(c.t);
}

// ---------------------------------------------------------------------------
// MISILES
// ---------------------------------------------------------------------------

export type OpcionesMisil = {
  /** Constante de navegación proporcional N (3–4 es lo clásico). */
  navegacion: number;
  /** Aceleración lateral máxima en g (múltiplos de GRAVEDAD) a plena velocidad. */
  cargaMax: number;
  /** Aceleración del motor, px/s². */
  empuje: number;
  /** Tiempo total de quemado, s. */
  quemado: number;
  /** Arrastre cuadrático k (a = k·v²). Por defecto empuje/vMax² para que vMax sea la velocidad terminal. */
  arrastre?: number;
  /** Velocidad terminal con motor, px/s (sólo informativo si se da `arrastre`). */
  vMax?: number;
  /** Semiángulo del cono del buscador, rad: si el blanco sale de él, se pierde el guiado. */
  cono?: number;
  /** Segundos de caída libre desde el soporte antes de encender (misil del jugador). */
  caida?: number;
  /** Vida total, s; después `pasoMisil` devuelve 'agotado'. */
  vida?: number;
};

/** Radio de la espoleta de proximidad sugerido, px (el motor decide el impacto). */
export const RADIO_ESPOLETA_MISIL = 6;

/**
 * Misil del jugador: aire-tierra contra blancos lentos. Rápido (260 px/s) y
 * muy ágil (18 g ⇒ radio de giro ≈ 23 px a plena velocidad), cono amplio.
 */
export const MISIL_JUGADOR: Required<OpcionesMisil> = {
  navegacion: 4,
  cargaMax: 18,
  empuje: 3 * G,
  quemado: 2.6,
  vMax: 260,
  arrastre: (3 * G) / (260 * 260),
  cono: (85 * Math.PI) / 180,
  caida: 0.15,
  vida: 5,
};

/**
 * Misil enemigo por nivel (1…). Velocidad terminal 110 px/s · 1,04^(n-1)
 * hasta 150 px/s; límite de carga 4 g subiendo 0,1 g/nivel hasta 5,5 g.
 * Radio mínimo de giro r = v²/a: nivel 1 ≈ 18 px (ω ≈ 5,8 rad/s); nivel 9 ≈
 * 23 px. Un avión a 100 px/s que tira 4 g gira con ω = 6,4 rad/s: si gira
 * cerrado en el último instante, el misil no puede seguir la línea de mira y
 * sale del cono del buscador ⇒ pierde el blanco. Si el piloto gira demasiado
 * pronto, la navegación proporcional corrige con tiempo y lo atrapa.
 */
export const MISIL_ENEMIGO = (nivel: number): Required<OpcionesMisil> => {
  const n = clamp(Math.floor(fin(nivel, 1)), 1, 50);
  const vMax = Math.min(150, 110 * Math.pow(1.04, n - 1));
  const empuje = 1.7 * G;
  return {
    navegacion: 3.5,
    cargaMax: Math.min(5.5, 4 + 0.1 * (n - 1)),
    empuje,
    quemado: 3.4,
    vMax,
    arrastre: empuje / (vMax * vMax),
    // ≥ ángulo de adelanto máximo asin(100/110) ≈ 65° de un blanco cruzando
    cono: (70 * Math.PI) / 180,
    caida: 0,
    vida: 5,
  };
};

/**
 * Crea el misil del jugador colgado del avión: hereda posición (un poco bajo
 * el fuselaje), velocidad y rumbo. Durante `MISIL_JUGADOR.caida` (0,15 s) cae
 * del soporte y luego enciende.
 */
export function misilJugador(desde: Avion, nivel = 1): Misil {
  const r = fin(desde.rumbo);
  // «abajo» del avión según su alabeo (+1 cabina arriba ⇒ panza hacia -normal).
  const al = fin(desde.alabeo, 1) >= 0 ? 1 : -1;
  const nx = -Math.sin(r) * al;
  const ny = Math.cos(r) * al;
  void nivel; // la agilidad del jugador no escala; el parámetro queda por simetría
  return {
    x: fin(desde.x) - nx * 3,
    y: fin(desde.y) - ny * 3,
    // pequeña eyección hacia la panza (pistón del soporte)
    vx: fin(desde.vx) - nx * 12,
    vy: fin(desde.vy) - ny * 12,
    rumbo: r,
    t: 0,
    combustible: MISIL_JUGADOR.quemado,
    guiado: true,
  };
}

/**
 * Misil enemigo lanzado desde (x, y) hacia `objetivo`. Sale de la rampa a
 * 40 px/s apuntando al punto de intercepción aproximado; `desvio` (rad) gira
 * la rampa (para que dos misiles de una batería SAM no salgan calcados).
 */
export function misilEnemigo(x: number, y: number, objetivo: Movil, nivel: number, desvio = 0): Misil {
  const o = MISIL_ENEMIGO(nivel);
  const sol = solucionTiro({ x, y }, o.vMax * 0.85, objetivo, false);
  let ang = sol ? Math.atan2(sol.vy, sol.vx) : Math.atan2(fin(objetivo.y) - y, fin(objetivo.x) - x);
  // las rampas no disparan por debajo de 15° sobre el horizonte
  ang = fin(ang, Math.PI / 2);
  const s = Math.sin(ang);
  if (s < Math.sin((15 * Math.PI) / 180)) ang = Math.cos(ang) >= 0 ? (15 * Math.PI) / 180 : Math.PI - (15 * Math.PI) / 180;
  ang += fin(desvio);
  const v0 = 40;
  return {
    x: fin(x),
    y: fin(y),
    vx: Math.cos(ang) * v0,
    vy: Math.sin(ang) * v0,
    rumbo: ang,
    t: 0,
    combustible: o.quemado,
    guiado: true,
  };
}

/**
 * Integra un misil. Fuerzas: empuje a lo largo del eje (mientras haya
 * combustible), arrastre cuadrático, gravedad y la sustentación lateral que
 * ordena la navegación proporcional verdadera:
 *     a⊥ = N · Vc · λ̇   (+ compensación de gravedad)
 * limitada a cargaMax·g y además a la sustentación disponible ∝ v² (a baja
 * velocidad las aletas no muerden). El cuerpo se alinea con la velocidad como
 * una veleta. Sin combustible: balístico y sin guiado.
 * Devuelve 'suelo' si toca el terreno, 'agotado' si superó su vida.
 */
export function pasoMisil(
  m: Misil,
  objetivo: Movil | null,
  dt: number,
  opts: OpcionesMisil,
  suelo: Suelo,
  /** Sin buscador: las aletas sostienen el vuelo recto mientras quema el motor (misil del jugador). */
  recto = false,
): 'vuela' | 'suelo' | 'agotado' {
  sanear(m);
  m.rumbo = fin(m.rumbo);
  m.combustible = fin(m.combustible);
  const N = fin(opts.navegacion, 3);
  const aMax = Math.max(0, fin(opts.cargaMax, 5)) * G;
  const T = Math.max(0, fin(opts.empuje));
  const vMax = fin(opts.vMax ?? 0) > 0 ? (opts.vMax as number) : 200;
  const k = opts.arrastre !== undefined && fin(opts.arrastre) > 0 ? opts.arrastre : T > 0 ? T / (vMax * vMax) : 0.002;
  const vRef = 0.55 * Math.sqrt(T > 0 ? T / k : vMax * vMax); // velocidad a la que las aletas dan la carga máxima
  const cosCono = Math.cos(fin(opts.cono ?? Math.PI, Math.PI));
  const caida = Math.max(0, fin(opts.caida ?? 0));
  const vida = fin(opts.vida ?? 5, 5);

  // el blanco se extrapola dentro del frame
  let tx = 0, ty = 0;
  const tvx = objetivo ? fin(objetivo.vx) : 0;
  const tvy = objetivo ? fin(objetivo.vy) : 0;
  if (objetivo) {
    tx = fin(objetivo.x);
    ty = fin(objetivo.y);
  }

  const { n, h } = subpasos(dt);
  for (let i = 0; i < n; i++) {
    const encendido = m.t >= caida && m.combustible > 0;
    let sp = Math.hypot(m.vx, m.vy);
    // dirección de la velocidad (o del morro si está casi quieto)
    let ux: number, uy: number;
    if (sp > 1) {
      ux = m.vx / sp;
      uy = m.vy / sp;
    } else {
      ux = Math.cos(m.rumbo);
      uy = Math.sin(m.rumbo);
    }
    const nx = -uy, ny = ux; // normal izquierda

    let ax = 0, ay = -G;
    // empuje a lo largo del morro
    if (encendido) {
      ax += T * Math.cos(m.rumbo);
      ay += T * Math.sin(m.rumbo);
      m.combustible = Math.max(0, m.combustible - h);
      if (m.combustible <= 0) m.guiado = false; // motor apagado: sin energía para maniobrar
      if (recto && !objetivo) {
        // Va donde apunta la nariz: anula g y las aletas alinean la velocidad con el morro.
        ay += G;
        const cr = Math.cos(m.rumbo), sr = Math.sin(m.rumbo);
        const lat = -m.vx * sr + m.vy * cr; // velocidad de costado respecto del morro
        ax += lat * 8 * sr;
        ay -= lat * 8 * cr;
      }
    }
    // arrastre
    ax -= k * sp * m.vx;
    ay -= k * sp * m.vy;

    // guiado
    if (encendido && m.guiado && objetivo) {
      const rx = tx - m.x, ry = ty - m.y;
      const r2 = rx * rx + ry * ry;
      const r = Math.sqrt(r2);
      if (r > 0.5) {
        // cono del buscador (respecto del eje del misil)
        const cosLook = (rx * Math.cos(m.rumbo) + ry * Math.sin(m.rumbo)) / r;
        if (cosLook < cosCono) {
          m.guiado = false;
        } else {
          const rvx = tvx - m.vx, rvy = tvy - m.vy;
          const lamDot = (rx * rvy - ry * rvx) / r2;
          const vc = -(rx * rvx + ry * rvy) / r;
          const aCmd = N * Math.max(vc, 0.3 * sp) * lamDot;
          const gComp = G * ux; // la sustentación anula la componente normal de g
          const aDisp = aMax * Math.min(1, (sp / vRef) * (sp / vRef));
          const an = clamp(aCmd + gComp, -aDisp, aDisp);
          ax += an * nx;
          ay += an * ny;
        }
      }
    }

    m.vx += ax * h;
    m.vy += ay * h;
    m.x += m.vx * h;
    m.y += m.vy * h;
    if (objetivo) {
      tx += tvx * h;
      ty += tvy * h;
    }
    // veleta: el morro sigue a la velocidad (rápido con motor, también sin él)
    sp = Math.hypot(m.vx, m.vy);
    if (sp > 5) {
      const rate = m.t < caida ? 4 : 25;
      m.rumbo += difAng(Math.atan2(m.vy, m.vx) - m.rumbo) * Math.min(1, rate * h);
    }
    m.t += h;

    if (m.y <= sueloSeguro(suelo, m.x)) {
      m.y = sueloSeguro(suelo, m.x);
      return 'suelo';
    }
  }
  m.rumbo = difAng(m.rumbo);
  if (m.t > vida) return 'agotado';
  return 'vuela';
}

/** Intensidad IR relativa bengala/avión (una bengala de magnesio es mucho más brillante). */
export const BRILLO_BENGALA = 5;

/**
 * Probabilidad de que el buscador IR prefiera la bengala al avión. Cada fuente
 * aporta irradiancia I/d² ponderada por la respuesta del buscador (gaussiana
 * dentro del cono, 0 fuera). Si sólo la bengala está en el cono ⇒ ~1; si la
 * bengala queda fuera ⇒ 0.
 */
export function probBengala(m: Misil, bengala: Vec, avion: Vec, cono = MISIL_ENEMIGO(1).cono): number {
  if (!m.guiado) return 0;
  const ex = Math.cos(fin(m.rumbo)), ey = Math.sin(fin(m.rumbo));
  const resp = (p: Vec, brillo: number) => {
    const dx = fin(p.x) - fin(m.x), dy = fin(p.y) - fin(m.y);
    const d = Math.max(4, Math.hypot(dx, dy));
    const c = clamp((dx * ex + dy * ey) / d, -1, 1);
    const ang = Math.acos(c);
    if (ang > cono) return 0;
    const sigma = cono * 0.5;
    return (brillo / (d * d)) * Math.exp(-(ang * ang) / (2 * sigma * sigma));
  };
  const b = resp(bengala, BRILLO_BENGALA);
  const a = resp(avion, 1);
  if (b + a <= 0) return 0;
  // el buscador tiene algo de rechazo cinemático: nunca más de 90 %
  return clamp(0.9 * (b / (a + b)), 0, 0.9);
}

/**
 * Tira el dado de `probBengala`. Llamar UNA vez por par (misil, bengala) al
 * soltarla, no cada frame. Si devuelve true, el motor debe redirigir el misil
 * hacia la bengala (o dejarlo `guiado=false`).
 */
export function bengalaEngana(m: Misil, bengala: Vec, avion: Vec, rnd: () => number = Math.random): boolean {
  return fin(rnd(), 1) < probBengala(m, bengala, avion);
}

// ---------------------------------------------------------------------------
// BOMBAS Y PROYECTILES
// ---------------------------------------------------------------------------

/**
 * Arrastre cuadrático de la bomba: velocidad terminal √(g/k) = 320 px/s. Se
 * nota (la bomba se queda un poco atrás del avión) sin romper la parábola.
 */
export const ARRASTRE_BOMBA = G / (320 * 320);
/** Separación entre bombas de una ráfaga, s (intervalómetro). */
export const INTERVALO_RAFAGA = 0.08;

/**
 * Suelta una bomba. Hereda la velocidad del avión más una eyección de 10 px/s
 * hacia la panza. `indice` > 0: bombas de una ráfaga, colocadas donde estaría
 * la bomba si hubiera salido del mismo soporte `indice·INTERVALO_RAFAGA`
 * segundos después (más atrás en la bodega y un poco más lenta).
 */
export function soltarBomba(desde: Avion, indice: number): Bomba {
  const r = fin(desde.rumbo);
  const i = Math.max(0, Math.floor(fin(indice)));
  const al = fin(desde.alabeo, 1) >= 0 ? 1 : -1;
  const nx = -Math.sin(r) * al, ny = Math.cos(r) * al; // «arriba» del avión
  const ex = Math.cos(r), ey = Math.sin(r);
  const atras = i * 4; // la bodega es larga: cada bomba sale 4 px más atrás
  return {
    x: fin(desde.x) - nx * 3 - ex * atras,
    y: fin(desde.y) - ny * 3 - ey * atras,
    vx: fin(desde.vx) - nx * 10 - ex * i * 3,
    vy: fin(desde.vy) - ny * 10 - ey * i * 3,
    rumbo: r,
    t: 0,
  };
}

function pasoBombaH(b: Bomba, h: number, viento: number) {
  const rvx = b.vx - viento, rvy = b.vy;
  const s = Math.hypot(rvx, rvy);
  b.vx += -ARRASTRE_BOMBA * s * rvx * h;
  b.vy += (-ARRASTRE_BOMBA * s * rvy - G) * h;
  b.x += b.vx * h;
  b.y += b.vy * h;
  // estabilidad de veleta: las aletas alinean el eje con el viento relativo,
  // con un cabeceo que crece con la presión dinámica.
  if (s > 5) {
    const rate = clamp(0.03 * s, 0.5, 8);
    b.rumbo += difAng(Math.atan2(rvy, rvx) - b.rumbo) * Math.min(1, rate * h);
  }
  b.t += h;
}

/** Integra una bomba. `viento` en px/s (positivo hacia +x). */
export function pasoBomba(b: Bomba, dt: number, viento: number): void {
  sanear(b);
  b.rumbo = fin(b.rumbo);
  const w = fin(viento);
  const { n, h } = subpasos(dt);
  for (let i = 0; i < n; i++) pasoBombaH(b, h, w);
  b.rumbo = difAng(b.rumbo);
}

/**
 * Dónde caería una bomba soltada ahora (misma integración que `pasoBomba`,
 * interpolando el cruce con el suelo). Si el avión está bajo el suelo, devuelve
 * su posición. Coste: ~240 sub-pasos por segundo de caída.
 */
export function puntoImpacto(desde: Avion, suelo: Suelo, viento = 0): Vec {
  const b = soltarBomba(desde, 0);
  const w = fin(viento);
  if (b.y <= sueloSeguro(suelo, b.x)) return { x: b.x, y: sueloSeguro(suelo, b.x) };
  for (let i = 0; i < 240 * 20; i++) {
    const px = b.x, py = b.y;
    const hp = py - sueloSeguro(suelo, px);
    pasoBombaH(b, H_MAX, w);
    const hn = b.y - sueloSeguro(suelo, b.x);
    if (hn <= 0) {
      const f = hp / Math.max(1e-9, hp - hn);
      const x = px + (b.x - px) * f;
      return { x, y: sueloSeguro(suelo, x) };
    }
  }
  return { x: b.x, y: sueloSeguro(suelo, b.x) };
}

/** Proyectil antiaéreo sugerido: velocidad de boca y arrastre. */
export const VEL_OBUS = 230;
export const ARRASTRE_OBUS = 0.0012;

function pasoBalH(c: Cuerpo, h: number, k: number, viento: number) {
  const rvx = c.vx - viento, rvy = c.vy;
  const s = Math.hypot(rvx, rvy);
  c.vx += -k * s * rvx * h;
  c.vy += (-k * s * rvy - G) * h;
  c.x += c.vx * h;
  c.y += c.vy * h;
  c.t += h;
}

/** Balística pura: gravedad + arrastre cuadrático relativo al viento. */
export function pasoBalistico(c: Cuerpo, dt: number, arrastre: number, viento: number): void {
  sanear(c);
  const k = Math.max(0, fin(arrastre));
  const w = fin(viento);
  const { n, h } = subpasos(dt);
  for (let i = 0; i < n; i++) pasoBalH(c, h, k, w);
}

/** Intercepción sin arrastre (con o sin gravedad). */
function interceptar(
  ox: number, oy: number, s: number, px: number, py: number, vx: number, vy: number, g: number,
): { vx: number; vy: number; tiempo: number } | null {
  const rx = px - ox, ry = py - oy;
  let t = -1;
  if (g === 0) {
    // |r + V t| = s t  ⇒  (V·V − s²) t² + 2 r·V t + r·r = 0
    const a = vx * vx + vy * vy - s * s;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) > 1e-9) t = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
        const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
        t = lo > 1e-4 ? lo : hi > 1e-4 ? hi : -1;
      }
    }
  } else {
    // f(t) = |r + V t + ½ g t² ŷ|² − s² t²: primera raíz positiva (barrido + bisección)
    const f = (t: number) => {
      const dx = rx + vx * t, dy = ry + vy * t + 0.5 * g * t * t;
      return dx * dx + dy * dy - s * s * t * t;
    };
    let a = 0, fa = f(0);
    const paso = 0.02;
    for (let tt = paso; tt <= 8; tt += paso) {
      const fb = f(tt);
      if (fa > 0 && fb <= 0) {
        let lo = a, hi = tt;
        for (let k = 0; k < 40; k++) {
          const mid = 0.5 * (lo + hi);
          if (f(mid) > 0) lo = mid;
          else hi = mid;
        }
        t = 0.5 * (lo + hi);
        break;
      }
      a = tt;
      fa = fb;
    }
  }
  if (!(t > 1e-4) || !Number.isFinite(t)) return null;
  const dx = rx + vx * t, dy = ry + vy * t + 0.5 * g * t * t;
  return { vx: dx / t, vy: dy / t, tiempo: t };
}

/**
 * Solución de tiro con adelanto contra un blanco a velocidad constante.
 * Sin gravedad: raíz de la cuadrática. Con gravedad: primera raíz de
 * |r + V t + ½ g t² ŷ| = s t. Si se pasa `arrastre` > 0 (el que usará
 * `pasoBalistico`), se corrige por disparo simulado (método de tiro, 5
 * iteraciones) y `tiempo` es el instante de máxima aproximación: úsalo como
 * tiempo de espoleta. Devuelve null si el blanco es inalcanzable.
 */
export function solucionTiro(
  origen: Vec,
  velProyectil: number,
  objetivo: Movil,
  conGravedad: boolean,
  arrastre = 0,
): { vx: number; vy: number; tiempo: number } | null {
  const ox = fin(origen.x), oy = fin(origen.y);
  const s = fin(velProyectil);
  if (s <= 0) return null;
  const px = fin(objetivo.x), py = fin(objetivo.y), vx = fin(objetivo.vx), vy = fin(objetivo.vy);
  const g = conGravedad ? G : 0;
  let sol = interceptar(ox, oy, s, px, py, vx, vy, g);
  const k = Math.max(0, fin(arrastre));
  if (!sol || k === 0) return sol;

  let offx = 0, offy = 0;
  let mejor = sol, mejorErr = Infinity;
  const h = 1 / 240;
  for (let it = 0; it < 6; it++) {
    // simula el disparo y busca la máxima aproximación
    const c: Cuerpo = { x: ox, y: oy, vx: sol.vx, vy: sol.vy, t: 0 };
    const tMax = sol.tiempo * 1.6 + 0.3;
    let bestD = Infinity, bestT = 0, ex = 0, ey = 0;
    for (let t = 0; t < tMax; t += h) {
      pasoBalH(c, h, k, 0);
      if (!conGravedad) c.vy += G * h; // sin gravedad: el usuario integrará sin ella
      const qx = px + vx * c.t, qy = py + vy * c.t;
      const d = Math.hypot(qx - c.x, qy - c.y);
      if (d < bestD) {
        bestD = d;
        bestT = c.t;
        ex = qx - c.x;
        ey = qy - c.y;
      }
    }
    if (bestD < mejorErr) {
      mejorErr = bestD;
      mejor = { vx: sol.vx, vy: sol.vy, tiempo: bestT };
    }
    if (bestD < 0.5) break;
    offx += ex;
    offy += ey;
    const nuevo = interceptar(ox, oy, s, px + offx, py + offy, vx, vy, g);
    if (!nuevo) break;
    sol = nuevo;
  }
  // con arrastre fuerte puede que no llegue: si la mejor pasada queda lejos, no hay tiro
  return mejorErr < 30 ? mejor : null;
}

// ---------------------------------------------------------------------------
// EXPLOSIONES Y ESCOMBROS
// ---------------------------------------------------------------------------

/**
 * Energías sugeridas (unidades de juego). radio = 6·E^(1/3):
 * obús 0,6 → 5 px · misil enemigo 2 → 7,6 px · misil jugador 4 → 9,5 px ·
 * bomba 10 → 13 px.
 */
export const ENERGIA = { obus: 0.6, misilEnemigo: 2, misilJugador: 4, bomba: 10, vehiculo: 3 } as const;

/**
 * Escalado de Hopkinson-Cranz: dos cargas producen los mismos efectos a la
 * misma distancia escalada Z = d / E^(1/3).
 *  - bola de fuego: Z = 6
 *  - daño (sobrepresión, ∝ Z⁻² en campo medio): 1 hasta Z = 4, 0 en Z = 16
 *  - impulso específico ∝ E^(1/3)/Z (Δv para masa unidad), 0 en Z = 28
 */
export function explosion(energia: number): Explosion {
  const E = Math.max(1e-3, fin(energia, 1));
  const W = Math.cbrt(E);
  const Zd = 4, ZdMax = 16, Zi = 6, ZiMax = 28, I0 = 90;
  const cutD = (Zd / ZdMax) ** 2;
  return {
    radio: 6 * W,
    dano: (d: number) => {
      const Z = Math.max(0, fin(d, Infinity)) / W;
      if (Z <= Zd) return 1;
      if (Z >= ZdMax) return 0;
      return clamp(((Zd / Z) ** 2 - cutD) / (1 - cutD), 0, 1);
    },
    impulso: (d: number) => {
      const Z = Math.max(0, fin(d, Infinity)) / W;
      if (Z >= ZiMax) return 0;
      const base = Zi / Math.max(Z, Zi);
      const corte = 1 - Z / ZiMax; // se apaga suavemente
      return I0 * W * base * corte;
    },
  };
}

/**
 * Esquirlas/terrones: velocidad tipo Gurney (casi independiente del tamaño,
 * crece apenas con E), abanico hacia arriba (±80° de la vertical), con sesgo
 * al azar para que no salgan simétricas.
 */
export function esquirlas(x: number, y: number, energia: number, n: number, rnd: () => number): Cuerpo[] {
  const E = Math.max(0.05, fin(energia, 1));
  const cnt = clamp(Math.floor(fin(n)), 0, 400);
  const r = () => clamp(fin(rnd(), 0.5), 0, 1);
  const out: Cuerpo[] = [];
  const vBase = 85 * Math.pow(E, 0.15);
  for (let i = 0; i < cnt; i++) {
    const a = Math.PI / 2 + (r() * 2 - 1) * ((80 * Math.PI) / 180);
    const v = vBase * (0.45 + 0.9 * r());
    out.push({ x: fin(x), y: fin(y) + 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0 });
  }
  return out;
}

const RESTITUCION = 0.4;
const FRICCION = 0.65; // fracción de velocidad tangencial que se conserva en cada bote
const ARRASTRE_ESQ = 0.004;

/** Esquirla: gravedad, algo de arrastre y botes en el suelo inclinado hasta quedar quieta. */
export function pasoEsquirla(e: Cuerpo, dt: number, suelo: Suelo): void {
  sanear(e);
  const { n, h } = subpasos(dt);
  for (let i = 0; i < n; i++) {
    const gy = sueloSeguro(suelo, e.x);
    const parada = e.vx === 0 && e.vy === 0 && e.y <= gy + 0.01;
    e.t += h;
    if (parada) {
      e.y = gy;
      continue;
    }
    const s = Math.hypot(e.vx, e.vy);
    e.vx += -ARRASTRE_ESQ * s * e.vx * h;
    e.vy += (-ARRASTRE_ESQ * s * e.vy - G) * h;
    e.x += e.vx * h;
    e.y += e.vy * h;
    const g2 = sueloSeguro(suelo, e.x);
    if (e.y <= g2) {
      e.y = g2;
      // normal del terreno
      const p = pendiente(suelo, e.x);
      const ln = Math.hypot(1, p);
      const nx = -p / ln, ny = 1 / ln;
      const vn = e.vx * nx + e.vy * ny;
      if (vn < 0) {
        const tx = e.vx - vn * nx, ty = e.vy - vn * ny;
        e.vx = tx * FRICCION - vn * RESTITUCION * nx;
        e.vy = ty * FRICCION - vn * RESTITUCION * ny;
        if (Math.hypot(e.vx, e.vy) < 10) {
          e.vx = 0;
          e.vy = 0;
        }
      }
    }
  }
}

/**
 * Bocanada de humo: flotabilidad que se apaga al mezclarse (sube y se frena),
 * arrastre lineal hacia la velocidad del viento y radio que crece por
 * entrainment (∝ velocidad relativa) + difusión turbulenta.
 */
export function pasoHumo(h: Cuerpo & { r: number }, dt: number, viento: number): void {
  sanear(h);
  h.r = Math.max(0.5, fin(h.r, 2));
  const w = fin(viento);
  const { n, h: dh } = subpasos(dt);
  for (let i = 0; i < n; i++) {
    const flot = 70 * Math.exp(-h.t / 1.2); // px/s² hacia arriba
    const c = 2.2; // 1/s, acoplamiento con el aire
    h.vx += (w - h.vx) * Math.min(1, c * dh);
    h.vy += flot * dh - h.vy * Math.min(1, c * dh);
    h.x += h.vx * dh;
    h.y += h.vy * dh;
    const rel = Math.hypot(h.vx - w, h.vy);
    h.r = Math.min(60, h.r + (0.12 * rel + 3 / (1 + h.t)) * dh);
    h.t += dh;
  }
}

// ---------------------------------------------------------------------------
// VEHÍCULOS
// ---------------------------------------------------------------------------

/** Estado interno que no está en el tipo compartido (cabeceo, en el aire). */
type Interno = { cab: number; vCab: number; aire: boolean; angSuelo: number };
const internos = new WeakMap<Vehiculo, Interno>();
const interno = (v: Vehiculo): Interno => {
  let s = internos.get(v);
  if (!s) {
    s = { cab: 0, vCab: 0, aire: false, angSuelo: fin(v.angulo) };
    internos.set(v, s);
  }
  return s;
};

/** Suspensión: 1,8 Hz, ζ = 0,22 (sub-amortiguada: 2–3 rebotes visibles). */
const W_SUSP = 2 * Math.PI * 1.8;
const Z_SUSP = 0.22;
/** Cabeceo del casco: 2,2 Hz, ζ = 0,3. */
const W_CAB = 2 * Math.PI * 2.2;
const Z_CAB = 0.3;
const TOPE_COMPRESION = -5, TOPE_EXTENSION = 3;

/** Baches de pequeña escala (rugosidad del camino), px. Deterministas por x. */
const bache = (x: number) => 0.4 * Math.sin(0.45 * x) + 0.2 * Math.sin(1.13 * x + 1.3);

/** Altura y ángulo del suelo bajo los dos ejes. */
function apoyo(suelo: Suelo, x: number, largo: number) {
  const L = Math.max(2, fin(largo, 12));
  const xb = x - L / 2, xf = x + L / 2;
  const hb = sueloSeguro(suelo, xb) + bache(xb);
  const hf = sueloSeguro(suelo, xf) + bache(xf);
  return { y: 0.5 * (hb + hf), ang: Math.atan2(hf - hb, L) };
}

export function nuevoVehiculo(x: number, suelo: Suelo, masa: number): Vehiculo {
  const a = apoyo(suelo, fin(x), 12);
  const v: Vehiculo = {
    x: fin(x),
    y: a.y,
    vx: 0,
    vy: 0,
    angulo: a.ang,
    suspension: 0,
    vSuspension: 0,
    masa: Math.max(0.1, fin(masa, 1)),
  };
  internos.set(v, { cab: 0, vCab: 0, aire: false, angSuelo: a.ang });
  return v;
}

/** ¿Está el vehículo en el aire (tras una explosión)? */
export function enElAire(v: Vehiculo): boolean {
  return interno(v).aire;
}

/**
 * Integra un vehículo. `velDeseada` en px/s (negativo = hacia la izquierda),
 * `largo` = distancia entre ejes, px.
 *  - Tracción limitada a 0,55 g; el conductor compensa sólo el 60 % de la
 *    pendiente ⇒ al subir pierde ~0,4·g·senθ/kp de velocidad, al bajar gana.
 *  - Suspensión resorte-amortiguador excitada por la aceleración vertical de
 *    las ruedas (baches, crestas) y por aterrizajes.
 *  - Si una cresta exige más de 1 g hacia abajo, despega (física real).
 *  - `y` = altura del punto de apoyo; dibujar el casco en y + suspension,
 *    rotado `angulo`.
 */
export function pasoVehiculo(v: Vehiculo, velDeseada: number, dt: number, suelo: Suelo, largo: number): void {
  sanear(v);
  v.suspension = fin(v.suspension);
  v.vSuspension = fin(v.vSuspension);
  v.masa = Math.max(0.1, fin(v.masa, 1));
  const s = interno(v);
  s.cab = fin(s.cab);
  s.vCab = fin(s.vCab);
  const vd = fin(velDeseada);
  const kp = 3, aMax = 0.55 * G, ff = 0.6, rodadura = 6;
  const { n, h } = subpasos(dt);
  for (let i = 0; i < n; i++) {
    let aBase = 0;
    if (s.aire) {
      v.vy -= G * h;
      v.x += v.vx * h;
      v.y += v.vy * h;
      aBase = -G;
      const a = apoyo(suelo, v.x, largo);
      if (v.y <= a.y) {
        // aterrizaje: la velocidad vertical relativa se la come la suspensión
        const vSuelo = Math.tan(a.ang) * v.vx;
        const vRel = v.vy - vSuelo;
        v.vSuspension += clamp(vRel, -120, 0) * 0.8;
        s.vCab += difAng(a.ang - s.angSuelo) * 6; // golpe de cabeceo al tocar con un eje antes
        v.y = a.y;
        v.vy = vSuelo;
        s.aire = false;
        s.angSuelo = a.ang;
        aBase = 0;
      }
    } else {
      const a0 = apoyo(suelo, v.x, largo);
      const sn = Math.sin(a0.ang), cs = Math.cos(a0.ang);
      const err = vd - v.vx;
      const drive = clamp(kp * err + ff * G * sn, -aMax, aMax);
      const roll = Math.abs(v.vx) > 0.5 ? -Math.sign(v.vx) * rodadura : 0;
      v.vx += (drive - G * sn + roll) * cs * h;
      v.x += v.vx * h;
      const a1 = apoyo(suelo, v.x, largo);
      // cinemática vertical del apoyo: y' = p·vx, y'' ≈ vx²·y'' (curvatura) + p·ax
      const am = apoyo(suelo, v.x - 0.5, largo), ap = apoyo(suelo, v.x + 0.5, largo);
      const p = ap.y - am.y;
      aBase = v.vx * v.vx * ((ap.y - 2 * a1.y + am.y) / 0.25);
      // despegue sólo por la forma suave del terreno (los baches los absorben los neumáticos)
      const curvSuave = (sueloSeguro(suelo, v.x + 2) - 2 * sueloSeguro(suelo, v.x) + sueloSeguro(suelo, v.x - 2)) / 4;
      const vyN = fin(p * v.vx);
      if (v.vx * v.vx * curvSuave < -G * 1.05) {
        // la cresta «se escapa»: despega con la velocidad que llevaba
        s.aire = true;
        v.vy = vyN;
        v.y = a1.y;
      } else {
        v.vy = vyN;
        v.y = a1.y;
        s.angSuelo = a1.ang;
      }
    }
    // suspensión: s'' = −ω² s − 2ζω s' − a_base (en el aire, sin contacto: el casco cuelga extendido)
    const aB = s.aire ? 0 : clamp(fin(aBase), -2 * G, 2 * G);
    const objetivoS = s.aire ? TOPE_EXTENSION * 0.6 : 0;
    v.vSuspension += (-W_SUSP * W_SUSP * (v.suspension - objetivoS) - 2 * Z_SUSP * W_SUSP * v.vSuspension - aB) * h;
    v.suspension += v.vSuspension * h;
    if (v.suspension < TOPE_COMPRESION) {
      v.suspension = TOPE_COMPRESION;
      if (v.vSuspension < 0) v.vSuspension *= -0.3;
    } else if (v.suspension > TOPE_EXTENSION) {
      v.suspension = TOPE_EXTENSION;
      if (v.vSuspension > 0) v.vSuspension *= -0.3;
    }
    // cabeceo
    s.vCab += (-W_CAB * W_CAB * s.cab - 2 * Z_CAB * W_CAB * s.vCab) * h;
    s.cab = clamp(s.cab + s.vCab * h, -0.6, 0.6);
  }
  v.angulo = difAng(s.angSuelo + s.cab);
}

/**
 * Retroceso al disparar en dirección `angulo` con `impulso` (px/s·masa): el
 * vehículo se desplaza hacia atrás, el casco se hunde (si dispara hacia
 * arriba) y cabecea.
 */
export function retroceso(v: Vehiculo, angulo: number, impulso: number): void {
  const m = Math.max(0.1, fin(v.masa, 1));
  const dv = Math.max(0, fin(impulso)) / m;
  const a = fin(angulo);
  const c = Math.cos(a), sn = Math.sin(a);
  const s = interno(v);
  v.vx = fin(v.vx) - c * dv * 0.5; // las ruedas/orugas absorben parte
  v.vSuspension = fin(v.vSuspension) - Math.max(0, sn) * dv * 1.5 - 2;
  // disparar hacia la izquierda levanta el morro izquierdo… del lado contrario
  s.vCab += c * dv * 0.08 + (rndSigno(v) * dv * 0.01);
}
const rndSigno = (v: Vehiculo) => (Math.floor(fin(v.x) * 7.13) % 2 === 0 ? 1 : -1);

/**
 * Empuje de una explosión: (ix, iy) es el impulso para masa unidad
 * (`explosion(E).impulso(d)` × dirección) ⇒ Δv = i / masa. Si el empuje
 * vertical supera 20 px/s el vehículo salta; si no, lo absorbe la suspensión.
 */
export function empujeVehiculo(v: Vehiculo, ix: number, iy: number): void {
  const m = Math.max(0.1, fin(v.masa, 1));
  const dvx = clamp(fin(ix) / m, -400, 400);
  const dvy = clamp(fin(iy) / m, -400, 400);
  const s = interno(v);
  v.vx = fin(v.vx) + dvx;
  if (s.aire) {
    v.vy = fin(v.vy) + dvy;
  } else if (dvy > 20) {
    s.aire = true;
    v.vy = fin(v.vy) + dvy - 20 * 0.5;
    v.vSuspension = fin(v.vSuspension) + 15;
  } else {
    v.vSuspension = fin(v.vSuspension) + dvy * 1.2 - Math.abs(dvx) * 0.3;
  }
  s.vCab += -dvx * 0.06 + dvy * 0.02 * rndSigno(v);
}
