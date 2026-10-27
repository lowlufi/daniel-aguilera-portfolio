/*
 * Shared shapes for the plane game's physics. Units: positions in game pixels,
 * time in seconds. x grows to the right, y is ALTITUDE (grows UP). Angles in
 * radians, 0 = pointing +x, positive = counter-clockwise (nose up when flying
 * right). `fisica-vuelo.ts` and `fisica-armas.ts` implement the behaviour;
 * `motor.ts` only calls their functions and draws the result.
 */

export type Vec = { x: number; y: number };
export type Movil = Vec & { vx: number; vy: number };

/** Ground altitude at a given x (the terrain is a height field). */
export type Suelo = (x: number) => number;

/** The three planes built at home (Lulu's, Dui's and Almendrita's). */
export type ModeloBase = 'avioneta' | 'caza' | 'bombardero';
/**
 * Who flies. Any pilot can take any plane; each one has a home plane
 * (pilotos.ts). Old saves stored the pilot as their home plane's ModeloBase.
 */
export type Piloto = 'dui' | 'lulu' | 'almendrita' | 'naxo' | 'nelo';
/** Every plane in the hangar: the home ones plus the iconic jets and the saucer. */
export type ModeloAvion = ModeloBase | 'raptor' | 'sukhoi' | 'b2' | 'ovni' | 'tomcat' | 'a10' | 'spitfire' | 'stuka' | 'mustang' | 'corsair' | 'f16' | 'mig29';
/** Bomb loads: plain, cluster, white phosphorus, gas, and the saucer's plasma charge. */
export type BombaTipo = 'comun' | 'racimo' | 'fosforo' | 'gas' | 'plasma' | 'guiada' | 'rebote' | 'crio' | 'emp' | 'termobarica';

/**
 * Stick input. x: -1 left … +1 right, y: -1 down … +1 up, in SCREEN
 * directions (the player points where they want to fly). gas: -1…1, the
 * throttle: 0 holds cruise speed, +1 is full power, -1 idles the engine and
 * opens the air brakes.
 */
export type Mando = {
  x: number; y: number; gas: number;
  /**
   * The pilot is holding a continuous turn (touch «hold a side»): +1 counterclockwise,
   * -1 clockwise. The plane rolls so that turn is a pull, and keeps pulling round full loops.
   */
  giro?: number;
};

export type Avion = Movil & {
  /** Where the nose points. */
  rumbo: number;
  /** Pitch rate, rad/s. */
  omega: number;
  /** Roll state for drawing: +1 canopy up, -1 rolled over; values in between mid-roll. */
  alabeo: number;
  /** Current load factor in g (for HUD/effects). */
  carga: number;
  /** True while the wing is stalled. */
  perdida: boolean;
  /** Throttle actually applied, 0…1 (for engine sound / flame size). */
  gas: number;
};

export type EventoVuelo =
  | { tipo: 'perdida' }
  | { tipo: 'recupera' }
  | { tipo: 'toqueSuelo'; velocidad: number }
  | { tipo: 'techo' };

export type Misil = Movil & {
  rumbo: number;
  /** Seconds since launch. */
  t: number;
  /** Seconds of motor burn left. */
  combustible: number;
  /** False once the seeker has been decoyed or the target is lost. */
  guiado: boolean;
};

export type Bomba = Movil & { rumbo: number; t: number };

/** Unguided shells, rockets, flares, debris, parachute crates, smoke puffs. */
export type Cuerpo = Movil & { t: number };

export type Vehiculo = Movil & {
  /** Hull tilt from the slope and suspension, rad (0 = level). */
  angulo: number;
  /** Suspension compression offset in px (draw the hull this much lower/higher). */
  suspension: number;
  /** Suspension velocity. */
  vSuspension: number;
  /** Mass in game units (heavier = less knock-back). */
  masa: number;
};

export type Explosion = {
  /** Radius of the fireball, px. */
  radio: number;
  /** Damage fraction 0…1 at distance d from the centre. */
  dano: (d: number) => number;
  /** Impulse (px/s of velocity change for a unit-mass body) at distance d. */
  impulso: (d: number) => number;
};
