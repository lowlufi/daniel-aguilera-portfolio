/*
 * Cuerpos de los misiles enemigos en pixel art: cada tipo con su silueta,
 * franjas, bandas y llama de colores (ver `LookFuego` en misiles.ts).
 *
 * Coordenadas de pantalla; el morro apunta a +x tras rotar por −rumbo (en
 * pasos de 0,1 rad para que los píxeles no tiemblen). Los tonos derivados
 * (tinta, luces) se calculan una vez por tipo; nada se crea por cuadro.
 */
import { tone } from '../game/dulce';
import { MISILES, type MisilEnemigo, type TipoMisil } from './misiles';

type Ctx = CanvasRenderingContext2D;

function R(g: Ctx, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

/** Disco píxel a píxel (como `disc` de dulce.ts), centrado en (cx, cy). */
function disco(g: Ctx, cx: number, cy: number, r: number, c: string) {
  g.fillStyle = c;
  if (r <= 0) {
    g.fillRect(cx, cy, 1, 1);
    return;
  }
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.min(r, Math.round(Math.sqrt(r * r - dy * dy + r * 0.6)));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

type Tintas = { tinta: string; luz: string; paleta: readonly string[]; tintasPaleta: string[] };
const tintas: Partial<Record<TipoMisil, Tintas>> = {};
function tintasDe(tipo: TipoMisil): Tintas {
  let t = tintas[tipo];
  if (!t) {
    const F = MISILES[tipo];
    t = {
      tinta: tone(F.color.punta, -0.5),
      luz: tone(F.color.cuerpo, 0.5),
      paleta: F.fuego.paleta,
      tintasPaleta: F.fuego.paleta.map((c) => tone(c, -0.5)),
    };
    tintas[tipo] = t;
  }
  return t;
}

const BLANCO = '#ffffff';

/** Llama de colores detrás de la tobera (xb: borde trasero del cuerpo). */
function llama(g: Ctx, xb: number, pal: readonly string[], tic: number, grueso: number) {
  const n = pal.length;
  const fl = 2 + (tic % 2) + (grueso > 4 ? 2 : 0);
  const gy = grueso > 4 ? -1 : -1;
  R(g, xb - fl, gy, fl, grueso > 4 ? 3 : 2, pal[tic % n]);
  R(g, xb - fl - 1 - (tic % 3 === 0 ? 1 : 0), 0, 1 + (tic % 3 === 0 ? 1 : 0), 1, pal[(tic + 1) % n]);
  R(g, xb - 2, -1, 2, grueso > 4 ? 3 : 2, '#fff6c8');
  R(g, xb - 1, 0, 1, 1, BLANCO);
}

/**
 * Dibuja un misil enemigo centrado en (x, y) de pantalla. `t`: reloj del juego
 * (parpadeos, aleteo, giro de la rueda).
 */
export function dibujarMisilEnemigo(g: Ctx, m: MisilEnemigo, x: number, y: number, t: number): void {
  const F = MISILES[m.tipo];
  const L = F.fuego;
  const T = tintasDe(m.tipo);
  const pal = T.paleta;
  const n = pal.length;
  const tic = Math.floor(t * 30);
  const motor = m.combustible > 0;
  const aviso = m.aviso > 0 && Math.floor(t * (8 + m.aviso * 16)) % 2 === 0;
  const X = Math.round(x), Y = Math.round(y);
  const tinte = ((m.tinte % n) + n) % n;

  // Formas que no rotan (redondas o que giran por su cuenta).
  switch (L.forma) {
    case 'bola': {
      // bola de color con núcleo blanco y destello en cruz que titila
      const c = pal[tinte];
      disco(g, X, Y, 3, T.tintasPaleta[tinte]);
      disco(g, X, Y, 2, c);
      R(g, X - 1, Y - 1, 2, 2, BLANCO);
      if (tic % 4 < 2) {
        R(g, X - 5, Y, 2, 1, c);
        R(g, X + 4, Y, 2, 1, c);
        R(g, X, Y - 5, 1, 2, c);
        R(g, X, Y + 4, 1, 2, c);
      }
      return;
    }
    case 'estrella': {
      const c = pal[tinte];
      if (m.cuenta) {
        // corazón guiado: estrella grande blanca que titila con aro de color
        const k = tic % 4 < 2 ? 3 : 2;
        R(g, X - k, Y, k * 2 + 1, 1, c);
        R(g, X, Y - k, 1, k * 2 + 1, c);
        R(g, X - 1, Y - 1, 3, 3, BLANCO);
        if (tic % 4 >= 2) {
          R(g, X - 2, Y - 2, 1, 1, c);
          R(g, X + 2, Y - 2, 1, 1, c);
          R(g, X - 2, Y + 2, 1, 1, c);
          R(g, X + 2, Y + 2, 1, 1, c);
        }
      } else {
        R(g, X - 1, Y, 3, 1, c);
        R(g, X, Y - 1, 1, 3, c);
        R(g, X, Y, 1, 1, tic % 3 ? BLANCO : c);
      }
      return;
    }
    case 'chispa': {
      R(g, X, Y, 2, 2, tic % 2 ? BLANCO : pal[tinte]);
      return;
    }
    case 'brasa': {
      const c = pal[(tinte + (tic >> 1)) % n];
      R(g, X, Y, 2, 2, c);
      if (tic % 3 === 0) R(g, X, Y, 1, 1, BLANCO);
      return;
    }
    case 'rueda': {
      // girándola: aro de colores que gira, cuatro rayos y cohetitos en la punta
      const r = 5;
      disco(g, X, Y, r + 1, T.tinta);
      disco(g, X, Y, r, F.color.cuerpo);
      disco(g, X, Y, r - 2, T.tinta);
      for (let k = 0; k < 8; k++) {
        const a = m.fase + (k * Math.PI) / 4;
        R(g, Math.round(X + Math.cos(a) * r), Math.round(Y - Math.sin(a) * r), 2, 2, pal[(k + (tic >> 3)) % n]);
      }
      for (let k = 0; k < 4; k++) {
        const a = m.fase + (k * Math.PI) / 2;
        const c = Math.cos(a), s = -Math.sin(a);
        for (let j = 1; j < r - 1; j++) R(g, Math.round(X + c * j), Math.round(Y + s * j), 1, 1, F.color.aletas);
      }
      R(g, X - 1, Y - 1, 2, 2, BLANCO);
      if (motor) {
        // chorros en los dos brazos (el fuego que la hace girar)
        for (let k = 0; k < 2; k++) {
          const a = m.fase + k * Math.PI;
          const ex = Math.round(X + Math.cos(a) * (r + 2)), ey = Math.round(Y - Math.sin(a) * (r + 2));
          R(g, ex - 1, ey - 1, 3, 3, pal[(tic + k) % n]);
          R(g, ex, ey, 1, 1, BLANCO);
        }
      }
      if (aviso || m.hp < F.hp) R(g, X - 1, Y - 1, 2, 2, F.color.punta);
      return;
    }
  }

  g.save();
  g.translate(X, Y);
  g.rotate(Math.round(-m.rumbo / 0.1) * 0.1);
  switch (L.forma) {
    case 'cohete':
      cohete(g, m, T, tic, motor, aviso, t);
      break;
    case 'tubo':
      tubo(g, m, T, tic, motor, aviso);
      break;
    case 'petardo':
      petardo(g, m, T, tic, motor, aviso);
      break;
    case 'bulbo':
      bulbo(g, m, T, tic, motor, aviso);
      break;
    case 'cabeza': {
      // cometa: cabeza blanca con halo y una cola de luz hacia atrás
      const halo = pal[0];
      R(g, -9, -1, 6, 2, pal[2]);
      R(g, -12 - (tic % 3), 0, 4, 1, pal[(tic >> 1) % n]);
      R(g, -6, -1, 3, 2, halo);
      disco(g, 0, 0, 3, halo);
      disco(g, 0, 0, 2, BLANCO);
      if (tic % 4 < 2) {
        R(g, 0, -5, 1, 2, BLANCO);
        R(g, 0, 4, 1, 2, BLANCO);
        R(g, 4, 0, 2, 1, BLANCO);
      }
      break;
    }
    case 'segmentos': {
      // serpiente: cuerpo de anillos arcoíris que ondula, cabeza con ojito
      const fase = t * 12;
      for (let k = 5; k >= 1; k--) {
        const off = Math.round(Math.sin(fase - k * 1.1) * 1.4);
        const c = pal[(k + (tic >> 2)) % n];
        R(g, -k * 2 - 1, -2 + off, 3, 4, T.tintasPaleta[(k + (tic >> 2)) % n]);
        R(g, -k * 2, -1 + off, 2, 2, c);
      }
      R(g, -1, -2, 5, 4, T.tinta);
      R(g, 0, -1, 3, 2, F.color.punta);
      R(g, 4, 0, 1, 1, F.color.punta);
      R(g, 2, -2, 1, 1, BLANCO);
      if (motor) llama(g, -11, pal, tic, 3);
      break;
    }
    case 'astro': {
      // estrella fugaz: astro de cuatro puntas que alterna cruz y aspa
      const flash = m.reloj > 0 && m.cuenta === 1;
      const k = flash ? 5 + (tic % 2) : 3;
      const c = flash || aviso ? BLANCO : F.color.cuerpo;
      if (tic % 6 < 3 || flash) {
        R(g, -k, 0, k * 2 + 1, 1, c);
        R(g, 0, -k, 1, k * 2 + 1, c);
        R(g, -1, -1, 3, 3, pal[2]);
      } else {
        for (let j = 1; j <= 2; j++) {
          R(g, -j, -j, 1, 1, c);
          R(g, j, -j, 1, 1, c);
          R(g, -j, j, 1, 1, c);
          R(g, j, j, 1, 1, c);
        }
        R(g, -1, -1, 3, 3, pal[2]);
      }
      R(g, 0, 0, 1, 1, BLANCO);
      if (motor) {
        R(g, -6, 0, 3, 1, pal[(tic >> 1) % n]);
        R(g, -9 - (tic % 2), 0, 2, 1, pal[3]);
      }
      break;
    }
    case 'mariposa': {
      // cuerpito y dos alas que aletean (rosada o turquesa según la pareja)
      const ala = m.tinte ? pal[1] : pal[0];
      const borde = m.tinte ? pal[0] : pal[1];
      const h = 1 + Math.round(Math.abs(Math.sin(t * 16 + m.fase)) * 3);
      R(g, -3, -h - 1, 4, h, T.tinta);
      R(g, -2, -h, 3, h - 1 || 1, aviso ? BLANCO : ala);
      R(g, -3, 1, 4, h, T.tinta);
      R(g, -2, 1, 3, h - 1 || 1, aviso ? BLANCO : ala);
      R(g, -2, -h - 1, 1, 1, borde);
      R(g, -2, h, 1, 1, borde);
      R(g, -4, -1, 8, 2, T.tinta);
      R(g, -3, 0, 6, 1, F.color.cuerpo);
      R(g, 3, -1, 2, 1, borde);
      if (motor) llama(g, -4, pal, tic, 2);
      break;
    }
    case 'abeja': {
      // abejita: rayas negras y amarillas, aguijón y alitas que vibran
      R(g, -3, -2, 6, 4, '#2b2118');
      R(g, -2, -1, 4, 2, aviso ? BLANCO : F.color.cuerpo);
      R(g, -1, -1, 1, 2, '#2b2118');
      R(g, 1, -1, 1, 2, '#2b2118');
      R(g, -4, 0, 1, 1, '#2b2118');
      R(g, 3, -1, 1, 1, BLANCO);
      const up = tic % 2;
      R(g, -1, -4 + up, 2, 2, '#e8f6ff');
      R(g, 0, -4 + up, 1, 1, BLANCO);
      break;
    }
    case 'hoja': {
      // enredadera: tallo verde, aletas de hoja y una flor en la punta
      const len = 9, x0 = -4;
      R(g, x0, -2, len, 4, T.tinta);
      R(g, x0 + 1, -1, len - 2, 2, aviso ? BLANCO : F.color.cuerpo);
      R(g, x0 + 2, -1, len - 4, 1, pal[1]);
      // hojas
      R(g, x0 - 1, -4, 3, 2, pal[3]);
      R(g, x0, -3, 2, 1, pal[0]);
      R(g, x0 - 1, 2, 3, 2, pal[3]);
      R(g, x0, 2, 2, 1, pal[0]);
      R(g, x0 + 4, -3, 2, 1, pal[0]);
      // flor
      const fx = x0 + len + 1;
      R(g, fx - 1, -2, 3, 1, pal[2]);
      R(g, fx - 1, 1, 3, 1, pal[2]);
      R(g, fx - 2, -1, 1, 2, pal[2]);
      R(g, fx + 1, -1, 1, 2, pal[2]);
      R(g, fx - 1, -1, 2, 2, aviso ? BLANCO : '#ffe95c');
      if (motor) llama(g, x0 - 1, pal, tic, 3);
      break;
    }
    case 'brote': {
      // zarcillo: punta verde con un brote rosado y una hojita que alterna de lado
      R(g, -3, -1, 5, 2, T.tinta);
      R(g, -2, 0, 4, 1, F.color.cuerpo);
      R(g, 2, -1, 2, 2, F.color.punta);
      const lado = tic % 8 < 4 ? -2 : 1;
      R(g, -2, lado, 2, 1, pal[0]);
      if (motor) llama(g, -3, pal, tic, 2);
      break;
    }
  }
  g.restore();
}

/** Cohete clásico con detalles por tipo (bandas, franjas, cápsulas, remaches). */
function cohete(g: Ctx, m: MisilEnemigo, T: Tintas, tic: number, motor: boolean, aviso: boolean, t: number) {
  const F = MISILES[m.tipo];
  const pal = T.paleta;
  const n = pal.length;
  const base = F.largo;
  const len = Math.max(5, Math.round(base * 0.85));
  const thick = base >= 12 ? 5 : base <= 7 ? 3 : 4;
  let body = F.color.cuerpo, tip = F.color.punta, ink = T.tinta;
  if (m.tipo === 'arcoiris') {
    body = pal[m.tinte % n];
    tip = pal[(m.tinte + 1) % n];
    ink = T.tintasPaleta[m.tinte % n];
  }
  if (aviso) body = BLANCO;
  const fins = F.color.aletas;
  const banda = F.fuego.banda;
  const x0 = -Math.floor(len / 2);
  const h = Math.floor(thick / 2);
  R(g, x0, -h, len, thick, ink);
  R(g, x0 + 1, -h + 1, len - 2, thick - 2, body);
  const inner = thick - 2;
  switch (m.tipo) {
    case 'buscador':
      R(g, x0 + 3, -h + 1, 1, inner, banda);
      R(g, x0 + len - 4, -h + 1, 1, inner, banda);
      break;
    case 'dardo':
      R(g, x0 + 2, 0, len - 4, 1, banda);
      break;
    case 'zigzag': {
      // franjas de bastón de caramelo que corren hacia atrás
      const sc = Math.floor(t * 10) % 3;
      for (let k = x0 + 2 + sc; k < x0 + len - 2; k += 3) R(g, k, -h + 1, 1, inner, banda);
      break;
    }
    case 'pesado':
      R(g, x0 + 3, -h + 1, 1, inner, banda);
      R(g, x0 + len - 5, -h + 1, 1, inner, banda);
      for (let k = x0 + 5; k < x0 + len - 5; k += 2) R(g, k, h - 1, 1, 1, T.luz);
      if (m.hp < F.hp && tic % 4 < 2) R(g, x0 + 5, -1, 2, 2, '#ff6a2a');
      break;
    case 'racimo':
      // tres cápsulas que se encienden al acercarse la apertura
      for (let k = 0; k < 3; k++) R(g, x0 + 2 + k * 2, -h + 1, 1, inner, m.aviso > k / 3 && tic % 4 < 2 ? pal[k % n] : banda);
      break;
    case 'estratosferico':
      R(g, x0 + Math.floor(len / 2), -h + 1, 1, inner, banda);
      R(g, x0 + 2, -h + 1, 1, inner, pal[3]);
      break;
    case 'arcoiris':
      // franjitas con los próximos colores
      R(g, x0 + 2, -h + 1, 1, inner, pal[(m.tinte + 2) % n]);
      R(g, x0 + 3, -h + 1, 1, inner, pal[(m.tinte + 3) % n]);
      R(g, x0 + 4, -h + 1, 1, inner, pal[(m.tinte + 4) % n]);
      break;
    default:
      R(g, x0 + 2, -h + 1, 1, inner, banda);
  }
  R(g, x0 + len - 2, -h + 1, 2, inner, tip);
  R(g, x0 + len - 1, -h + 1 + (thick > 4 ? 1 : 0), 1, Math.max(1, inner - (thick > 4 ? 2 : 0)), tip);
  R(g, x0 + len, 0, 1, 1, ink);
  R(g, x0, -h - 1, 2, thick + 2, ink);
  R(g, x0 + 1, -h, 1, thick, fins);
  if (thick >= 4) R(g, x0 + 2, -h + 1, len - 5, 1, aviso ? BLANCO : T.luz);
  if (motor) llama(g, x0, pal, tic, thick);
}

/** Tubo de cartón con franja en espiral (candela romana, palmera). */
function tubo(g: Ctx, m: MisilEnemigo, T: Tintas, tic: number, motor: boolean, aviso: boolean) {
  const F = MISILES[m.tipo];
  const pal = T.paleta;
  const n = pal.length;
  const len = 9, thick = 5, x0 = -5, h = 2;
  R(g, x0, -h, len, thick, T.tinta);
  R(g, x0 + 1, -h + 1, len - 2, thick - 2, aviso && m.tipo !== 'candela' ? BLANCO : F.color.cuerpo);
  // espiral: franjas en diagonal
  const sc = (tic >> 2) % 4;
  for (let r = 0; r < thick - 2; r++)
    for (let k = (r + sc) % 4; k < len - 2; k += 4) R(g, x0 + 1 + k, -h + 1 + r, 1, 1, F.fuego.banda);
  if (m.tipo === 'candela') {
    // boca: brilla del color de la próxima bola (más fuerte justo antes del tiro)
    const c = pal[((m.tinte % n) + n) % n];
    const k = m.aviso > 0.6 ? 2 : 1;
    R(g, x0 + len - 1, -h - k + 1, 2, thick + 2 * k - 2, c);
    if (m.aviso > 0.6) R(g, x0 + len, -1, 2, 3, BLANCO);
  } else {
    // palmera: tapa dorada en punta
    R(g, x0 + len, -1, 1, 3, F.color.punta);
    R(g, x0 + len + 1, 0, 1, 1, aviso ? BLANCO : F.color.punta);
  }
  R(g, x0, -h - 1, 2, thick + 2, T.tinta);
  R(g, x0 + 1, -h, 1, thick, F.color.aletas);
  if (motor) llama(g, x0, pal, tic, thick);
}

/** Petardo: cilindro rojo con bandas y la mecha atrás (chisporrotea al prenderse). */
function petardo(g: Ctx, m: MisilEnemigo, T: Tintas, tic: number, motor: boolean, aviso: boolean) {
  const F = MISILES[m.tipo];
  const pal = T.paleta;
  const len = 8, thick = 5, x0 = -4, h = 2;
  const prendido = m.mecha > 0;
  R(g, x0, -h, len, thick, T.tinta);
  R(g, x0 + 1, -h + 1, len - 2, thick - 2, prendido && tic % 4 < 2 ? BLANCO : F.color.cuerpo);
  R(g, x0 + 2, -h + 1, 1, thick - 2, F.fuego.banda);
  R(g, x0 + len - 3, -h + 1, 1, thick - 2, F.color.punta);
  R(g, x0 + len - 1, -h + 1, 1, thick - 2, F.color.punta);
  // mecha
  R(g, x0 - 2, 0, 2, 1, '#5a3a2a');
  if (prendido || aviso) {
    // chispazo grande en la mecha: la señal de que va a reventar
    const k = 2 + (tic % 3);
    const c = tic % 2 ? BLANCO : pal[2];
    R(g, x0 - 3 - k, 0, k * 2 + 1, 1, c);
    R(g, x0 - 3, -k, 1, k * 2 + 1, c);
    R(g, x0 - 4, -1, 3, 3, pal[(tic >> 1) % pal.length]);
  } else if (motor) llama(g, x0 - 2, pal, tic, 3);
}

/** Crisantemo: cohete fino con la cabeza redonda llena de estrellas de colores. */
function bulbo(g: Ctx, m: MisilEnemigo, T: Tintas, tic: number, motor: boolean, aviso: boolean) {
  const F = MISILES[m.tipo];
  const pal = T.paleta;
  const n = pal.length;
  const x0 = -5;
  R(g, x0, -1, 7, 3, T.tinta);
  R(g, x0 + 1, 0, 5, 1, F.color.cuerpo);
  R(g, x0, -3, 2, 7, T.tinta);
  R(g, x0 + 1, -2, 1, 5, F.color.aletas);
  disco(g, 4, 0, 3, T.tinta);
  disco(g, 4, 0, 2, aviso ? BLANCO : F.color.cuerpo);
  // estrellitas dentro de la cabeza, rotando de color
  const s = tic >> 2;
  R(g, 3, -1, 1, 1, pal[s % n]);
  R(g, 5, -1, 1, 1, pal[(s + 1) % n]);
  R(g, 3, 1, 1, 1, pal[(s + 2) % n]);
  R(g, 5, 1, 1, 1, pal[(s + 3) % n]);
  R(g, 4, 0, 1, 1, aviso ? pal[s % n] : BLANCO);
  if (motor) llama(g, x0, pal, tic, 3);
}
