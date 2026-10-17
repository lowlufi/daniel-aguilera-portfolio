import type { Mix } from './audio';

export type WeatherId = 'soleado' | 'atardecer' | 'lluvia' | 'niebla' | 'noche' | 'nieve';

export const WEATHERS: { id: WeatherId; label: string; emoji: string }[] = [
  { id: 'soleado', label: 'Soleado', emoji: '☀️' },
  { id: 'atardecer', label: 'Atardecer', emoji: '🌅' },
  { id: 'lluvia', label: 'Lluvia', emoji: '🌧️' },
  { id: 'niebla', label: 'Niebla', emoji: '🌫️' },
  { id: 'noche', label: 'Noche', emoji: '🌙' },
  { id: 'nieve', label: 'Nieve', emoji: '❄️' },
];

type Config = {
  sky: [string, string, string, string, string]; // top, mid, low, horizon, below
  sunDir: [number, number, number];
  sunColor: string;
  sunAmt: number;
  stars: number;
  fog: string;
  fogNear: number;
  fogFar: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  lightColor: string;
  light: number;
  lightPos: [number, number, number];
  ambientColor: string;
  ambient: number;
  cloud: string;
  cloudGlow: string;
  cloudGlowAmt: number;
  water: string;
  waterGlow: string;
  glitter: number;
  glitterColor: string;
  ground: string;
  env: number;
  windows: string;
  rain: number;
  snow: number;
  mist: number;
  fireflies: number;
  mix: Mix;
};

export const WEATHER_CONFIG: Record<WeatherId, Config> = {
  soleado: {
    sky: ['#3d8be0', '#7fc2f3', '#bfe2fa', '#eaf6fb', '#d2ebf2'],
    sunDir: [0.35, 0.62, -0.7],
    sunColor: '#fff4d6',
    sunAmt: 1,
    stars: 0,
    fog: '#d3eaf5',
    fogNear: 55,
    fogFar: 170,
    hemiSky: '#e3f3ff',
    hemiGround: '#7aa05a',
    hemi: 0.83,
    lightColor: '#fff3da',
    light: 1.49,
    lightPos: [12, 30, -12],
    ambientColor: '#ffffff',
    ambient: 0.09,
    cloud: '#ffffff',
    cloudGlow: '#ffffff',
    cloudGlowAmt: 0.4,
    water: '#56b6d6',
    waterGlow: '#3ba7cf',
    glitter: 0.45,
    glitterColor: '#ffffff',
    ground: '#79c95a',
    env: 0.25,
    windows: '#f3e6c4',
    rain: 0,
    snow: 0,
    mist: 0,
    fireflies: 0,
    mix: { pajaritos: 0.52, olas: 0.26, viento: 0.15, arroyo: 0.19 },
  },
  atardecer: {
    sky: ['#4f549e', '#c280c7', '#ff9e94', '#ffc78c', '#fab38c'],
    sunDir: [-0.42, 0.13, -1],
    sunColor: '#ffd180',
    sunAmt: 1,
    stars: 0,
    fog: '#f9b48d',
    fogNear: 42,
    fogFar: 125,
    hemiSky: '#ffd2b0',
    hemiGround: '#6f8f58',
    hemi: 0.76,
    lightColor: '#ffbf85',
    light: 1.32,
    lightPos: [-16, 22, -30],
    ambientColor: '#ffb3c7',
    ambient: 0.11,
    cloud: '#fff6ee',
    cloudGlow: '#ffb4a0',
    cloudGlowAmt: 0.55,
    water: '#e89a8c',
    waterGlow: '#ff8a6a',
    glitter: 1,
    glitterColor: '#ffdb99',
    ground: '#79c95a',
    env: 0.18,
    windows: '#ffd98a',
    rain: 0,
    snow: 0,
    mist: 0,
    fireflies: 0.85,
    mix: { olas: 0.45, pajaritos: 0.15, viento: 0.11, musica: 0.22 },
  },
  lluvia: {
    sky: ['#56657a', '#76849a', '#95a1b0', '#a9b2bd', '#98a3ad'],
    sunDir: [0, 0.5, -1],
    sunColor: '#ffffff',
    sunAmt: 0,
    stars: 0,
    fog: '#9aa5b1',
    fogNear: 22,
    fogFar: 90,
    hemiSky: '#bcc8d4',
    hemiGround: '#566c46',
    hemi: 0.68,
    lightColor: '#d4dde6',
    light: 0.47,
    lightPos: [0, 30, -10],
    ambientColor: '#a9b8c9',
    ambient: 0.17,
    cloud: '#b4bdc8',
    cloudGlow: '#6c7784',
    cloudGlowAmt: 0.45,
    water: '#6a7f8e',
    waterGlow: '#223040',
    glitter: 0,
    glitterColor: '#ffffff',
    ground: '#6cb84e',
    env: 0.16,
    windows: '#ffd98a',
    rain: 1,
    snow: 0,
    mist: 0.25,
    fireflies: 0,
    mix: { lluvia: 0.6, truenos: 0.3, viento: 0.19 },
  },
  niebla: {
    sky: ['#aeb4c9', '#c7cad8', '#dcdce4', '#e6e3e6', '#d9d8de'],
    sunDir: [0.25, 0.3, -1],
    sunColor: '#fff6e6',
    sunAmt: 0.35,
    stars: 0,
    fog: '#dddde4',
    fogNear: 8,
    fogFar: 58,
    hemiSky: '#e9ebf5',
    hemiGround: '#7d9270',
    hemi: 0.8,
    lightColor: '#fff4e2',
    light: 0.55,
    lightPos: [6, 26, -24],
    ambientColor: '#e8e6f0',
    ambient: 0.2,
    cloud: '#eceef4',
    cloudGlow: '#ffffff',
    cloudGlowAmt: 0.25,
    water: '#aab3bd',
    waterGlow: '#7d8894',
    glitter: 0.08,
    glitterColor: '#ffffff',
    ground: '#78bf5c',
    env: 0.14,
    windows: '#ffd98a',
    rain: 0,
    snow: 0,
    mist: 1,
    fireflies: 0,
    mix: { viento: 0.19, arroyo: 0.26, pajaritos: 0.11, musica: 0.15 },
  },
  noche: {
    sky: ['#0a0f2e', '#18214e', '#2d3876', '#474e8a', '#232a55'],
    sunDir: [0.4, 0.32, -1],
    sunColor: '#eef2ff',
    sunAmt: 0.75,
    stars: 1,
    fog: '#1b2150',
    fogNear: 35,
    fogFar: 120,
    hemiSky: '#6a7cc8',
    hemiGround: '#26363a',
    hemi: 0.68,
    lightColor: '#b6c3ff',
    light: 0.64,
    lightPos: [14, 25, -30],
    ambientColor: '#5060a0',
    ambient: 0.13,
    cloud: '#3c4474',
    cloudGlow: '#1a2052',
    cloudGlowAmt: 0.35,
    water: '#1f2b5a',
    waterGlow: '#101a44',
    glitter: 0.45,
    glitterColor: '#cfd9ff',
    ground: '#79c95a',
    env: 0.06,
    windows: '#ffcf6b',
    rain: 0,
    snow: 0,
    mist: 0,
    fireflies: 1,
    mix: { grillos: 0.45, olas: 0.22, viento: 0.08, musica: 0.19 },
  },
  nieve: {
    sky: ['#98afcf', '#c3d0e3', '#dfe6f0', '#eef1f6', '#dde4ee'],
    sunDir: [0.2, 0.35, -1],
    sunColor: '#ffffff',
    sunAmt: 0.35,
    stars: 0,
    fog: '#e2e8f1',
    fogNear: 28,
    fogFar: 105,
    hemiSky: '#f1f5ff',
    hemiGround: '#c9d3dc',
    hemi: 0.79,
    lightColor: '#ffffff',
    light: 0.81,
    lightPos: [5, 30, -20],
    ambientColor: '#ffffff',
    ambient: 0.12,
    cloud: '#f4f6fa',
    cloudGlow: '#ffffff',
    cloudGlowAmt: 0.3,
    water: '#8ea6bc',
    waterGlow: '#5f7a92',
    glitter: 0.12,
    glitterColor: '#ffffff',
    ground: '#e6edf2',
    env: 0.23,
    windows: '#ffd98a',
    rain: 0,
    snow: 1,
    mist: 0,
    fireflies: 0,
    mix: { viento: 0.38, fogata: 0.38, musica: 0.22 },
  },
};

/* The live, blended atmosphere. The scene reads from it every frame. Colors
   are [r, g, b] in 0..255; `css()` turns one into a CSS color. */
export type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const c = hex.replace('#', '');
  const n = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
export const css = (c: Rgb, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);

const rgb = (): Rgb => [0, 0, 0];
export const atmo = {
  target: 'atardecer' as WeatherId,
  sky: [rgb(), rgb(), rgb(), rgb(), rgb()] as Rgb[],
  sunDir: [0, 1, 0] as [number, number, number],
  sunColor: rgb(),
  sunAmt: 0,
  stars: 0,
  fog: rgb(),
  fogNear: 0,
  fogFar: 0,
  light: 0,
  cloud: rgb(),
  cloudGlow: rgb(),
  cloudGlowAmt: 0,
  water: rgb(),
  waterGlow: rgb(),
  glitter: 0,
  ground: rgb(),
  windows: rgb(),
  rain: 0,
  snow: 0,
  mist: 0,
  fireflies: 0,
  flash: 0,
};

function lerpColor(c: Rgb, hex: string, k: number) {
  const t = hexToRgb(hex);
  c[0] += (t[0] - c[0]) * k;
  c[1] += (t[1] - c[1]) * k;
  c[2] += (t[2] - c[2]) * k;
}

// k = 1 snaps instantly (first frame); otherwise blends toward the target.
export function stepAtmosphere(k: number) {
  const t = WEATHER_CONFIG[atmo.target];
  t.sky.forEach((hex, i) => lerpColor(atmo.sky[i], hex, k));
  for (let i = 0; i < 3; i++) atmo.sunDir[i] += (t.sunDir[i] - atmo.sunDir[i]) * k;
  lerpColor(atmo.sunColor, t.sunColor, k);
  atmo.sunAmt += (t.sunAmt - atmo.sunAmt) * k;
  atmo.stars += (t.stars - atmo.stars) * k;
  lerpColor(atmo.fog, t.fog, k);
  atmo.fogNear += (t.fogNear - atmo.fogNear) * k;
  atmo.fogFar += (t.fogFar - atmo.fogFar) * k;
  atmo.light += (t.light - atmo.light) * k;
  lerpColor(atmo.cloud, t.cloud, k);
  lerpColor(atmo.cloudGlow, t.cloudGlow, k);
  atmo.cloudGlowAmt += (t.cloudGlowAmt - atmo.cloudGlowAmt) * k;
  lerpColor(atmo.water, t.water, k);
  lerpColor(atmo.waterGlow, t.waterGlow, k);
  atmo.glitter += (t.glitter - atmo.glitter) * k;
  lerpColor(atmo.ground, t.ground, k);
  lerpColor(atmo.windows, t.windows, k);
  atmo.rain += (t.rain - atmo.rain) * k;
  atmo.snow += (t.snow - atmo.snow) * k;
  atmo.mist += (t.mist - atmo.mist) * k;
  atmo.fireflies += (t.fireflies - atmo.fireflies) * k;
}
