import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { GameStore } from './store';
import { SPAWN, groundHeight, resolveCollisions } from './world';

/* ---------------- Dui (Daniel's cat) ---------------- */

const FUR = '#f0913a';
const STRIPE = '#c4601d';
const CREAM = '#fbe6c4';
const NOSE = '#f08f95';
const EAR_IN = '#f6b5a8';
const EYE = '#2b1d16';

// Keeps this far from the player; only starts walking again once the gap passes FOLLOW + SLACK,
// so tiny player shuffles don't make it twitch back and forth.
const FOLLOW = 1.2;
const SLACK = 0.35;
// The player walks at 3.8 and runs at 6.4: topping out just under the walk means it trails, never overtakes.
const MAX_SPEED = 3.6;
// Closer than this and the player is stepping on it, so it shuffles aside.
const PERSONAL = 0.7;
const PET_TIME = 0.7;
// Guiding: after the player has stood still this long, Dui trots towards the
// next notebook stamp and waits there, a little short of it. Showing beats
// telling for visitors who have never played a game.
const GUIDE_AFTER = 6;
const GUIDE_MIN_DIST = 5;
const GUIDE_SHORT = 2.2;
const SIT_TILT = 0.38;

// Diagonal pairs swing together (front-left with back-right), like a real trot.
const LEGS = [
  { x: -0.14, z: 0.16, front: true, side: 1 },
  { x: 0.14, z: 0.16, front: true, side: -1 },
  { x: -0.15, z: -0.17, front: false, side: -1 },
  { x: 0.15, z: -0.17, front: false, side: 1 },
];

// Tabby stripes: rings cut from the body sphere at a few depths, so they hug the back exactly.
const BODY_R = 0.28;
const STRIPES = [
  { z: -0.17, arc: 0.4 },
  { z: -0.07, arc: 0.55 },
  { z: 0.03, arc: 0.55 },
  { z: 0.13, arc: 0.42 },
].map((s) => ({ ...s, r: Math.sqrt(BODY_R * BODY_R - s.z * s.z) + 0.004 }));

type DuiProps = {
  store: GameStore;
  reduceMotion: boolean;
  // Fired on click/tap with Dui's world position: the host plays the purr / spawns hearts there.
  onPet?: (x: number, z: number) => void;
  // Fired once when Dui reaches the spot it is guiding the player to.
  onGuideArrive?: () => void;
  // The model is built ~0.72 tall to the ear tips; 1.15 lands it around the player's thigh and above most grass.
  scale?: number;
};

export function Dui({ store, reduceMotion, onPet, onGuideArrive, scale = 1.15 }: DuiProps) {
  const root = useRef<THREE.Group>(null);
  const pose = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const tailYaw = useRef<THREE.Group>(null);
  const tailPitch = useRef<THREE.Group>(null);
  const tailTip = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const shins = useRef<(THREE.Mesh | null)[]>([]);
  const st = useMemo(
    () => ({
      pos: new THREE.Vector3(SPAWN.x + 1.1, 0, SPAWN.z + 0.4),
      facing: 0,
      speed: 0,
      moving: false,
      phase: 0,
      amt: 0,
      breath: 0,
      sit: 1,
      idleT: 1,
      pet: 0,
      blinkT: 2,
      blink: 0,
      eyeOpen: 1,
      playerIdle: 0,
      guide: false,
      guideArrived: false,
      guideTo: new THREE.Vector3(),
    }),
    [],
  );
  // Same dev-only hook as window.__island in IslandGame: lets tests watch Dui's
  // state. import.meta.env.DEV is false in production builds, so it's stripped.
  if (import.meta.env.DEV) (store as unknown as { dui?: typeof st }).dui = st;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const m = reduceMotion ? 0 : 1;
    const p = st.pos;
    const dx = store.pos.x - p.x;
    const dz = store.pos.z - p.z;
    const d = Math.hypot(dx, dz);

    // Guide mode starts after the player has stood still for a while (dialogs
    // and panels freeze the player, so reading never triggers it) and ends as
    // soon as they move again.
    const goal = store.duiGoal;
    st.playerIdle = store.started && !store.frozen && store.speed < 0.1 ? st.playerIdle + dt : 0;
    if (st.guide && (store.speed > 0.3 || !goal)) {
      st.guide = false;
      st.guideArrived = false;
    } else if (!st.guide && goal && st.playerIdle > GUIDE_AFTER) {
      const gx = store.pos.x - goal.x;
      const gz = store.pos.z - goal.z;
      const gd = Math.hypot(gx, gz);
      if (gd > GUIDE_MIN_DIST) {
        // Wait a little short of the place, on the player's side, so the
        // player sees both Dui and where it is pointing.
        st.guideTo.set(goal.x + (gx / gd) * GUIDE_SHORT, 0, goal.z + (gz / gd) * GUIDE_SHORT);
        st.guide = true;
        st.guideArrived = false;
        st.moving = true;
      }
    }

    // Where it walks to: the player (stopping at the follow ring) or the guide spot.
    const tx = (st.guide ? st.guideTo.x : store.pos.x) - p.x;
    const tz = (st.guide ? st.guideTo.z : store.pos.z) - p.z;
    const td = Math.hypot(tx, tz);
    const stopAt = st.guide ? 0.25 : FOLLOW;

    if (st.moving) {
      if (td < stopAt) st.moving = false;
    } else if (td > stopAt + SLACK) st.moving = true;
    // Speed grows with the gap, so it trots to catch up and eases in as it arrives.
    const want = st.moving ? Math.min(MAX_SPEED, (td - stopAt) * 2.4 + 0.6) : 0;
    st.speed += (want - st.speed) * (1 - Math.exp(-5 * dt));
    if (st.speed > 0.02 && td > 1e-3) {
      // Never step past the stopping ring while braking.
      const step = Math.min(st.speed * dt, Math.max(0, td - stopAt * 0.9));
      p.x += (tx / td) * step;
      p.z += (tz / td) * step;
      resolveCollisions(p);
    }
    if (st.guide && !st.guideArrived && td < stopAt + 0.15) {
      st.guideArrived = true;
      onGuideArrive?.();
    }
    if (d < PERSONAL && d > 1e-3) {
      const push = (PERSONAL - d) * (1 - Math.exp(-10 * dt));
      p.x -= (dx / d) * push;
      p.z -= (dz / d) * push;
      resolveCollisions(p);
    }
    p.y += (groundHeight(p.x, p.z) - p.y) * (1 - Math.exp(-14 * dt));

    // Faces where it walks while trotting (when guiding that's away from the
    // player; looking back would make it walk backwards), and the player once
    // it stops. Turns quickly while walking, lazily while sitting.
    const walking = st.speed > 0.2 && td > 1e-3;
    if (walking || d > 1e-3) {
      let diff = (walking ? Math.atan2(tx, tz) : Math.atan2(dx, dz)) - st.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      st.facing += diff * (1 - Math.exp(-(st.speed > 0.2 ? 8 : 2.5) * dt));
    }

    // Sits once the player has been still for a moment.
    st.idleT = store.speed < 0.1 && st.speed < 0.15 ? st.idleT + dt : 0;
    const sitWant = st.idleT > 0.8 ? 1 : 0;
    st.sit += (sitWant - st.sit) * (1 - Math.exp(-(sitWant ? 3 : 9) * dt));

    st.amt += (Math.min(st.speed / 2.5, 1) - st.amt) * (1 - Math.exp(-10 * dt));
    st.phase += dt * (5 + st.speed * 3.2) * (st.amt > 0.03 ? 1 : 0);
    // Accumulated (not clock * freq) so slowing the breath while sitting doesn't jump its phase.
    st.breath += dt * (2.4 - 0.9 * st.sit);

    st.pet = Math.max(0, st.pet - dt);
    const k = 1 - st.pet / PET_TIME;
    const squish = st.pet > 0 ? Math.sin(k * Math.PI * 3) * (1 - k) * 0.18 * m : 0;

    st.blinkT -= dt;
    if (st.blinkT < 0) {
      // Sitting cats do the slow "I trust you" blink.
      st.blink = st.sit > 0.5 ? 0.6 : 0.13;
      st.blinkT = st.blink + 2 + Math.random() * 3;
    }
    st.blink = Math.max(0, st.blink - dt);
    const eyeWant = st.pet > 0 ? 0.15 : st.blink > 0 ? 0.1 : 1;
    st.eyeOpen += (eyeWant - st.eyeOpen) * (1 - Math.exp(-(st.sit > 0.5 && st.pet <= 0 ? 7 : 30) * dt));

    const s = Math.sin(st.phase);
    const a = st.amt * m;
    if (root.current) {
      root.current.position.copy(p);
      root.current.rotation.y = st.facing;
    }
    if (pose.current) pose.current.rotation.x = -SIT_TILT * st.sit;
    if (body.current) {
      const breath = 1 + Math.sin(st.breath) * 0.018 * m;
      body.current.position.y = Math.abs(s) * 0.035 * a;
      // The waddle: a fat cat rolls side to side more than it bobs.
      body.current.rotation.z = s * 0.13 * a;
      body.current.scale.set(1 + squish * 0.6, breath * (1 - squish), 1 + squish * 0.6);
    }
    if (head.current) {
      // Counter the sitting tilt so the face stays level.
      head.current.rotation.x = SIT_TILT * st.sit + Math.sin(st.phase * 2) * 0.04 * a;
      head.current.rotation.z = st.pet > 0 ? Math.sin(k * Math.PI) * 0.25 * m : 0;
    }
    if (eyes.current) eyes.current.scale.y = st.eyeOpen;
    for (let i = 0; i < LEGS.length; i++) {
      const g = legs.current[i];
      if (!g) continue;
      const sw = s * LEGS[i].side * a;
      g.position.z = LEGS[i].z + sw * 0.06;
      g.position.y = Math.max(0, sw) * 0.04;
      // Front legs straighten to prop the chest up while sitting.
      const shin = shins.current[i];
      if (shin && LEGS[i].front) {
        shin.scale.y = 1 + st.sit * 1.2;
        shin.position.y = 0.09 * shin.scale.y;
      }
    }
    if (tailYaw.current) tailYaw.current.rotation.y = (Math.sin(st.phase * 0.5) * 0.35 * a + Math.sin(st.breath * 0.7) * 0.15 * (1 - st.sit) * m) + 0.75 * st.sit;
    // Up like a flag while walking, draped on the ground and curled around the side while sitting.
    if (tailPitch.current) tailPitch.current.rotation.x = -0.5 - 1.25 * st.sit;
    if (tailTip.current) {
      tailTip.current.rotation.x = 0.5 - 0.05 * st.sit;
      tailTip.current.rotation.z = 1.3 * st.sit + Math.sin(st.breath * 0.5) * 0.15 * st.sit * m;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!store.started || e.delta > 6) return; // that was a camera drag
    st.pet = PET_TIME;
    onPet?.(st.pos.x, st.pos.z);
  };

  return (
    <group
      ref={root}
      position={st.pos.toArray()}
      scale={scale}
      onClick={onClick}
      onPointerOver={() => store.started && (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} scale={[1, 1.3, 1]}>
        <circleGeometry args={[0.34, 20]} />
        <meshBasicMaterial color="#3b2a22" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* Invisible, generous hit area: the cat is small on a phone screen. */}
      <mesh position={[0, 0.35, 0.05]} scale={[1, 0.8, 1.3]}>
        <sphereGeometry args={[0.42, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {LEGS.map((l, i) => (
        <group key={i} ref={(g) => void (legs.current[i] = g)} position={[l.x, 0, l.z]}>
          <mesh ref={(m) => void (shins.current[i] = m)} position-y={0.09} castShadow>
            <capsuleGeometry args={[0.065, 0.05, 4, 8]} />
            <meshStandardMaterial roughness={0.55} color={FUR} />
          </mesh>
          {/* White socks. */}
          <mesh position={[0, 0.03, 0.012]} scale={[1, 0.6, 1.1]}>
            <sphereGeometry args={[0.068, 10, 8]} />
            <meshStandardMaterial roughness={0.55} color={CREAM} />
          </mesh>
        </group>
      ))}
      {/* Pivots at the rump so sitting lifts the chest instead of sinking the bottom. */}
      <group ref={pose} position-z={-0.24}>
        <group position-z={0.24}>
          <group ref={body}>
            <mesh position-y={0.3} scale={[1.05, 0.82, 1.15]} castShadow>
              <sphereGeometry args={[BODY_R, 20, 14]} />
              <meshStandardMaterial roughness={0.55} color={FUR} />
            </mesh>
            <group position-y={0.3} scale={[1.05, 0.82, 1.15]}>
              {STRIPES.map((s) => (
                <mesh key={s.z} position-z={s.z} rotation-z={Math.PI / 2 - (s.arc * Math.PI) / 2}>
                  <torusGeometry args={[s.r, 0.024, 4, 12, s.arc * Math.PI]} />
                  <meshStandardMaterial roughness={0.55} color={STRIPE} />
                </mesh>
              ))}
            </group>
            <mesh position={[0, 0.2, 0.17]} scale={[1.1, 1, 0.8]}>
              <sphereGeometry args={[0.17, 14, 10]} />
              <meshStandardMaterial roughness={0.55} color={CREAM} />
            </mesh>

            <group position={[0, 0.24, -0.3]}>
              <group ref={tailYaw}>
                <group ref={tailPitch}>
                  <mesh position-y={0.13} castShadow>
                    <capsuleGeometry args={[0.05, 0.16, 4, 8]} />
                    <meshStandardMaterial roughness={0.55} color={FUR} />
                  </mesh>
                  <mesh position-y={0.12} rotation-x={Math.PI / 2}>
                    <torusGeometry args={[0.051, 0.014, 4, 10]} />
                    <meshStandardMaterial roughness={0.55} color={STRIPE} />
                  </mesh>
                  <group ref={tailTip} position-y={0.25}>
                    <mesh position-y={0.09} castShadow>
                      <capsuleGeometry args={[0.045, 0.12, 4, 8]} />
                      <meshStandardMaterial roughness={0.55} color={FUR} />
                    </mesh>
                    <mesh position-y={0.1} rotation-x={Math.PI / 2}>
                      <torusGeometry args={[0.046, 0.013, 4, 10]} />
                      <meshStandardMaterial roughness={0.55} color={STRIPE} />
                    </mesh>
                  </group>
                </group>
              </group>
            </group>

            <group ref={head} position={[0, 0.47, 0.3]}>
              <mesh scale={[1.1, 0.95, 1]} castShadow>
                <sphereGeometry args={[0.19, 20, 14]} />
                <meshStandardMaterial roughness={0.4} color={FUR} />
              </mesh>
              {/* Forehead "M" marks, laid tangent to the skull. */}
              {[-0.045, 0, 0.045].map((x) => (
                <mesh key={x} position={[x, 0.12, 0.13]} rotation-x={-0.73} scale={[1, x === 0 ? 1.3 : 1, 0.5]}>
                  <capsuleGeometry args={[0.013, 0.045, 4, 6]} />
                  <meshStandardMaterial roughness={0.55} color={STRIPE} />
                </mesh>
              ))}
              <mesh position={[0, -0.065, 0.14]} scale={[1.45, 0.85, 0.8]}>
                <sphereGeometry args={[0.075, 14, 10]} />
                <meshStandardMaterial roughness={0.55} color={CREAM} />
              </mesh>
              <mesh position={[0, -0.025, 0.195]} scale={[1.3, 0.85, 0.8]}>
                <sphereGeometry args={[0.022, 8, 6]} />
                <meshStandardMaterial roughness={0.4} color={NOSE} />
              </mesh>
              <group ref={eyes} position-y={0.035}>
                {[-1, 1].map((sx) => (
                  <group key={sx}>
                    <mesh position={[sx * 0.08, 0, 0.165]} scale={[1, 1.25, 0.6]}>
                      <sphereGeometry args={[0.032, 12, 10]} />
                      <meshStandardMaterial color={EYE} roughness={0.15} />
                    </mesh>
                    <mesh position={[sx * 0.08 + 0.012, 0.015, 0.183]}>
                      <sphereGeometry args={[0.01, 6, 5]} />
                      <meshBasicMaterial color="#ffffff" />
                    </mesh>
                  </group>
                ))}
              </group>
              {[-1, 1].map((sx) => (
                <group key={sx}>
                  <group position={[sx * 0.1, 0.13, 0.02]} rotation={[-0.15, 0, -sx * 0.35]}>
                    <mesh position-y={0.05} rotation-y={Math.PI / 4} castShadow>
                      <coneGeometry args={[0.07, 0.13, 4]} />
                      <meshStandardMaterial roughness={0.55} color={FUR} />
                    </mesh>
                    <group position={[0, 0.035, 0.025]} scale={[1, 1, 0.45]}>
                      <mesh rotation-y={Math.PI / 4}>
                        <coneGeometry args={[0.045, 0.085, 4]} />
                        <meshStandardMaterial roughness={0.55} color={EAR_IN} />
                      </mesh>
                    </group>
                  </group>
                  {[0, 1].map((i) => (
                    <mesh key={i} position={[sx * 0.12, -0.055 - i * 0.025, 0.16]} rotation={[0, -sx * 0.3, sx * (0.12 - i * 0.2)]}>
                      <boxGeometry args={[0.13, 0.006, 0.006]} />
                      <meshBasicMaterial color="#fff6e8" />
                    </mesh>
                  ))}
                </group>
              ))}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
