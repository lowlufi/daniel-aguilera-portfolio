import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import { sfx } from './audio';
import type { GameEvents, GameStore } from './store';
import {
  COLLIDERS,
  DANIEL,
  GARDEN,
  GARDEN_PLOTS,
  HOUSE,
  INTERACTABLES,
  ISLAND_R,
  MAILBOX,
  PATH_STONES,
  PLAZA,
  PROJECT_SIGNS,
  SPAWN,
  STAR_COUNT,
  SUN_DIR,
  TREES,
  WELCOME,
  WORKSHOP,
  blocksGrass,
  mulberry32,
  resolveCollisions,
  type InteractableId,
} from './world';

type SceneProps = {
  store: GameStore;
  events: MutableRefObject<GameEvents>;
  quality: 'high' | 'low';
  onWalkTo: (id: InteractableId) => void;
};

export default function Scene({ store, events, quality, onWalkTo }: SceneProps) {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog('#f9b48d', 42, 125);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  return (
    <>
      <hemisphereLight args={['#ffd2b0', '#6f8f58', 1.05]} />
      <directionalLight
        position={[-16, 22, -30]}
        intensity={1.55}
        color="#ffbf85"
        castShadow
        shadow-mapSize-width={quality === 'high' ? 2048 : 1024}
        shadow-mapSize-height={quality === 'high' ? 2048 : 1024}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <ambientLight intensity={0.18} color="#ffb3c7" />

      <Sky />
      <Clouds />
      <Ocean />
      <Island store={store} />
      <PathStones />
      <Trees store={store} />
      <Flowers />
      <Rocks />
      <Dock />

      <House x={HOUSE.x} z={HOUSE.z} wall="#fbe8c8" roof="#d9695f" door="#8a5a3b" label="Casa de Daniel" />
      <House x={WORKSHOP.x} z={WORKSHOP.z} wall="#f3e2c7" roof="#6f9fd8" door="#6b4a3a" label="Taller" scale={1.1} />

      <Clickable id="board" onWalkTo={onWalkTo}>
        <ProjectBoard />
      </Clickable>
      {PROJECT_SIGNS.map((s) => (
        <Clickable key={s.project.id} id={`project:${s.project.id}`} onWalkTo={onWalkTo}>
          <ProjectSign x={s.x} z={s.z} rot={s.rot} color={s.color} title={s.project.title} soon={!!s.project.comingSoon} store={store} />
        </Clickable>
      ))}
      <Clickable id="garden" onWalkTo={onWalkTo}>
        <Garden />
      </Clickable>
      <Clickable id="mailbox" onWalkTo={onWalkTo}>
        <Mailbox />
      </Clickable>
      <Clickable id="welcome" onWalkTo={onWalkTo}>
        <WelcomeSign />
      </Clickable>
      <Clickable id="daniel" onWalkTo={onWalkTo}>
        <DanielNpc store={store} />
      </Clickable>

      <Grass store={store} events={events} quality={quality} />
      <Stars store={store} events={events} />
      <Player store={store} events={events} />
      <CameraRig store={store} />

      <Sparkles count={quality === 'high' ? 70 : 35} scale={[46, 3.5, 46]} position={[0, 1.8, -2]} size={3.2} speed={0.25} color="#ffe6a0" opacity={0.85} noise={1.2} />
    </>
  );
}

function Clickable({ id, onWalkTo, children }: { id: InteractableId; onWalkTo: (id: InteractableId) => void; children: ReactNode }) {
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onWalkTo(id);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      {children}
    </group>
  );
}

function Label({
  children,
  y,
  tone = 'cream',
  size = 20,
  innerRef,
}: {
  children: ReactNode;
  y: number;
  tone?: 'cream' | 'orange';
  size?: number;
  innerRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={size} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        ref={innerRef}
        style={{ transition: 'opacity 250ms ease' }}
        className={`font-cozy whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-extrabold shadow-[0_3px_0_rgba(91,70,54,0.25)] ${
          tone === 'orange' ? 'bg-[#f0a45d] text-white' : 'bg-[#fff8e7]/95 text-[#6b4f3a]'
        }`}
      >
        {children}
      </div>
    </Html>
  );
}

/* ---------------- Sky & atmosphere ---------------- */

function Sky() {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSun: { value: SUN_DIR.clone() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 top = vec3(0.31, 0.33, 0.62);
            vec3 mid = vec3(0.76, 0.50, 0.78);
            vec3 low = vec3(1.0, 0.62, 0.58);
            vec3 hor = vec3(1.0, 0.78, 0.55);
            vec3 below = vec3(0.98, 0.70, 0.55);
            vec3 col;
            if (h < 0.0) col = mix(hor, below, clamp(-h * 4.0, 0.0, 1.0));
            else if (h < 0.09) col = mix(hor, low, h / 0.09);
            else if (h < 0.36) col = mix(low, mid, (h - 0.09) / 0.27);
            else col = mix(mid, top, clamp((h - 0.36) / 0.5, 0.0, 1.0));
            float sd = max(dot(d, normalize(uSun)), 0.0);
            col += vec3(1.0, 0.82, 0.5) * pow(sd, 28.0) * 0.6;
            col += vec3(1.0, 0.7, 0.45) * pow(sd, 5.0) * 0.2;
            col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.9983, 0.9991, sd));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  );
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[420, 32, 16]} />
    </mesh>
  );
}

const CLOUDS = (() => {
  const rnd = mulberry32(99);
  return Array.from({ length: 16 }, (_, i) => {
    const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.6;
    const dist = 55 + rnd() * 95;
    return {
      x: Math.cos(a) * dist,
      z: Math.sin(a) * dist,
      y: 12 + rnd() * 26 + (i % 4 === 0 ? 10 : 0),
      scale: 3 + rnd() * 4.5,
      puffs: Array.from({ length: 5 + Math.floor(rnd() * 4) }, (_, j) => ({
        x: (j - 3) * 0.9 + (rnd() - 0.5) * 0.6,
        y: (rnd() - 0.3) * 0.6,
        z: (rnd() - 0.5) * 0.9,
        r: 0.7 + rnd() * 0.7 - Math.abs(j - 3) * 0.08,
      })),
      speed: 0.25 + rnd() * 0.4,
    };
  });
})();

function Clouds() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#fff6ee', emissive: '#ffb4a0', emissiveIntensity: 0.55, fog: false }), []);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  useFrame((_, dt) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      g.position.x += CLOUDS[i].speed * dt;
      if (g.position.x > 170) g.position.x = -170;
    });
  });
  return (
    <group>
      {CLOUDS.map((c, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} position={[c.x, c.y, c.z]} scale={c.scale}>
          {c.puffs.map((p, j) => (
            <mesh key={j} geometry={geo} material={mat} position={[p.x, p.y, p.z]} scale={[p.r, p.r * 0.8, p.r]} />
          ))}
        </group>
      ))}
    </group>
  );
}

function Ocean() {
  const glitter = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float w = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float s = sin(vUv.y * 420.0 - uTime * 1.6 + sin(vUv.x * 30.0 + uTime) * 2.5);
            float a = smoothstep(0.82, 1.0, s) * w * w * smoothstep(0.0, 0.08, vUv.y) * (1.0 - vUv.y * 0.6);
            gl_FragColor = vec4(1.0, 0.86, 0.6, a * 0.75);
          }`,
      }),
    [],
  );
  const foam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    glitter.uniforms.uTime.value = clock.elapsedTime;
    if (foam.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 0.9) * 0.012;
      foam.current.scale.set(s, s, 1);
    }
  });
  const sunYaw = Math.atan2(SUN_DIR.x, SUN_DIR.z);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.55} receiveShadow>
        <circleGeometry args={[420, 48]} />
        <meshLambertMaterial color="#e89a8c" emissive="#ff8a6a" emissiveIntensity={0.18} />
      </mesh>
      <group rotation-y={sunYaw}>
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 150]}>
          <planeGeometry args={[26, 250]} />
          <primitive object={glitter} attach="material" />
        </mesh>
      </group>
      <mesh ref={foam} rotation-x={-Math.PI / 2} position-y={-0.5}>
        <ringGeometry args={[29.4, 30.6, 64]} />
        <meshBasicMaterial color="#fff4ea" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

/* ---------------- Terrain ---------------- */

function Island({ store }: { store: GameStore }) {
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (store.frozen) return;
    e.stopPropagation();
    store.target = new THREE.Vector3(e.point.x, 0, e.point.z);
    store.targetId = null;
  };
  return (
    <group>
      <mesh position-y={-1} receiveShadow onClick={onClick}>
        <cylinderGeometry args={[ISLAND_R, ISLAND_R - 0.8, 2, 72]} />
        <meshLambertMaterial attach="material-0" color="#9b6b43" />
        <meshLambertMaterial attach="material-1" color="#86b85a" />
        <meshLambertMaterial attach="material-2" color="#9b6b43" />
      </mesh>
      <mesh position-y={-0.85} receiveShadow onClick={onClick}>
        <cylinderGeometry args={[ISLAND_R + 3.2, ISLAND_R + 4.2, 1, 72]} />
        <meshLambertMaterial color="#f3d6a4" />
      </mesh>
    </group>
  );
}

function PathStones() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    PATH_STONES.forEach((s, i) => {
      o.position.set(s.x, 0.02, s.z);
      o.rotation.set(0, s.rot, 0);
      o.scale.set(s.r, 1, s.r * 0.8);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, PATH_STONES.length]} receiveShadow>
      <cylinderGeometry args={[1, 1, 0.08, 9]} />
      <meshLambertMaterial color="#d9b98c" />
    </instancedMesh>
  );
}

function Trees({ store }: { store: GameStore }) {
  return (
    <group>
      {TREES.map((t, i) => (
        <Tree key={i} {...t} seed={i} store={store} />
      ))}
    </group>
  );
}

function Tree({ x, z, scale, kind, fruit, seed, store }: (typeof TREES)[number] & { seed: number; store: GameStore }) {
  const ref = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const fade = useRef(1);
  useFrame(({ clock }, delta) => {
    if (ref.current) ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + seed) * 0.025;
    // Trees standing between the camera and the player turn see-through.
    const dz = z - store.pos.z;
    const blocking = store.started && dz > 0.5 && dz < 13 && Math.abs(x - store.pos.x) < 2.6 + dz * 0.12;
    const want = blocking ? 0.28 : 1;
    if (Math.abs(fade.current - want) < 0.01) return;
    fade.current += (want - fade.current) * (1 - Math.exp(-8 * Math.min(delta, 0.05)));
    root.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (!m) return;
      m.transparent = fade.current < 0.99;
      m.opacity = fade.current;
      m.depthWrite = fade.current > 0.99;
    });
  });
  const leaf = kind === 'blossom' ? '#f4a7c0' : kind === 'pine' ? '#4f8a5b' : seed % 2 ? '#6fa84a' : '#7fb851';
  const leaf2 = kind === 'blossom' ? '#f8c3d4' : kind === 'pine' ? '#5d9c67' : '#8cc45b';
  return (
    <group ref={root} position={[x, 0, z]} scale={scale} rotation-y={seed}>
      <mesh position-y={0.8} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1.6, 7]} />
        <meshLambertMaterial color="#8b5a3c" />
      </mesh>
      <group ref={ref} position-y={1.5}>
        {kind === 'pine' ? (
          <>
            <mesh position-y={0.6} castShadow>
              <coneGeometry args={[1.25, 1.6, 7]} />
              <meshLambertMaterial color={leaf} flatShading />
            </mesh>
            <mesh position-y={1.45} castShadow>
              <coneGeometry args={[0.9, 1.3, 7]} />
              <meshLambertMaterial color={leaf2} flatShading />
            </mesh>
          </>
        ) : (
          <>
            <mesh position-y={0.7} castShadow>
              <icosahedronGeometry args={[1.25, 0]} />
              <meshLambertMaterial color={leaf} flatShading />
            </mesh>
            <mesh position={[0.55, 1.15, 0.2]} castShadow>
              <icosahedronGeometry args={[0.8, 0]} />
              <meshLambertMaterial color={leaf2} flatShading />
            </mesh>
            <mesh position={[-0.6, 1.0, -0.2]} castShadow>
              <icosahedronGeometry args={[0.75, 0]} />
              <meshLambertMaterial color={leaf2} flatShading />
            </mesh>
            {fruit &&
              [
                [0.9, 0.5, 0.6],
                [-0.8, 0.7, 0.7],
                [0.2, 0.4, 1.15],
              ].map((p, j) => (
                <mesh key={j} position={p as [number, number, number]}>
                  <sphereGeometry args={[0.16, 10, 8]} />
                  <meshLambertMaterial color={kind === 'blossom' ? '#ff7b9c' : '#ff9a3c'} />
                </mesh>
              ))}
          </>
        )}
      </group>
    </group>
  );
}

function Flowers() {
  const heads = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    const rnd = mulberry32(3);
    const out: { x: number; z: number; c: string }[] = [];
    const colors = ['#ffffff', '#ffd166', '#ff8fab', '#f07167', '#cdb4db', '#fff3b0'];
    let guard = 0;
    while (out.length < 90 && guard++ < 3000) {
      // Flowers grow in little clusters.
      const a = rnd() * Math.PI * 2;
      const r = 4 + Math.sqrt(rnd()) * 20;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const c = colors[Math.floor(rnd() * colors.length)];
      for (let k = 0; k < 5; k++) {
        const x = cx + (rnd() - 0.5) * 1.6;
        const z = cz + (rnd() - 0.5) * 1.6;
        if (!blocksGrass(x, z)) out.push({ x, z, c });
      }
    }
    return out;
  }, []);
  useEffect(() => {
    const m = heads.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    data.forEach((f, i) => {
      o.position.set(f.x, 0.42, f.z);
      o.scale.setScalar(0.9 + (i % 3) * 0.15);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, col.set(f.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [data]);
  return (
    <instancedMesh ref={heads} args={[undefined, undefined, data.length]}>
      <icosahedronGeometry args={[0.1, 0]} />
      <meshLambertMaterial emissive="#ffffff" emissiveIntensity={0.08} />
    </instancedMesh>
  );
}

function Rocks() {
  const rocks = useMemo(() => {
    const rnd = mulberry32(11);
    return Array.from({ length: 14 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = ISLAND_R + 0.6 + rnd() * 2.2;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.35 + rnd() * 0.6, rot: rnd() * 6 };
    });
  }, []);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, -0.3, r.z]} scale={r.s} rotation={[r.rot, r.rot * 2, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshLambertMaterial color="#b9a7b5" flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Dock() {
  return (
    <group position={[5, -0.25, ISLAND_R + 1]}>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[0, 0, i * 0.62]} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.12, 0.54]} />
          <meshLambertMaterial color={i % 2 ? '#b07d52' : '#a8744a'} />
        </mesh>
      ))}
      {[0, 2.4, 4.8].map((z) =>
        [-0.85, 0.85].map((x) => (
          <mesh key={`${x}${z}`} position={[x, -0.2, z]}>
            <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
            <meshLambertMaterial color="#7a5234" />
          </mesh>
        )),
      )}
      <group position={[0.85, 0.1, 5]}>
        <mesh position-y={0.55}>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 6]} />
          <meshLambertMaterial color="#5b4636" />
        </mesh>
        <mesh position-y={1.18}>
          <sphereGeometry args={[0.15, 12, 10]} />
          <meshBasicMaterial color="#ffe3a3" />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------- Buildings & props ---------------- */

function House({ x, z, wall, roof, door, label, scale = 1 }: { x: number; z: number; wall: string; roof: string; door: string; label: string; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position-y={1.2} castShadow receiveShadow>
        <boxGeometry args={[3.6, 2.4, 3.2]} />
        <meshLambertMaterial color={wall} />
      </mesh>
      <mesh position-y={3.2} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[3.2, 1.8, 4]} />
        <meshLambertMaterial color={roof} flatShading />
      </mesh>
      <mesh position={[1, 3.4, -0.4]} castShadow>
        <boxGeometry args={[0.45, 1.1, 0.45]} />
        <meshLambertMaterial color="#a0624a" />
      </mesh>
      <mesh position={[0, 0.75, 1.61]}>
        <boxGeometry args={[0.85, 1.5, 0.05]} />
        <meshLambertMaterial color={door} />
      </mesh>
      <mesh position={[0.22, 0.75, 1.65]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshLambertMaterial color="#f2cf5b" />
      </mesh>
      {[-1.15, 1.15].map((wx) => (
        <group key={wx} position={[wx, 1.45, 1.61]}>
          <mesh>
            <boxGeometry args={[0.8, 0.7, 0.05]} />
            <meshBasicMaterial color="#ffd98a" />
          </mesh>
          <mesh position-z={0.03}>
            <boxGeometry args={[0.06, 0.7, 0.03]} />
            <meshLambertMaterial color="#fff8e7" />
          </mesh>
          <mesh position-z={0.03}>
            <boxGeometry args={[0.8, 0.06, 0.03]} />
            <meshLambertMaterial color="#fff8e7" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.03, 2.3]} receiveShadow>
        <boxGeometry args={[1.4, 0.06, 1]} />
        <meshLambertMaterial color="#c79a6b" />
      </mesh>
      <Label y={4.7}>{label}</Label>
    </group>
  );
}

function ProjectBoard() {
  return (
    <group position={[PLAZA.x, 0, PLAZA.z]}>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 1.05, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.1, 1.8, 6]} />
          <meshLambertMaterial color="#7a5234" />
        </mesh>
      ))}
      <mesh position={[0, 1.35, 0]} castShadow>
        <boxGeometry args={[2.4, 1.2, 0.14]} />
        <meshLambertMaterial color="#c8966a" />
      </mesh>
      <mesh position={[0, 2.03, 0]} castShadow>
        <boxGeometry args={[2.7, 0.16, 0.36]} />
        <meshLambertMaterial color="#d9695f" />
      </mesh>
      {[
        [-0.6, 1.5, '#fff8e7'],
        [0.35, 1.25, '#ffe3a3'],
        [-0.2, 1.1, '#cfe8ff'],
        [0.7, 1.55, '#ffd0dc'],
      ].map(([px, py, c], i) => (
        <mesh key={i} position={[px as number, py as number, 0.08]} rotation-z={(i - 1.5) * 0.08}>
          <boxGeometry args={[0.55, 0.4, 0.02]} />
          <meshLambertMaterial color={c as string} />
        </mesh>
      ))}
      <Label y={2.7} tone="orange">
        📌 Proyectos
      </Label>
    </group>
  );
}

function ProjectSign({ x, z, rot, color, title, soon, store }: { x: number; z: number; rot: number; color: string; title: string; soon: boolean; store: GameStore }) {
  const lantern = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement | null>(null);
  useFrame(({ clock }) => {
    if (lantern.current) lantern.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2 + x) * 0.08);
    // Signs stand close together, so only the one you're next to shows its name.
    if (label.current) {
      const near = (store.pos.x - x) ** 2 + (store.pos.z - z) ** 2 < 2.2 ** 2;
      label.current.style.opacity = near ? '1' : '0';
    }
  });
  return (
    <group position={[x, 0, z]} rotation-y={rot}>
      <mesh position-y={0.6} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 1.2, 6]} />
        <meshLambertMaterial color="#7a5234" />
      </mesh>
      <mesh position-y={1.15} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.1]} />
        <meshLambertMaterial color="#d7ab7c" />
      </mesh>
      <mesh position={[0, 1.15, 0.06]}>
        <circleGeometry args={[0.22, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={lantern} position-y={1.68}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshBasicMaterial color={soon ? '#cfc6ff' : '#ffe3a3'} />
      </mesh>
      <Label y={2.15} size={14} innerRef={label}>
        {title}
      </Label>
    </group>
  );
}

function Garden() {
  return (
    <group>
      {GARDEN_PLOTS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position-y={0.1} receiveShadow>
            <boxGeometry args={[2.3, 0.2, 2.3]} />
            <meshLambertMaterial color="#7a5234" />
          </mesh>
          {[-0.6, 0, 0.6].map((ox) =>
            [-0.6, 0.6].map((oz) => <Crop key={`${ox}${oz}`} kind={p.kind} x={ox} z={oz} />),
          )}
        </group>
      ))}
      {/* Little picket fence around the garden. */}
      {Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        if (Math.abs(a - Math.PI / 2) < 0.3) return null;
        return (
          <mesh key={i} position={[GARDEN.x + Math.cos(a) * 3.5, 0.3, GARDEN.z + Math.sin(a) * 3.5]} castShadow>
            <boxGeometry args={[0.12, 0.6, 0.12]} />
            <meshLambertMaterial color="#fff8e7" />
          </mesh>
        );
      })}
      <group position={[GARDEN.x, 0, GARDEN.z]}>
        <Label y={2.6} tone="orange">
          🌻 Huerto de habilidades
        </Label>
      </group>
    </group>
  );
}

function Crop({ kind, x, z }: { kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage'; x: number; z: number }) {
  if (kind === 'sunflower')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.55}>
          <cylinderGeometry args={[0.03, 0.04, 1.1, 5]} />
          <meshLambertMaterial color="#5f9447" />
        </mesh>
        <mesh position={[0, 1.12, 0.05]} rotation-x={0.3}>
          <cylinderGeometry args={[0.24, 0.24, 0.05, 12]} />
          <meshLambertMaterial color="#ffc93c" />
        </mesh>
        <mesh position={[0, 1.13, 0.09]} rotation-x={0.3}>
          <cylinderGeometry args={[0.11, 0.11, 0.06, 10]} />
          <meshLambertMaterial color="#7a4a24" />
        </mesh>
      </group>
    );
  if (kind === 'tomato')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.3}>
          <icosahedronGeometry args={[0.3, 0]} />
          <meshLambertMaterial color="#5f9447" flatShading />
        </mesh>
        {[
          [0.18, 0.35, 0.15],
          [-0.15, 0.25, 0.2],
          [0.02, 0.5, -0.18],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshLambertMaterial color="#e5484d" />
          </mesh>
        ))}
      </group>
    );
  if (kind === 'carrot')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.08} rotation-x={Math.PI}>
          <coneGeometry args={[0.09, 0.3, 6]} />
          <meshLambertMaterial color="#f08a3c" />
        </mesh>
        <mesh position-y={0.3}>
          <coneGeometry args={[0.13, 0.35, 5]} />
          <meshLambertMaterial color="#6fb04d" flatShading />
        </mesh>
      </group>
    );
  return (
    <mesh position={[x, 0.38, z]} scale={[1, 0.8, 1]}>
      <icosahedronGeometry args={[0.26, 1]} />
      <meshLambertMaterial color="#9ed27a" flatShading />
    </mesh>
  );
}

function Mailbox() {
  const flag = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.z = -0.2 + Math.sin(clock.elapsedTime * 3) * 0.12;
  });
  return (
    <group position={[MAILBOX.x, 0, MAILBOX.z]} rotation-y={-0.5}>
      <mesh position-y={0.5} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 1, 6]} />
        <meshLambertMaterial color="#7a5234" />
      </mesh>
      <mesh position-y={1.1} castShadow>
        <boxGeometry args={[0.5, 0.45, 0.75]} />
        <meshLambertMaterial color="#e0584f" />
      </mesh>
      <mesh position-y={1.32} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.25, 0.25, 0.75, 14, 1, false, 0, Math.PI]} />
        <meshLambertMaterial color="#e0584f" side={THREE.DoubleSide} />
      </mesh>
      <group ref={flag} position={[0.27, 1.1, -0.1]}>
        <mesh position-y={0.25}>
          <boxGeometry args={[0.04, 0.5, 0.04]} />
          <meshLambertMaterial color="#5b4636" />
        </mesh>
        <mesh position={[0, 0.42, 0.12]}>
          <boxGeometry args={[0.03, 0.18, 0.22]} />
          <meshLambertMaterial color="#f2cf5b" />
        </mesh>
      </group>
      <Label y={2.1} tone="orange">
        ✉️ Buzón
      </Label>
    </group>
  );
}

function WelcomeSign() {
  return (
    <group position={[WELCOME.x, 0, WELCOME.z]} rotation-y={0.35}>
      <mesh position-y={0.55} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 1.1, 6]} />
        <meshLambertMaterial color="#7a5234" />
      </mesh>
      <mesh position-y={1.1} castShadow>
        <boxGeometry args={[1.2, 0.6, 0.1]} />
        <meshLambertMaterial color="#e8c393" />
      </mesh>
      <Label y={1.85}>👋 ¡Bienvenid@!</Label>
    </group>
  );
}

/* ---------------- Characters ---------------- */

type Look = {
  shirt: string;
  pants: string;
  skin: string;
  hat?: { color: string; band: string };
  hair?: string;
  glasses?: boolean;
};

type Anim = { phase: number; amt: number; swing: number };

function Villager({ look, anim, showTool = false }: { look: Look; anim: MutableRefObject<Anim>; showTool?: boolean }) {
  const body = useRef<THREE.Group>(null);
  const lf = useRef<THREE.Mesh>(null);
  const rf = useRef<THREE.Mesh>(null);
  const la = useRef<THREE.Group>(null);
  const ra = useRef<THREE.Group>(null);
  const tool = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const a = anim.current;
    const s = Math.sin(a.phase);
    if (body.current) {
      body.current.position.y = Math.abs(s) * 0.09 * a.amt;
      body.current.scale.y = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.012;
    }
    if (lf.current) lf.current.position.z = s * 0.2 * a.amt;
    if (rf.current) rf.current.position.z = -s * 0.2 * a.amt;
    if (la.current) la.current.rotation.x = -s * 0.9 * a.amt;
    if (ra.current) {
      if (a.swing > 0) {
        const t = 1 - a.swing / 0.32;
        ra.current.rotation.x = -1.3 + Math.sin(t * Math.PI) * 0.4;
        ra.current.rotation.z = 0.9 - t * 1.8;
      } else {
        ra.current.rotation.x = s * 0.9 * a.amt;
        ra.current.rotation.z = 0;
      }
    }
    if (tool.current) tool.current.visible = showTool && a.swing > 0;
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[0.42, 20]} />
        <meshBasicMaterial color="#3b2a22" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh ref={lf} position={[-0.14, 0.09, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshLambertMaterial color="#6b4a3a" />
      </mesh>
      <mesh ref={rf} position={[0.14, 0.09, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshLambertMaterial color="#6b4a3a" />
      </mesh>
      <group ref={body}>
        <mesh position-y={0.3}>
          <cylinderGeometry args={[0.2, 0.24, 0.3, 12]} />
          <meshLambertMaterial color={look.pants} />
        </mesh>
        <mesh position-y={0.62} castShadow>
          <capsuleGeometry args={[0.25, 0.22, 6, 14]} />
          <meshLambertMaterial color={look.shirt} />
        </mesh>
        <group ref={la} position={[-0.3, 0.76, 0]}>
          <mesh position-y={-0.17} rotation-z={-0.15}>
            <capsuleGeometry args={[0.075, 0.2, 4, 8]} />
            <meshLambertMaterial color={look.shirt} />
          </mesh>
          <mesh position={[-0.04, -0.36, 0]}>
            <sphereGeometry args={[0.075, 8, 6]} />
            <meshLambertMaterial color={look.skin} />
          </mesh>
        </group>
        <group ref={ra} position={[0.3, 0.76, 0]}>
          <mesh position-y={-0.17} rotation-z={0.15}>
            <capsuleGeometry args={[0.075, 0.2, 4, 8]} />
            <meshLambertMaterial color={look.shirt} />
          </mesh>
          <mesh position={[0.04, -0.36, 0]}>
            <sphereGeometry args={[0.075, 8, 6]} />
            <meshLambertMaterial color={look.skin} />
          </mesh>
          <group ref={tool} position={[0.04, -0.38, 0.05]} visible={false}>
            <mesh position-z={0.18} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.025, 0.025, 0.42, 6]} />
              <meshLambertMaterial color="#a0624a" />
            </mesh>
            <mesh position={[0.12, 0, 0.4]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.14, 0.025, 6, 14, Math.PI * 1.1]} />
              <meshLambertMaterial color="#e6ecf2" emissive="#ffffff" emissiveIntensity={0.2} />
            </mesh>
          </group>
        </group>
        <group position-y={1.17}>
          <mesh castShadow>
            <sphereGeometry args={[0.4, 24, 18]} />
            <meshLambertMaterial color={look.skin} />
          </mesh>
          {[-1, 1].map((sx) => (
            <group key={sx}>
              <mesh position={[sx * 0.14, 0.02, 0.36]} scale={[1, 1.25, 0.5]}>
                <sphereGeometry args={[0.05, 10, 8]} />
                <meshBasicMaterial color="#2b1d16" />
              </mesh>
              <mesh position={[sx * 0.25, -0.1, 0.29]} scale={[1.3, 0.8, 0.4]}>
                <sphereGeometry args={[0.055, 10, 8]} />
                <meshBasicMaterial color="#ff9a9a" transparent opacity={0.7} />
              </mesh>
              {look.glasses && (
                <mesh position={[sx * 0.14, 0.02, 0.39]}>
                  <torusGeometry args={[0.095, 0.014, 6, 18]} />
                  <meshBasicMaterial color="#2b2b2b" />
                </mesh>
              )}
            </group>
          ))}
          {look.glasses && (
            <mesh position={[0, 0.04, 0.41]}>
              <boxGeometry args={[0.1, 0.018, 0.018]} />
              <meshBasicMaterial color="#2b2b2b" />
            </mesh>
          )}
          <mesh position={[0, -0.14, 0.37]} scale={[1.4, 0.6, 0.5]}>
            <sphereGeometry args={[0.035, 8, 6]} />
            <meshBasicMaterial color="#a8514a" />
          </mesh>
          {look.hair && (
            <>
              <mesh position={[0, 0.1, -0.06]} scale={[1.06, 0.9, 1.02]} castShadow>
                <sphereGeometry args={[0.41, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
                <meshLambertMaterial color={look.hair} />
              </mesh>
              <mesh position={[0.1, 0.27, 0.26]} rotation={[0.9, 0, -0.4]}>
                <capsuleGeometry args={[0.08, 0.18, 4, 8]} />
                <meshLambertMaterial color={look.hair} />
              </mesh>
            </>
          )}
          {look.hat && (
            <group position-y={0.24}>
              <mesh castShadow>
                <cylinderGeometry args={[0.62, 0.62, 0.04, 24]} />
                <meshLambertMaterial color={look.hat.color} />
              </mesh>
              <mesh position-y={0.14}>
                <cylinderGeometry args={[0.28, 0.33, 0.26, 18]} />
                <meshLambertMaterial color={look.hat.color} />
              </mesh>
              <mesh position-y={0.06}>
                <cylinderGeometry args={[0.335, 0.335, 0.08, 18]} />
                <meshLambertMaterial color={look.hat.band} />
              </mesh>
            </group>
          )}
        </group>
      </group>
    </group>
  );
}

const PLAYER_LOOK: Look = { shirt: '#7cc6e8', pants: '#5a7bb5', skin: '#ffd9b8', hat: { color: '#f2cf7a', band: '#e76f51' } };
const DANIEL_LOOK: Look = { shirt: '#f28c6b', pants: '#4b5563', skin: '#f1c7a1', hair: '#3b2a22', glasses: true };

function DanielNpc({ store }: { store: GameStore }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef<Anim>({ phase: 0, amt: 0, swing: 0 });
  const bubble = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const dx = store.pos.x - DANIEL.x;
    const dz = store.pos.z - DANIEL.z;
    const near = dx * dx + dz * dz < 49;
    const want = near ? Math.atan2(dx, dz) : 0.35 + Math.sin(clock.elapsedTime * 0.3) * 0.5;
    let diff = want - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * (1 - Math.exp(-5 * dt));
    if (bubble.current) bubble.current.position.y = 1.95 + Math.sin(clock.elapsedTime * 3) * 0.06;
  });
  return (
    <group position={[DANIEL.x, 0, DANIEL.z]}>
      <group ref={ref}>
        <Villager look={DANIEL_LOOK} anim={anim} />
      </group>
      <group ref={bubble} position-y={1.95}>
        <Label y={0} tone="orange">
          💬 Daniel
        </Label>
      </group>
    </group>
  );
}

function Player({ store, events }: { store: GameStore; events: MutableRefObject<GameEvents> }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef<Anim>({ phase: 0, amt: 0, swing: 0 });
  const dir = useRef(new THREE.Vector2(0, 1));
  const stuck = useRef({ t: 0, d: Infinity });
  const nearCheck = useRef(0);
  const lastStep = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = store;
    const k = s.keys;
    let ix = 0;
    let iz = 0;
    if (!s.frozen) {
      if (k.has('w') || k.has('arrowup')) iz -= 1;
      if (k.has('s') || k.has('arrowdown')) iz += 1;
      if (k.has('a') || k.has('arrowleft')) ix -= 1;
      if (k.has('d') || k.has('arrowright')) ix += 1;
      ix += s.joy.x;
      iz += s.joy.z;
    }
    let len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
      len = 1;
    }
    let want = 0;
    if (len > 0.08) {
      s.target = null;
      s.targetId = null;
      const run = k.has('shift') || Math.hypot(s.joy.x, s.joy.z) > 0.92;
      dir.current.set(ix, iz).normalize();
      want = len * (run ? 6.4 : 3.8);
    } else if (s.target && !s.frozen) {
      const dx = s.target.x - s.pos.x;
      const dz = s.target.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) {
        const id = s.targetId;
        s.target = null;
        s.targetId = null;
        if (id) events.current.onArrive(id);
      } else {
        dir.current.set(dx / d, dz / d);
        want = Math.min(5.2, d * 3 + 1.2);
        // Give up if something blocks the way for too long.
        if (d < stuck.current.d - 0.05) stuck.current = { t: 0, d };
        else if ((stuck.current.t += dt) > 1.2) {
          const id = s.targetId;
          s.target = null;
          s.targetId = null;
          stuck.current = { t: 0, d: Infinity };
          if (id && d < 3) events.current.onArrive(id);
        }
      }
    } else {
      stuck.current = { t: 0, d: Infinity };
    }

    s.speed += (want - s.speed) * (1 - Math.exp(-12 * dt));
    if (s.speed > 0.05) {
      s.pos.x += dir.current.x * s.speed * dt;
      s.pos.z += dir.current.y * s.speed * dt;
      resolveCollisions(s.pos);
    }
    if (want > 0) {
      const target = Math.atan2(dir.current.x, dir.current.y);
      let diff = target - s.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.facing += diff * (1 - Math.exp(-14 * dt));
    }

    const a = anim.current;
    a.amt += (Math.min(s.speed / 3.8, 1.3) - a.amt) * (1 - Math.exp(-10 * dt));
    a.phase += dt * (4 + s.speed * 2.2) * (a.amt > 0.05 ? 1 : 0);
    if (a.amt > 0.4 && Math.floor(a.phase / Math.PI) !== lastStep.current) {
      lastStep.current = Math.floor(a.phase / Math.PI);
      sfx.step();
    }

    // Cutting: hold Space / F or the on-screen scissors.
    a.swing = Math.max(0, a.swing - dt);
    const cutting = !s.frozen && (k.has(' ') || k.has('f') || s.cutHeld);
    if (cutting && a.swing <= 0) {
      a.swing = 0.32;
      const fx = s.pos.x + Math.sin(s.facing) * 0.95;
      const fz = s.pos.z + Math.cos(s.facing) * 0.95;
      const n = s.cutAt(fx, fz, 1.3);
      s.revealAt(fx, fz, 1.3);
      if (n > 0) {
        sfx.snip();
        events.current.onCut(n);
      }
    }

    if (ref.current) {
      ref.current.position.copy(s.pos);
      ref.current.rotation.y = s.facing;
    }

    if ((nearCheck.current += dt) > 0.1) {
      nearCheck.current = 0;
      let best: InteractableId | null = null;
      let bestD = Infinity;
      for (const it of INTERACTABLES) {
        const d = Math.hypot(it.x - s.pos.x, it.z - s.pos.z);
        if (d < it.radius && d < bestD) {
          best = it.id;
          bestD = d;
        }
      }
      if (best !== s.nearId) {
        s.nearId = best;
        events.current.onNear(best);
      }
    }
  });

  return (
    <group ref={ref} position={SPAWN.toArray()}>
      <Villager look={PLAYER_LOOK} anim={anim} showTool />
    </group>
  );
}

function CameraRig({ store }: { store: GameStore }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, -4));
  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookWant = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const portrait = size.width / size.height < 0.9;
    if (!store.started) {
      const t = clock.elapsedTime * 0.06;
      desired.set(Math.sin(t) * 34, 17, Math.cos(t) * 34);
      lookWant.set(0, 0, -3);
    } else {
      const k = portrait ? 1.5 : 1;
      desired.set(store.pos.x, store.pos.y + 6.3 * k, store.pos.z + 11.5 * k);
      lookWant.set(store.pos.x, store.pos.y + 1.2, store.pos.z - 6);
    }
    const f = 1 - Math.exp(-(store.started ? 3.2 : 1.2) * dt);
    camera.position.lerp(desired, f);
    look.current.lerp(lookWant, f);
    camera.lookAt(look.current);
  });
  return null;
}

/* ---------------- Grass (the star of the show) ---------------- */

const CUT_H = 0.14;
const REGROW_AFTER = 45;

function makeTuftGeometry() {
  const rnd = mulberry32(5);
  const pos: number[] = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd();
    const r = 0.05 + rnd() * 0.18;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const w = 0.07 + rnd() * 0.04;
    const h = 0.45 + rnd() * 0.35;
    const ang = rnd() * Math.PI;
    const ox = Math.cos(ang) * w;
    const oz = Math.sin(ang) * w;
    const lean = 0.08 + rnd() * 0.12;
    pos.push(cx - ox, 0, cz - oz, cx + ox, 0, cz + oz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Normals straight up: blades pick up the ground's lighting and look soft.
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

function Grass({ store, events: _events, quality }: { store: GameStore; events: MutableRefObject<GameEvents>; quality: 'high' | 'low' }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const bits = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const field = useMemo(() => {
    const rnd = mulberry32(21);
    const target = quality === 'high' ? 5200 : 3000;
    const xs: number[] = [];
    const zs: number[] = [];
    let guard = 0;
    while (xs.length < target && guard++ < target * 4) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (ISLAND_R - 0.6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (blocksGrass(x, z)) continue;
      xs.push(x);
      zs.push(z);
    }
    const n = xs.length;
    const rot = new Float32Array(n);
    const scale = new Float32Array(n);
    const h = new Float32Array(n).fill(1);
    const cutTime = new Float32Array(n);
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      rot[i] = rnd() * Math.PI * 2;
      scale[i] = 0.8 + rnd() * 0.55;
      const key = `${Math.floor(xs[i] / 2)},${Math.floor(zs[i] / 2)}`;
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    }
    return { n, xs, zs, rot, scale, h, cutTime, grid, growing: new Set<number>() };
  }, [quality]);

  const geo = useMemo(makeTuftGeometry, []);
  const mat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vH;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vH = position.y / 0.8;
          vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.7 + root.x * 0.45 + root.z * 0.3) * 0.5 + sin(uTime * 2.9 + root.x * 1.3) * 0.18;
          transformed.x += sway * 0.2 * position.y;
          transformed.z += sway * 0.1 * position.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.62, 1.18, clamp(vH, 0.0, 1.0));');
    };
    return m;
  }, [uniforms]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const writeMatrix = (i: number) => {
    const f = field;
    dummy.position.set(f.xs[i], 0, f.zs[i]);
    dummy.rotation.set(0, f.rot[i], 0);
    dummy.scale.set(f.scale[i], f.scale[i] * f.h[i], f.scale[i]);
    dummy.updateMatrix();
    mesh.current!.setMatrixAt(i, dummy.matrix);
  };

  const baseColors = useRef<THREE.Color[]>([]);
  const mown = useMemo(() => new THREE.Color('#c8e08a'), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const rnd = mulberry32(8);
    const palette = ['#7fb551', '#8cc05a', '#76ad4b', '#9bc963', '#a7c95c', '#6ea548'];
    baseColors.current = [];
    for (let i = 0; i < field.n; i++) {
      writeMatrix(i);
      const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
      baseColors.current.push(c);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  // Clippings that fly when you cut.
  const BITS = 180;
  const bitState = useMemo(
    () => ({ p: new Float32Array(BITS * 3), v: new Float32Array(BITS * 3), life: new Float32Array(BITS), rot: new Float32Array(BITS), next: 0 }),
    [],
  );
  const spawnBit = (x: number, z: number) => {
    const b = bitState;
    const i = b.next;
    b.next = (b.next + 1) % BITS;
    b.p[i * 3] = x;
    b.p[i * 3 + 1] = 0.35;
    b.p[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const sp = 0.8 + Math.random() * 1.8;
    b.v[i * 3] = Math.cos(a) * sp;
    b.v[i * 3 + 1] = 2.2 + Math.random() * 2.2;
    b.v[i * 3 + 2] = Math.sin(a) * sp;
    b.life[i] = 0.9 + Math.random() * 0.4;
    b.rot[i] = Math.random() * 6;
  };

  useEffect(() => {
    store.cutAt = (x, z, r) => {
      const f = field;
      let count = 0;
      const r2 = r * r;
      const now = performance.now() / 1000;
      const c0x = Math.floor((x - r) / 2);
      const c1x = Math.floor((x + r) / 2);
      const c0z = Math.floor((z - r) / 2);
      const c1z = Math.floor((z + r) / 2);
      for (let cx = c0x; cx <= c1x; cx++)
        for (let cz = c0z; cz <= c1z; cz++) {
          const cell = f.grid.get(`${cx},${cz}`);
          if (!cell) continue;
          for (const i of cell) {
            if (f.h[i] < 0.6) continue;
            if ((f.xs[i] - x) ** 2 + (f.zs[i] - z) ** 2 > r2) continue;
            f.h[i] = CUT_H;
            f.cutTime[i] = now;
            f.growing.add(i);
            writeMatrix(i);
            mesh.current!.setColorAt(i, mown);
            count++;
            if (count % 2 === 0) spawnBit(f.xs[i], f.zs[i]);
            spawnBit(f.xs[i], f.zs[i]);
          }
        }
      if (count) {
        mesh.current!.instanceMatrix.needsUpdate = true;
        mesh.current!.instanceColor!.needsUpdate = true;
      }
      return count;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, store]);

  useEffect(() => {
    store.grassTotal = field.n;
  }, [field, store]);

  const bitDummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    uniforms.uTime.value = clock.elapsedTime;
    const f = field;
    const now = performance.now() / 1000;
    let dirty = false;
    for (const i of f.growing) {
      if (now - f.cutTime[i] < REGROW_AFTER) continue;
      f.h[i] = Math.min(1, f.h[i] + dt * 0.2);
      writeMatrix(i);
      dirty = true;
      if (f.h[i] >= 1) {
        f.growing.delete(i);
        mesh.current!.setColorAt(i, baseColors.current[i]);
        mesh.current!.instanceColor!.needsUpdate = true;
      }
    }
    if (dirty) mesh.current!.instanceMatrix.needsUpdate = true;

    const b = bitState;
    const bm = bits.current;
    if (!bm) return;
    for (let i = 0; i < BITS; i++) {
      if (b.life[i] <= 0) {
        bitDummy.scale.setScalar(0);
      } else {
        b.life[i] -= dt;
        b.v[i * 3 + 1] -= 9 * dt;
        b.p[i * 3] += b.v[i * 3] * dt;
        b.p[i * 3 + 1] = Math.max(0.03, b.p[i * 3 + 1] + b.v[i * 3 + 1] * dt);
        b.p[i * 3 + 2] += b.v[i * 3 + 2] * dt;
        b.rot[i] += dt * 8;
        bitDummy.position.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]);
        bitDummy.rotation.set(b.rot[i], b.rot[i] * 0.7, 0);
        bitDummy.scale.setScalar(Math.min(1, b.life[i] * 2));
      }
      bitDummy.updateMatrix();
      bm.setMatrixAt(i, bitDummy.matrix);
    }
    bm.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, mat, field.n]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={bits} args={[undefined, undefined, BITS]} frustumCulled={false}>
        <planeGeometry args={[0.07, 0.16]} />
        <meshLambertMaterial color="#8cc05a" side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  );
}

/* ---------------- Hidden stars ---------------- */

function makeStarGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.16 : 0.36;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 2 });
  g.center();
  return g;
}

export const STAR_SPOTS = (() => {
  const rnd = mulberry32(2024);
  const out: { x: number; z: number }[] = [];
  let guard = 0;
  while (out.length < STAR_COUNT && guard++ < 5000) {
    const a = rnd() * Math.PI * 2;
    const r = 5 + Math.sqrt(rnd()) * 18.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (blocksGrass(x, z)) continue;
    if (COLLIDERS.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1.2) ** 2)) continue;
    if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 36)) continue;
    out.push({ x, z });
  }
  return out;
})();

function Stars({ store, events }: { store: GameStore; events: MutableRefObject<GameEvents> }) {
  const geo = useMemo(makeStarGeometry, []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const state = useRef(STAR_SPOTS.map(() => ({ revealed: false, taken: false, t: 0 })));

  useEffect(() => {
    store.revealAt = (x, z, r) => {
      state.current.forEach((s, i) => {
        if (s.revealed) return;
        const p = STAR_SPOTS[i];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + 0.5) ** 2) {
          s.revealed = true;
          sfx.reveal();
          events.current.onStarRevealed();
        }
      });
    };
  }, [store, events]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    state.current.forEach((s, i) => {
      const g = refs.current[i];
      if (!g) return;
      const p = STAR_SPOTS[i];
      if (s.taken) {
        s.t += dt;
        g.position.y += dt * 5;
        g.rotation.y += dt * 14;
        g.scale.setScalar(Math.max(0, 1 - s.t * 1.6));
        g.visible = s.t < 0.7;
        return;
      }
      if (!s.revealed) {
        // A faint glint peeking through the grass.
        const tw = Math.max(0, Math.sin(t * 2.2 + i * 1.7));
        g.scale.setScalar(0.25 + tw * 0.2);
        g.position.set(p.x, 0.32, p.z);
        g.rotation.y = t;
        return;
      }
      s.t = Math.min(1, s.t + dt * 3);
      g.scale.setScalar(0.45 + s.t * 0.55);
      g.position.set(p.x, 0.75 + Math.sin(t * 2.5 + i) * 0.12, p.z);
      g.rotation.y = t * 2;
      if ((store.pos.x - p.x) ** 2 + (store.pos.z - p.z) ** 2 < 1.1) {
        s.taken = true;
        s.t = 0;
        sfx.star();
        events.current.onStar(i);
      }
    });
  });

  return (
    <group>
      {STAR_SPOTS.map((p, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} position={[p.x, 0.3, p.z]}>
          <mesh geometry={geo} castShadow>
            <meshLambertMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
