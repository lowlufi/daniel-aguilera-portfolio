import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { EffectComposer, HueSaturation, N8AO, SMAA, TiltShift, Vignette } from '@react-three/postprocessing';
import { KernelSize } from 'postprocessing';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LabelProjector } from './labels';
import { Dui } from './Dui';
import { onThunder, sfx } from './audio';
import { atmo, stepAtmosphere, WEATHER_CONFIG, type WeatherId } from './weather';
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
  STATION,
  STAR_COUNT,
  TREES,
  WELCOME,
  WORKSHOP,
  blocksGrass,
  mulberry32,
  resolveCollisions,
  groundHeight,
  type InteractableId,
} from './world';

type SceneProps = {
  store: GameStore;
  events: MutableRefObject<GameEvents>;
  quality: 'high' | 'low';
  // Drops to false when the frame rate struggles (adaptive quality).
  rich: boolean;
  onWalkTo: (id: InteractableId) => void;
  weather: WeatherId;
  reduceMotion: boolean;
};

export default function Scene({ store, events, quality, rich, onWalkTo, weather, reduceMotion }: SceneProps) {
  const { scene, gl } = useThree();
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);

  // Snap to the chosen weather on the first frame, blend on later changes.
  useMemo(() => {
    atmo.target = weather;
    stepAtmosphere(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    atmo.target = weather;
  }, [weather]);

  // A soft studio environment gives every material the glossy "toy" highlights.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.fog = new THREE.Fog('#f9b48d', 42, 125);
    return () => {
      scene.fog = null;
      document.body.style.cursor = '';
    };
  }, [scene]);

  useEffect(() => {
    const timers: number[] = [];
    onThunder((delay) => timers.push(window.setTimeout(() => (atmo.flash = 1), delay * 1000)));
    return () => {
      onThunder(null);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    stepAtmosphere(1 - Math.exp(-1.4 * dt));
    atmo.flash = Math.max(0, atmo.flash - dt * 2.2);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(atmo.fog);
      fog.near = atmo.fogNear;
      fog.far = atmo.fogFar;
    }
    if (hemi.current) {
      hemi.current.color.copy(atmo.hemiSky);
      hemi.current.groundColor.copy(atmo.hemiGround);
      hemi.current.intensity = atmo.hemi + atmo.flash * 1.4;
    }
    if (sun.current) {
      sun.current.color.copy(atmo.lightColor);
      sun.current.intensity = atmo.light;
      sun.current.position.copy(atmo.lightPos);
    }
    if (amb.current) {
      amb.current.color.copy(atmo.ambientColor);
      amb.current.intensity = atmo.ambient;
    }
    WINDOW_MAT.color.copy(atmo.windows);
    scene.environmentIntensity = atmo.env;
  });

  const fireflies = WEATHER_CONFIG[weather].fireflies;

  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow={quality === 'high'}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <ambientLight ref={amb} />

      <Sky />
      <Clouds reduceMotion={reduceMotion} />
      <Ocean />
      <Island store={store} />
      <PathStones />
      <Trees store={store} />
      <Flowers />
      <Rocks />
      <Dock />

      <House x={HOUSE.x} z={HOUSE.z} wall="#fbe8c8" roof="#d9695f" door="#8a5a3b" />
      <House x={WORKSHOP.x} z={WORKSHOP.z} wall="#f3e2c7" roof="#6f9fd8" door="#6b4a3a" scale={1.1} />

      <Clickable id="board" onWalkTo={onWalkTo}>
        <ProjectBoard />
      </Clickable>
      {PROJECT_SIGNS.map((s) => (
        <Clickable key={s.project.id} id={`project:${s.project.id}`} onWalkTo={onWalkTo}>
          <ProjectSign x={s.x} z={s.z} rot={s.rot} color={s.color} soon={!!s.project.comingSoon} />
        </Clickable>
      ))}
      <Clickable id="garden" onWalkTo={onWalkTo}>
        <Garden store={store} />
      </Clickable>
      <Clickable id="station" onWalkTo={onWalkTo}>
        <WeatherStation store={store} />
      </Clickable>
      <Bursts store={store} />
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
      <Dui
        store={store}
        reduceMotion={reduceMotion}
        onPet={(x, z) => {
          sfx.purr();
          if (Math.random() < 0.35) sfx.meow();
          store.burst('hearts', x, z);
          events.current.onPet?.();
        }}
      />
      <CameraRig store={store} reduceMotion={reduceMotion} />
      <LabelProjector store={store} />

      <Rain store={store} count={quality === 'high' ? 1600 : 900} />
      <Snow store={store} count={quality === 'high' ? 1400 : 800} />
      <MistBanks store={store} count={quality === 'high' ? 40 : 22} />
      <HorizonClouds />
      <Effects quality={quality} rich={rich} />
      {fireflies > 0 && (
        <Sparkles
          count={quality === 'high' ? 70 : 35}
          scale={[46, 3.5, 46]}
          position={[0, 1.8, -2]}
          size={3.2}
          speed={reduceMotion ? 0 : 0.25}
          color="#ffe6a0"
          opacity={fireflies}
          noise={1.2}
        />
      )}
    </>
  );
}

const WINDOW_MAT = new THREE.MeshBasicMaterial({ color: '#ffd98a' });

// Link's Awakening-style finish: miniature tilt-shift, soft glow, a touch more color.
function Effects({ quality, rich }: { quality: 'high' | 'low'; rich: boolean }) {
  if (quality === 'low') {
    return (
      <EffectComposer multisampling={0}>
        <SMAA />
        <TiltShift offset={-0.1} focusArea={0.5} feather={0.32} kernelSize={KernelSize.SMALL} />
        <HueSaturation saturation={0.12} />
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>
    );
  }
  if (!rich) {
    return (
      <EffectComposer multisampling={4}>
        <TiltShift offset={-0.1} focusArea={0.45} feather={0.32} kernelSize={KernelSize.MEDIUM} />
        <HueSaturation saturation={0.12} />
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>
    );
  }
  // Soft ambient occlusion grounds every object like a real miniature.
  return (
    <EffectComposer multisampling={4}>
      <N8AO halfRes quality="medium" aoRadius={1.4} intensity={2.4} distanceFalloff={0.7} color="#2d2140" />
      <TiltShift offset={-0.1} focusArea={0.45} feather={0.32} kernelSize={KernelSize.MEDIUM} />
      <HueSaturation saturation={0.12} />
      <Vignette offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}

function Clickable({ id, onWalkTo, children }: { id: InteractableId; onWalkTo: (id: InteractableId) => void; children: ReactNode }) {
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 6) return; // that was a camera drag
        onWalkTo(id);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      {children}
    </group>
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
        uniforms: {
          uTop: { value: atmo.sky[0] },
          uMid: { value: atmo.sky[1] },
          uLow: { value: atmo.sky[2] },
          uHor: { value: atmo.sky[3] },
          uBelow: { value: atmo.sky[4] },
          uSun: { value: atmo.sunDir },
          uSunColor: { value: atmo.sunColor },
          uSunAmt: { value: 0 },
          uStars: { value: 0 },
          uFlash: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uMid, uLow, uHor, uBelow, uSun, uSunColor;
          uniform float uSunAmt, uStars, uFlash, uTime;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col;
            if (h < 0.0) col = mix(uHor, uBelow, clamp(-h * 4.0, 0.0, 1.0));
            else if (h < 0.09) col = mix(uHor, uLow, h / 0.09);
            else if (h < 0.36) col = mix(uLow, uMid, (h - 0.09) / 0.27);
            else col = mix(uMid, uTop, clamp((h - 0.36) / 0.5, 0.0, 1.0));
            if (uStars > 0.01) {
              vec3 p = d * 180.0;
              vec3 cell = floor(p);
              float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
              float s = step(0.986, r) * smoothstep(0.03, 0.25, h) * smoothstep(0.42, 0.08, length(fract(p) - 0.5));
              col += vec3(s * (0.55 + 0.45 * sin(uTime * 2.3 + r * 60.0)) * uStars);
            }
            float sd = max(dot(d, normalize(uSun)), 0.0);
            col += uSunColor * pow(sd, 32.0) * 0.45 * uSunAmt;
            col += uSunColor * pow(sd, 9.0) * 0.1 * uSunAmt;
            col = mix(col, uSunColor * 1.05, smoothstep(0.9983, 0.9991, sd) * uSunAmt);
            col += vec3(0.9, 0.93, 1.0) * uFlash * 0.45;
            // Colors above are authored in display (sRGB) space; the effect
            // composer expects linear output and encodes it at the end.
            gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
          }`,
      }),
    [],
  );
  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    material.uniforms.uSunAmt.value = atmo.sunAmt;
    material.uniforms.uStars.value = atmo.stars;
    material.uniforms.uFlash.value = atmo.flash;
    material.uniforms.uTime.value = clock.elapsedTime;
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
const PUFF_COUNT = CLOUDS.reduce((n, c) => n + c.puffs.length, 0);

// All cloud puffs share one instanced mesh: one draw call instead of ~110.
function Clouds({ reduceMotion }: { reduceMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ fog: false }), []);
  const offsets = useRef(CLOUDS.map((c) => c.x));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, delta) => {
    const m = ref.current;
    if (!m) return;
    mat.color.copy(atmo.cloud);
    mat.emissive.copy(atmo.cloudGlow);
    mat.emissiveIntensity = atmo.cloudGlowAmt;
    const dt = reduceMotion ? 0 : Math.min(delta, 0.05);
    let i = 0;
    CLOUDS.forEach((c, ci) => {
      let x = (offsets.current[ci] += c.speed * dt);
      if (x > 170) x = offsets.current[ci] = -170;
      for (const p of c.puffs) {
        dummy.position.set(x + p.x * c.scale, c.y + p.y * c.scale, c.z + p.z * c.scale);
        dummy.scale.set(p.r * c.scale, p.r * 0.8 * c.scale, p.r * c.scale);
        dummy.updateMatrix();
        m.setMatrixAt(i++, dummy.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, mat, PUFF_COUNT]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 2]} />
    </instancedMesh>
  );
}

function Ocean() {
  const glitter = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uAmt: { value: 1 }, uColor: { value: atmo.glitterColor } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uAmt;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float w = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float s = sin(vUv.y * 420.0 - uTime * 1.6 + sin(vUv.x * 30.0 + uTime) * 2.5);
            float a = smoothstep(0.82, 1.0, s) * w * w * smoothstep(0.0, 0.08, vUv.y) * (1.0 - vUv.y * 0.6);
            gl_FragColor = vec4(pow(uColor, vec3(2.2)), a * 0.75 * uAmt);
          }`,
      }),
    [],
  );
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const glint = useRef<THREE.Group>(null);
  const foam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    glitter.uniforms.uTime.value = clock.elapsedTime;
    glitter.uniforms.uAmt.value = atmo.glitter;
    if (glint.current) {
      glint.current.rotation.y = Math.atan2(atmo.sunDir.x, atmo.sunDir.z);
      glint.current.visible = atmo.glitter > 0.02;
    }
    if (water.current) {
      water.current.color.copy(atmo.water);
      water.current.emissive.copy(atmo.waterGlow);
    }
    if (foam.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 0.9) * 0.012;
      foam.current.scale.set(s, s, 1);
    }
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.55} receiveShadow>
        <circleGeometry args={[420, 48]} />
        <meshStandardMaterial roughness={0.55} ref={water} emissiveIntensity={0.18} />
      </mesh>
      <group ref={glint}>
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

/* ---------------- Weather particles ---------------- */

function Rain({ store, count }: { store: GameStore; count: number }) {
  const ref = useRef<THREE.LineSegments>(null);
  const { geo, speed } = useMemo(() => {
    const pos = new Float32Array(count * 6);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 46 - 23;
      const y = Math.random() * 20;
      const z = Math.random() * 46 - 23;
      pos.set([x, y, z, x + 0.05, y + 0.6, z], i * 6);
      speed[i] = 17 + Math.random() * 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, speed };
  }, [count]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#dfe8f2', transparent: true, opacity: 0, depthWrite: false }), []);
  useFrame((_, delta) => {
    const l = ref.current;
    if (!l) return;
    l.visible = atmo.rain > 0.02;
    if (!l.visible) return;
    mat.opacity = 0.55 * atmo.rain;
    l.position.set(store.pos.x, 0, store.pos.z - 4);
    const dt = Math.min(delta, 0.05);
    const p = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      let y = p[o + 1] - speed[i] * dt;
      let x = p[o];
      let z = p[o + 2];
      if (y < 0) {
        y = 17 + Math.random() * 4;
        x = Math.random() * 46 - 23;
        z = Math.random() * 46 - 23;
      }
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
      p[o + 3] = x + 0.05;
      p[o + 4] = y + 0.6;
      p[o + 5] = z;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} visible={false} />;
}

function Snow({ store, count }: { store: GameStore; count: number }) {
  const ref = useRef<THREE.Points>(null);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }, []);
  const { geo, speed, phase } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random() * 46 - 23, Math.random() * 18, Math.random() * 46 - 23], i * 3);
      speed[i] = 0.8 + Math.random() * 0.9;
      phase[i] = Math.random() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, speed, phase };
  }, [count]);
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 0.3, map: tex, transparent: true, opacity: 0, depthWrite: false }), [tex]);
  useFrame(({ clock }, delta) => {
    const pts = ref.current;
    if (!pts) return;
    pts.visible = atmo.snow > 0.02;
    if (!pts.visible) return;
    mat.opacity = atmo.snow;
    pts.position.set(store.pos.x, 0, store.pos.z - 4);
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const p = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      p[o] += Math.sin(t * 0.7 + phase[i]) * 0.5 * dt;
      p[o + 1] -= speed[i] * dt;
      if (p[o + 1] < 0) {
        p[o] = Math.random() * 46 - 23;
        p[o + 1] = 16 + Math.random() * 3;
        p[o + 2] = Math.random() * 46 - 23;
      }
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} visible={false} />;
}

// Soft sprite texture shared by mist banks and the cloud sea.
function useSoftTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

// Low fog banks drifting over the grass (strongest in the "niebla" weather).
function MistBanks({ store, count }: { store: GameStore; count: number }) {
  const tex = useSoftTexture();
  const group = useRef<THREE.Group>(null);
  const puffs = useMemo(() => {
    const rnd = mulberry32(77);
    return Array.from({ length: count }, () => ({
      x: (rnd() - 0.5) * 60,
      z: (rnd() - 0.5) * 60,
      y: 0.6 + rnd() * 1.8,
      s: 7 + rnd() * 9,
      speed: 0.3 + rnd() * 0.5,
      phase: rnd() * 6.28,
    }));
  }, [count]);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: false }), [tex]);
  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    g.visible = atmo.mist > 0.02;
    if (!g.visible) return;
    mat.opacity = 0.32 * atmo.mist;
    mat.color.copy(atmo.fog);
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    g.children.forEach((sp, i) => {
      const p = puffs[i];
      p.x += p.speed * dt;
      // Keep the banks wrapped around the player so the mist never runs out.
      if (p.x - store.pos.x > 30) p.x -= 60;
      if (p.x - store.pos.x < -30) p.x += 60;
      if (p.z - store.pos.z > 30) p.z -= 60;
      if (p.z - store.pos.z < -30) p.z += 60;
      sp.position.set(p.x, p.y + Math.sin(t * 0.3 + p.phase) * 0.3, p.z);
    });
  });
  return (
    <group ref={group} visible={false}>
      {puffs.map((p, i) => (
        <sprite key={i} material={mat} scale={[p.s, p.s * 0.45, 1]} />
      ))}
    </group>
  );
}

// A ring of low clouds around the horizon hides where the sea ends.
function HorizonClouds() {
  const tex = useSoftTexture();
  const puffs = useMemo(() => {
    const rnd = mulberry32(31);
    return Array.from({ length: 70 }, (_, i) => {
      const a = (i / 70) * Math.PI * 2 + rnd() * 0.08;
      const d = 95 + rnd() * 45;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, y: 1 + rnd() * 7, s: 38 + rnd() * 30 };
    });
  }, []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }), [tex]);
  useFrame(() => {
    // Tinted between the fog and cloud colors so the ring melts into the sky.
    mat.color.copy(atmo.fog).lerp(atmo.cloud, 0.35);
    mat.opacity = 0.95;
  });
  return (
    <group>
      {puffs.map((p, i) => (
        <sprite key={i} material={mat} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 0.32, 1]} />
      ))}
    </group>
  );
}

/* ---------------- Terrain ---------------- */

const SAND = new THREE.Color('#fbe3ad');
const SNOW_WHITE = new THREE.Color('#eef2f6');

// Soft light/dark patches so the lawn doesn't read as one flat green.
function useGroundTexture() {
  return useMemo(() => {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgb(226,226,226)';
    g.fillRect(0, 0, size, size);
    const rnd = mulberry32(404);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 30 + rnd() * 110;
      const light = rnd() < 0.55;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, light ? 'rgba(255,255,240,0.35)' : 'rgba(150,170,120,0.3)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,230,0.25)' : 'rgba(90,120,70,0.2)';
      g.fillRect(rnd() * size, rnd() * size, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
}

function Island({ store }: { store: GameStore }) {
  const groundTex = useGroundTexture();
  const top = useRef<THREE.MeshStandardMaterial>(null);
  const sand = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    top.current?.color.copy(atmo.ground);
    sand.current?.color.copy(SAND).lerp(SNOW_WHITE, atmo.snow * 0.75);
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (store.frozen || e.delta > 6) return;
    e.stopPropagation();
    store.target = new THREE.Vector3(e.point.x, 0, e.point.z);
    store.targetId = null;
  };
  return (
    <group>
      <mesh position-y={-1} receiveShadow onClick={onClick}>
        <cylinderGeometry args={[ISLAND_R, ISLAND_R - 0.8, 2, 72]} />
        <meshStandardMaterial roughness={0.55} attach="material-0" color="#9b6b43" />
        <meshStandardMaterial roughness={0.85} ref={top} attach="material-1" color="#86b85a" map={groundTex} />
        <meshStandardMaterial roughness={0.55} attach="material-2" color="#9b6b43" />
      </mesh>
      <mesh position-y={-0.85} receiveShadow onClick={onClick}>
        <cylinderGeometry args={[ISLAND_R + 3.2, ISLAND_R + 4.2, 1, 72]} />
        <meshStandardMaterial roughness={0.55} ref={sand} color="#f3d6a4" />
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
      <meshStandardMaterial roughness={0.55} color="#d9b98c" />
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
    // Distance along the player→camera direction, and sideways from that line.
    const bx = Math.sin(store.camYaw);
    const bz = Math.cos(store.camYaw);
    const rx = x - store.pos.x;
    const rz = z - store.pos.z;
    const along = rx * bx + rz * bz;
    const side = Math.abs(rx * bz - rz * bx);
    const blocking = store.started && along > 0.5 && along < store.camDist && side < 2.6 + along * 0.12;
    const want = blocking ? 0.28 : 1;
    if (Math.abs(fade.current - want) < 0.01) return;
    fade.current += (want - fade.current) * (1 - Math.exp(-8 * Math.min(delta, 0.05)));
    root.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m) return;
      const transparent = fade.current < 0.99;
      // three compiles opaque materials with `#define OPAQUE`, which forces alpha
      // to 1. Flipping `transparent` alone doesn't recompile, so the tree stayed
      // solid; the shader has to be rebuilt whenever the flag changes.
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = fade.current;
      m.depthWrite = !transparent;
    });
  });
  const leaf = kind === 'blossom' ? '#ff9ec4' : kind === 'pine' ? '#35a06a' : seed % 2 ? '#4fbf4c' : '#62cc55';
  const leaf2 = kind === 'blossom' ? '#ffc4dc' : kind === 'pine' ? '#4dba7c' : '#86df68';
  return (
    <group ref={root} position={[x, 0, z]} scale={scale} rotation-y={seed}>
      <mesh position-y={0.8} castShadow>
        <cylinderGeometry args={[0.2, 0.28, 1.6, 12]} />
        <meshStandardMaterial roughness={0.55} color="#8b5a3c" />
      </mesh>
      <group ref={ref} position-y={1.5}>
        {kind === 'pine' ? (
          <>
            <mesh position-y={0.6} castShadow>
              <coneGeometry args={[1.25, 1.7, 20]} />
              <meshStandardMaterial roughness={0.55} color={leaf} />
            </mesh>
            <mesh position-y={1.45} castShadow>
              <coneGeometry args={[0.9, 1.35, 20]} />
              <meshStandardMaterial roughness={0.55} color={leaf2} />
            </mesh>
          </>
        ) : (
          <>
            <mesh position-y={0.7} castShadow>
              <icosahedronGeometry args={[1.3, 4]} />
              <meshStandardMaterial roughness={0.55} color={leaf} />
            </mesh>
            <mesh position={[0.55, 1.15, 0.2]} castShadow>
              <icosahedronGeometry args={[0.85, 4]} />
              <meshStandardMaterial roughness={0.55} color={leaf2} />
            </mesh>
            <mesh position={[-0.6, 1.0, -0.2]} castShadow>
              <icosahedronGeometry args={[0.8, 4]} />
              <meshStandardMaterial roughness={0.55} color={leaf2} />
            </mesh>
            {fruit &&
              [
                [0.9, 0.5, 0.6],
                [-0.8, 0.7, 0.7],
                [0.2, 0.4, 1.15],
              ].map((p, j) => (
                <mesh key={j} position={p as [number, number, number]}>
                  <sphereGeometry args={[0.16, 10, 8]} />
                  <meshStandardMaterial roughness={0.55} color={kind === 'blossom' ? '#ff7b9c' : '#ff9a3c'} />
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
      <meshStandardMaterial roughness={0.55} emissive="#ffffff" emissiveIntensity={0.08} />
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
          <icosahedronGeometry args={[1, 3]} />
          <meshStandardMaterial roughness={0.4} color="#c7bdd6" />
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
          <meshStandardMaterial roughness={0.55} color={i % 2 ? '#b07d52' : '#a8744a'} />
        </mesh>
      ))}
      {[0, 2.4, 4.8].map((z) =>
        [-0.85, 0.85].map((x) => (
          <mesh key={`${x}${z}`} position={[x, -0.2, z]}>
            <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
            <meshStandardMaterial roughness={0.55} color="#7a5234" />
          </mesh>
        )),
      )}
      <group position={[0.85, 0.1, 5]}>
        <mesh position-y={0.55}>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 6]} />
          <meshStandardMaterial roughness={0.55} color="#5b4636" />
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

function House({ x, z, wall, roof, door, scale = 1 }: { x: number; z: number; wall: string; roof: string; door: string; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position-y={1.2} castShadow receiveShadow>
        <boxGeometry args={[3.6, 2.4, 3.2]} />
        <meshStandardMaterial roughness={0.55} color={wall} />
      </mesh>
      <mesh position-y={3.2} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[3.2, 1.8, 4]} />
        <meshStandardMaterial color={roof} roughness={0.45} flatShading />
      </mesh>
      <mesh position={[1, 3.4, -0.4]} castShadow>
        <boxGeometry args={[0.45, 1.1, 0.45]} />
        <meshStandardMaterial roughness={0.55} color="#a0624a" />
      </mesh>
      <mesh position={[0, 0.75, 1.61]}>
        <boxGeometry args={[0.85, 1.5, 0.05]} />
        <meshStandardMaterial roughness={0.55} color={door} />
      </mesh>
      <mesh position={[0.22, 0.75, 1.65]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial roughness={0.55} color="#f2cf5b" />
      </mesh>
      {[-1.15, 1.15].map((wx) => (
        <group key={wx} position={[wx, 1.45, 1.61]}>
          <mesh material={WINDOW_MAT}>
            <boxGeometry args={[0.8, 0.7, 0.05]} />
          </mesh>
          <mesh position-z={0.03}>
            <boxGeometry args={[0.06, 0.7, 0.03]} />
            <meshStandardMaterial roughness={0.55} color="#fff8e7" />
          </mesh>
          <mesh position-z={0.03}>
            <boxGeometry args={[0.8, 0.06, 0.03]} />
            <meshStandardMaterial roughness={0.55} color="#fff8e7" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.03, 2.3]} receiveShadow>
        <boxGeometry args={[1.4, 0.06, 1]} />
        <meshStandardMaterial roughness={0.55} color="#c79a6b" />
      </mesh>
    </group>
  );
}

function ProjectBoard() {
  return (
    <group position={[PLAZA.x, 0, PLAZA.z]}>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 1.05, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.1, 1.8, 6]} />
          <meshStandardMaterial roughness={0.55} color="#7a5234" />
        </mesh>
      ))}
      <mesh position={[0, 1.35, 0]} castShadow>
        <boxGeometry args={[2.4, 1.2, 0.14]} />
        <meshStandardMaterial roughness={0.55} color="#c8966a" />
      </mesh>
      <mesh position={[0, 2.03, 0]} castShadow>
        <boxGeometry args={[2.7, 0.16, 0.36]} />
        <meshStandardMaterial roughness={0.55} color="#d9695f" />
      </mesh>
      {[
        [-0.6, 1.5, '#fff8e7'],
        [0.35, 1.25, '#ffe3a3'],
        [-0.2, 1.1, '#cfe8ff'],
        [0.7, 1.55, '#ffd0dc'],
      ].map(([px, py, c], i) => (
        <mesh key={i} position={[px as number, py as number, 0.08]} rotation-z={(i - 1.5) * 0.08}>
          <boxGeometry args={[0.55, 0.4, 0.02]} />
          <meshStandardMaterial roughness={0.55} color={c as string} />
        </mesh>
      ))}
    </group>
  );
}

function ProjectSign({ x, z, rot, color, soon }: { x: number; z: number; rot: number; color: string; soon: boolean }) {
  const lantern = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (lantern.current) lantern.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2 + x) * 0.08);
  });
  return (
    <group position={[x, 0, z]} rotation-y={rot}>
      <mesh position-y={0.6} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 1.2, 6]} />
        <meshStandardMaterial roughness={0.55} color="#7a5234" />
      </mesh>
      <mesh position-y={1.15} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.1]} />
        <meshStandardMaterial roughness={0.55} color="#d7ab7c" />
      </mesh>
      <mesh position={[0, 1.15, 0.06]}>
        <circleGeometry args={[0.22, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={lantern} position-y={1.68}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshBasicMaterial color={soon ? '#cfc6ff' : '#ffe3a3'} />
      </mesh>
    </group>
  );
}

function Garden({ store }: { store: GameStore }) {
  const crops = useRef<(THREE.Group | null)[]>([]);
  const soil = useRef<THREE.MeshStandardMaterial[]>([]);
  useFrame(({ clock }) => {
    const now = performance.now() / 1000;
    const g = store.garden;
    // Plants bounce after watering, and spring up after a harvest.
    const sinceWater = now - g.wateredAt;
    const sinceHarvest = now - g.harvestedAt;
    const bounce = sinceWater < 1.4 ? Math.sin(sinceWater * 14) * 0.12 * (1 - sinceWater / 1.4) : 0;
    const regrow = sinceHarvest < 1.2 ? sinceHarvest / 1.2 : 1;
    crops.current.forEach((c, i) => {
      if (!c) return;
      const k = g.growth * regrow;
      c.scale.set(k, k * (1 + bounce), k);
      c.rotation.y = Math.sin(clock.elapsedTime * 0.6 + i) * 0.05;
    });
    // Wet soil looks darker for a while.
    const wet = Math.max(0, 1 - sinceWater / 20);
    soil.current.forEach((m) => m?.color.setRGB(0.19 - wet * 0.08, 0.087 - wet * 0.04, 0.035 - wet * 0.015));
  });
  return (
    <group>
      {GARDEN_PLOTS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position-y={0.1} receiveShadow>
            <boxGeometry args={[2.3, 0.2, 2.3]} />
            <meshStandardMaterial ref={(m) => { if (m) soil.current[i] = m; }} roughness={0.7} color="#7a5234" />
          </mesh>
          <group ref={(g) => (crops.current[i] = g)} position-y={0.2}>
            <group position-y={-0.2}>
              {[-0.6, 0, 0.6].map((ox) =>
                [-0.6, 0.6].map((oz) => <Crop key={`${ox}${oz}`} kind={p.kind} x={ox} z={oz} />),
              )}
            </group>
          </group>
        </group>
      ))}
      {/* Little picket fence around the garden. */}
      {Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        if (Math.abs(a - Math.PI / 2) < 0.3) return null;
        return (
          <mesh key={i} position={[GARDEN.x + Math.cos(a) * 3.5, 0.3, GARDEN.z + Math.sin(a) * 3.5]} castShadow>
            <boxGeometry args={[0.12, 0.6, 0.12]} />
            <meshStandardMaterial roughness={0.55} color="#fff8e7" />
          </mesh>
        );
      })}
    </group>
  );
}

function Crop({ kind, x, z }: { kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage'; x: number; z: number }) {
  if (kind === 'sunflower')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.55}>
          <cylinderGeometry args={[0.03, 0.04, 1.1, 5]} />
          <meshStandardMaterial roughness={0.55} color="#5f9447" />
        </mesh>
        <mesh position={[0, 1.12, 0.05]} rotation-x={0.3}>
          <cylinderGeometry args={[0.24, 0.24, 0.05, 12]} />
          <meshStandardMaterial roughness={0.55} color="#ffc93c" />
        </mesh>
        <mesh position={[0, 1.13, 0.09]} rotation-x={0.3}>
          <cylinderGeometry args={[0.11, 0.11, 0.06, 10]} />
          <meshStandardMaterial roughness={0.55} color="#7a4a24" />
        </mesh>
      </group>
    );
  if (kind === 'tomato')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.3}>
          <icosahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial roughness={0.55} color="#5f9447" />
        </mesh>
        {[
          [0.18, 0.35, 0.15],
          [-0.15, 0.25, 0.2],
          [0.02, 0.5, -0.18],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial roughness={0.55} color="#e5484d" />
          </mesh>
        ))}
      </group>
    );
  if (kind === 'carrot')
    return (
      <group position={[x, 0.2, z]}>
        <mesh position-y={0.08} rotation-x={Math.PI}>
          <coneGeometry args={[0.09, 0.3, 6]} />
          <meshStandardMaterial roughness={0.55} color="#f08a3c" />
        </mesh>
        <mesh position-y={0.3}>
          <coneGeometry args={[0.13, 0.35, 5]} />
          <meshStandardMaterial roughness={0.55} color="#6fb04d" />
        </mesh>
      </group>
    );
  return (
    <mesh position={[x, 0.38, z]} scale={[1, 0.8, 1]}>
      <icosahedronGeometry args={[0.26, 1]} />
      <meshStandardMaterial roughness={0.55} color="#9ed27a" />
    </mesh>
  );
}

// Daniel's mini weather station: an ESP32 dev board, a DHT22 sensor, a tiny
// solar panel and an OLED screen showing live readings for San Antonio.
function WeatherStation({ store }: { store: GameStore }) {
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const shown = useRef('');
  const { canvas, tex } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, tex: t };
  }, []);
  useFrame(({ clock }) => {
    if (led.current) led.current.color.set(Math.sin(clock.elapsedTime * 4) > 0.6 ? '#4dd2ff' : '#0b3a52');
    const m = store.meteo;
    const blink = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    const key = m ? `${m.temp}|${m.hum}` : `wait${blink}`;
    if (key === shown.current) return;
    shown.current = key;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#7fe7ff';
    g.font = 'bold 22px monospace';
    g.fillText('SAN ANTONIO', 14, 30);
    g.font = 'bold 40px monospace';
    if (m) {
      g.fillText(`${m.temp.toFixed(1)}°C`, 14, 78);
      g.font = 'bold 26px monospace';
      g.fillText(`HR ${Math.round(m.hum)}%`, 14, 114);
    } else {
      g.fillText(blink ? '--.-°C' : '  .  ', 14, 78);
      g.font = 'bold 22px monospace';
      g.fillText('wifi...', 14, 114);
    }
    tex.needsUpdate = true;
  });
  return (
    <group position={[STATION.x, 0, STATION.z]} rotation-y={0.5}>
      <mesh position-y={0.55} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 1.1, 8]} />
        <meshStandardMaterial roughness={0.6} color="#7a5234" />
      </mesh>
      {/* enclosure */}
      <mesh position-y={1.2} castShadow>
        <boxGeometry args={[0.62, 0.42, 0.16]} />
        <meshStandardMaterial roughness={0.35} color="#f4f1ea" />
      </mesh>
      {/* green PCB + ESP32 module */}
      <mesh position={[0, 1.2, 0.085]}>
        <boxGeometry args={[0.54, 0.34, 0.02]} />
        <meshStandardMaterial roughness={0.5} color="#1f7a4a" />
      </mesh>
      <mesh position={[0.14, 1.13, 0.1]}>
        <boxGeometry args={[0.18, 0.14, 0.02]} />
        <meshStandardMaterial roughness={0.2} metalness={0.8} color="#c9ced6" />
      </mesh>
      {/* OLED */}
      <mesh position={[-0.1, 1.24, 0.1]}>
        <planeGeometry args={[0.26, 0.13]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0.2, 1.3, 0.1]}>
        <sphereGeometry args={[0.018, 8, 6]} />
        <meshBasicMaterial ref={led} color="#4dd2ff" />
      </mesh>
      {/* DHT22 sensor with its little grille */}
      <mesh position={[0.36, 1.12, 0.04]}>
        <boxGeometry args={[0.1, 0.16, 0.06]} />
        <meshStandardMaterial roughness={0.5} color="#e9eef2" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.36, 1.07 + i * 0.045, 0.072]}>
          <boxGeometry args={[0.07, 0.012, 0.005]} />
          <meshBasicMaterial color="#9aa6b2" />
        </mesh>
      ))}
      {/* antenna */}
      <mesh position={[-0.26, 1.55, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.32, 6]} />
        <meshStandardMaterial roughness={0.4} color="#2b2b2b" />
      </mesh>
      {/* tiny solar panel */}
      <mesh position={[0, 1.52, -0.05]} rotation-x={-0.6}>
        <boxGeometry args={[0.46, 0.02, 0.3]} />
        <meshStandardMaterial roughness={0.15} metalness={0.4} color="#243a6b" />
      </mesh>
    </group>
  );
}

// Short-lived particles: water drops over the garden, veggies popping out, party confetti.
const BURST_N = 260;
function Bursts({ store }: { store: GameStore }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  // Starts non-idle on purpose: InstancedMesh creates every instance with the
  // identity matrix, so until the first frame scales them to zero all 260 sat
  // as one white sphere at the island centre.
  const st = useMemo(
    () => ({ p: new Float32Array(BURST_N * 3), v: new Float32Array(BURST_N * 3), life: new Float32Array(BURST_N), size: new Float32Array(BURST_N), next: 0, idle: false }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string) => {
      const i = st.next;
      st.next = (st.next + 1) % BURST_N;
      st.p.set([x, y, z], i * 3);
      st.v.set([vx, vy, vz], i * 3);
      st.life[i] = life;
      st.size[i] = size;
      ref.current?.setColorAt(i, col.set(color));
      st.idle = false;
    };
    store.burst = (kind, x, z) => {
      const R = Math.random;
      if (kind === 'water') {
        for (let k = 0; k < 90; k++) spawn(x + (R() - 0.5) * 6, 3 + R() * 1.5, z + (R() - 0.5) * 6, 0, -2 - R() * 2, 0, 1.2, 0.07, R() < 0.5 ? '#7fd3ff' : '#bfeaff');
      } else if (kind === 'harvest') {
        const veg = ['#ff8a3c', '#e5484d', '#ffc93c', '#9ed27a'];
        for (let k = 0; k < 40; k++) spawn(x + (R() - 0.5) * 5, 0.6, z + (R() - 0.5) * 5, (R() - 0.5) * 3, 4 + R() * 3, (R() - 0.5) * 3, 1.3, 0.13, veg[k % veg.length]);
      } else if (kind === 'hearts') {
        // A few pink puffs popping up off Dui's back: launched hard enough that
        // gravity turns them before they come down.
        for (let k = 0; k < 14; k++) spawn(x + (R() - 0.5) * 0.5, 0.9, z + (R() - 0.5) * 0.5, (R() - 0.5) * 1.2, 4 + R() * 1.5, (R() - 0.5) * 1.2, 0.8, 0.09, k % 2 ? '#ff7a9a' : '#ffb3c6');
      } else {
        const party = ['#ff6b9a', '#ffd23f', '#7ccf8a', '#7fc4ff', '#b28ee0', '#ff9a3c'];
        for (let k = 0; k < 160; k++) spawn(x + (R() - 0.5) * 16, 8 + R() * 6, z + (R() - 0.5) * 16, (R() - 0.5) * 1.5, -1.5 - R() * 1.5, (R() - 0.5) * 1.5, 5, 0.1, party[k % party.length]);
      }
      if (ref.current?.instanceColor) ref.current.instanceColor.needsUpdate = true;
    };
  }, [store, st, col]);
  useFrame((_, delta) => {
    const m = ref.current;
    if (!m || st.idle) return;
    const dt = Math.min(delta, 0.05);
    let alive = false;
    for (let i = 0; i < BURST_N; i++) {
      if (st.life[i] > 0) {
        alive = true;
        st.life[i] -= dt;
        st.v[i * 3 + 1] -= 7 * dt;
        st.p[i * 3] += st.v[i * 3] * dt;
        st.p[i * 3 + 1] = Math.max(0.05, st.p[i * 3 + 1] + st.v[i * 3 + 1] * dt);
        st.p[i * 3 + 2] += st.v[i * 3 + 2] * dt;
        dummy.position.set(st.p[i * 3], st.p[i * 3 + 1], st.p[i * 3 + 2]);
        dummy.rotation.set(st.life[i] * 6, st.life[i] * 4, 0);
        dummy.scale.setScalar(st.size[i] * Math.min(1, st.life[i] * 3));
      } else dummy.scale.setScalar(0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (!alive) st.idle = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, BURST_N]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={0.3} />
    </instancedMesh>
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
        <meshStandardMaterial roughness={0.55} color="#7a5234" />
      </mesh>
      <mesh position-y={1.1} castShadow>
        <boxGeometry args={[0.5, 0.45, 0.75]} />
        <meshStandardMaterial roughness={0.55} color="#e0584f" />
      </mesh>
      <mesh position-y={1.32} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.25, 0.25, 0.75, 14, 1, false, 0, Math.PI]} />
        <meshStandardMaterial roughness={0.55} color="#e0584f" side={THREE.DoubleSide} />
      </mesh>
      <group ref={flag} position={[0.27, 1.1, -0.1]}>
        <mesh position-y={0.25}>
          <boxGeometry args={[0.04, 0.5, 0.04]} />
          <meshStandardMaterial roughness={0.55} color="#5b4636" />
        </mesh>
        <mesh position={[0, 0.42, 0.12]}>
          <boxGeometry args={[0.03, 0.18, 0.22]} />
          <meshStandardMaterial roughness={0.55} color="#f2cf5b" />
        </mesh>
      </group>
    </group>
  );
}

function WelcomeSign() {
  return (
    <group position={[WELCOME.x, 0, WELCOME.z]} rotation-y={0.35}>
      <mesh position-y={0.55} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 1.1, 6]} />
        <meshStandardMaterial roughness={0.55} color="#7a5234" />
      </mesh>
      <mesh position-y={1.1} castShadow>
        <boxGeometry args={[1.2, 0.6, 0.1]} />
        <meshStandardMaterial roughness={0.55} color="#e8c393" />
      </mesh>
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
  beard?: string;
  // Lighter tone for the mustache and chin tuft so they separate from the jaw at a distance.
  beardLight?: string;
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
        <meshStandardMaterial roughness={0.55} color="#6b4a3a" />
      </mesh>
      <mesh ref={rf} position={[0.14, 0.09, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial roughness={0.55} color="#6b4a3a" />
      </mesh>
      <group ref={body}>
        <mesh position-y={0.3}>
          <cylinderGeometry args={[0.2, 0.24, 0.3, 12]} />
          <meshStandardMaterial roughness={0.55} color={look.pants} />
        </mesh>
        <mesh position-y={0.62} castShadow>
          <capsuleGeometry args={[0.25, 0.22, 6, 14]} />
          <meshStandardMaterial roughness={0.55} color={look.shirt} />
        </mesh>
        <group ref={la} position={[-0.3, 0.76, 0]}>
          <mesh position-y={-0.17} rotation-z={-0.15}>
            <capsuleGeometry args={[0.075, 0.2, 4, 8]} />
            <meshStandardMaterial roughness={0.55} color={look.shirt} />
          </mesh>
          <mesh position={[-0.04, -0.36, 0]}>
            <sphereGeometry args={[0.075, 8, 6]} />
            <meshStandardMaterial roughness={0.55} color={look.skin} />
          </mesh>
        </group>
        <group ref={ra} position={[0.3, 0.76, 0]}>
          <mesh position-y={-0.17} rotation-z={0.15}>
            <capsuleGeometry args={[0.075, 0.2, 4, 8]} />
            <meshStandardMaterial roughness={0.55} color={look.shirt} />
          </mesh>
          <mesh position={[0.04, -0.36, 0]}>
            <sphereGeometry args={[0.075, 8, 6]} />
            <meshStandardMaterial roughness={0.55} color={look.skin} />
          </mesh>
          <group ref={tool} position={[0.04, -0.38, 0.05]} visible={false}>
            <mesh position-z={0.18} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.025, 0.025, 0.42, 6]} />
              <meshStandardMaterial roughness={0.55} color="#a0624a" />
            </mesh>
            <mesh position={[0.12, 0, 0.4]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.14, 0.025, 6, 14, Math.PI * 1.1]} />
              <meshStandardMaterial roughness={0.55} color="#e6ecf2" emissive="#ffffff" emissiveIntensity={0.2} />
            </mesh>
          </group>
        </group>
        <group position-y={1.17}>
          <mesh castShadow>
            <sphereGeometry args={[0.4, 32, 24]} />
            <meshStandardMaterial roughness={0.4} color={look.skin} />
          </mesh>
          {[-1, 1].map((sx) => (
            <group key={sx}>
              <mesh position={[sx * 0.15, 0.0, 0.345]} scale={[1, 1.4, 0.55]}>
                <sphereGeometry args={[0.068, 16, 12]} />
                <meshStandardMaterial color="#2b1d16" roughness={0.15} />
              </mesh>
              <mesh position={[sx * 0.15 + 0.022, 0.045, 0.385]}>
                <sphereGeometry args={[0.02, 8, 6]} />
                <meshBasicMaterial color="#ffffff" />
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
          {look.beard && (
            <>
              {/* Jaw: a band of a sphere just outside the head (r 0.4), ear to ear, starting under the mouth so it stays visible. */}
              <mesh scale={[1.02, 1, 1.06]}>
                <sphereGeometry args={[0.415, 24, 10, -Math.PI * 0.12, Math.PI * 1.24, Math.PI * 0.64, Math.PI * 0.29]} />
                <meshStandardMaterial roughness={0.55} color={look.beard} side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[0, -0.3, 0.27]} scale={[1.25, 0.95, 0.75]} castShadow>
                <sphereGeometry args={[0.14, 14, 10]} />
                <meshStandardMaterial roughness={0.55} color={look.beardLight ?? look.beard} />
              </mesh>
              {[-1, 1].map((sx) => (
                <group key={sx}>
                  {/* Sideburns bridge the hair cap (ends ~y 0.04) and the jaw (starts ~y -0.18). */}
                  <mesh position={[sx * 0.37, -0.07, 0.1]} rotation-z={sx * 0.1}>
                    <capsuleGeometry args={[0.045, 0.14, 4, 8]} />
                    <meshStandardMaterial roughness={0.55} color={look.beard} />
                  </mesh>
                  {/* Mustache halves droop outward and yaw back to follow the face. */}
                  <mesh position={[sx * 0.055, -0.098, 0.378]} rotation={[0, sx * 0.3, Math.PI / 2 - sx * 0.3]} scale={[1, 1, 0.7]}>
                    <capsuleGeometry args={[0.032, 0.075, 4, 8]} />
                    <meshStandardMaterial roughness={0.55} color={look.beardLight ?? look.beard} />
                  </mesh>
                </group>
              ))}
            </>
          )}
          {look.hair && (
            <>
              <mesh position={[0, 0.1, -0.06]} scale={[1.06, 0.9, 1.02]} castShadow>
                <sphereGeometry args={[0.41, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
                <meshStandardMaterial roughness={0.55} color={look.hair} />
              </mesh>
              <mesh position={[0.1, 0.27, 0.26]} rotation={[0.9, 0, -0.4]}>
                <capsuleGeometry args={[0.08, 0.18, 4, 8]} />
                <meshStandardMaterial roughness={0.55} color={look.hair} />
              </mesh>
            </>
          )}
          {look.hat && (
            <group position-y={0.24}>
              <mesh castShadow>
                <cylinderGeometry args={[0.62, 0.62, 0.04, 24]} />
                <meshStandardMaterial roughness={0.55} color={look.hat.color} />
              </mesh>
              <mesh position-y={0.14}>
                <cylinderGeometry args={[0.28, 0.33, 0.26, 18]} />
                <meshStandardMaterial roughness={0.55} color={look.hat.color} />
              </mesh>
              <mesh position-y={0.06}>
                <cylinderGeometry args={[0.335, 0.335, 0.08, 18]} />
                <meshStandardMaterial roughness={0.55} color={look.hat.band} />
              </mesh>
            </group>
          )}
        </group>
      </group>
    </group>
  );
}

const PLAYER_LOOK: Look = { shirt: '#7cc6e8', pants: '#5a7bb5', skin: '#ffd9b8', hat: { color: '#f2cf7a', band: '#e76f51' } };
const DANIEL_LOOK: Look = { shirt: '#f28c6b', pants: '#4b5563', skin: '#f1c7a1', hair: '#3b2a22', glasses: true, beard: '#8a4b2d', beardLight: '#a8613b' };

function DanielNpc({ store }: { store: GameStore }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef<Anim>({ phase: 0, amt: 0, swing: 0 });
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
  });
  return (
    <group position={[DANIEL.x, 0, DANIEL.z]}>
      <group ref={ref}>
        <Villager look={DANIEL_LOOK} anim={anim} />
      </group>
    </group>
  );
}

function Player({ store, events }: { store: GameStore; events: MutableRefObject<GameEvents> }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef<Anim>({ phase: 0, amt: 0, swing: 0 });
  const dir = useRef(new THREE.Vector2(0, 1));
  const stuck = useRef({ t: 0, d: Infinity });
  // The stuck timer compares against the distance to the target it started
  // with; a new, farther target looked like "not getting closer" and the walk
  // was aborted after 1.2 s. It restarts whenever the target object changes.
  const stuckTarget = useRef<THREE.Vector3 | null>(null);
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
      // Input is relative to where the camera looks.
      const sy = Math.sin(s.camYaw);
      const cy = Math.cos(s.camYaw);
      dir.current.set(cy * ix + sy * iz, -sy * ix + cy * iz).normalize();
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
        if (stuckTarget.current !== s.target) {
          stuckTarget.current = s.target;
          stuck.current.t = 0;
          stuck.current.d = d;
        }
        if (d < stuck.current.d - 0.05) {
          stuck.current.t = 0;
          stuck.current.d = d;
        }
        else if ((stuck.current.t += dt) > 1.2) {
          const id = s.targetId;
          s.target = null;
          s.targetId = null;
          stuck.current.t = 0;
          stuck.current.d = Infinity;
          if (id && d < 3) events.current.onArrive(id);
        }
      }
    } else {
      stuck.current.t = 0;
      stuck.current.d = Infinity;
      stuckTarget.current = null;
    }

    s.speed += (want - s.speed) * (1 - Math.exp(-12 * dt));
    if (s.speed > 0.05) {
      s.pos.x += dir.current.x * s.speed * dt;
      s.pos.z += dir.current.y * s.speed * dt;
      resolveCollisions(s.pos);
    }
    s.pos.y += (groundHeight(s.pos.x, s.pos.z) - s.pos.y) * (1 - Math.exp(-14 * dt));
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

function CameraRig({ store, reduceMotion }: { store: GameStore; reduceMotion: boolean }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, -4));
  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookWant = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const portrait = size.width / size.height < 0.9;
    if (!store.started) {
      const t = reduceMotion ? 0.6 : clock.elapsedTime * 0.06;
      desired.set(Math.sin(t) * 34, 17, Math.cos(t) * 34);
      lookWant.set(0, 0, -3);
    } else {
      const d = store.camDist * (portrait ? 1.5 : 1);
      const yaw = store.camYaw;
      const pitch = store.camPitch;
      const flat = Math.cos(pitch) * d;
      desired.set(store.pos.x + Math.sin(yaw) * flat, store.pos.y + 0.8 + Math.sin(pitch) * d, store.pos.z + Math.cos(yaw) * flat);
      // Look a little ahead of the player so more of the island (and sky) is in view.
      const ahead = 6 * Math.cos(pitch);
      lookWant.set(store.pos.x - Math.sin(yaw) * ahead, store.pos.y + 1.2, store.pos.z - Math.cos(yaw) * ahead);
    }
    const f = 1 - Math.exp(-(store.started ? (store.dragged ? 12 : 3.2) : 1.2) * dt);
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
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSnow: { value: 0 } }), []);

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
      shader.uniforms.uSnow = uniforms.uSnow;
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
        .replace('#include <common>', '#include <common>\nvarying float vH;\nuniform float uSnow;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.62, 1.18, clamp(vH, 0.0, 1.0));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.25, 0.9, vH) * 0.85);',
        );
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
    const palette = ['#7fcf55', '#8fd962', '#72c24c', '#9fe06c', '#b2e27a', '#68b947'];
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
    () => ({ p: new Float32Array(BITS * 3), v: new Float32Array(BITS * 3), life: new Float32Array(BITS), rot: new Float32Array(BITS), next: 0, idle: false }),
    [],
  );
  const spawnBit = (x: number, z: number) => {
    const b = bitState;
    b.idle = false;
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
    uniforms.uSnow.value = atmo.snow;
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
    if (!bm || b.idle) return;
    let alive = false;
    for (let i = 0; i < BITS; i++) {
      if (b.life[i] > 0) alive = true;
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
    // Everything has landed: the zeroed matrices are uploaded, stop until the next cut.
    if (!alive) b.idle = true;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, mat, field.n]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={bits} args={[undefined, undefined, BITS]} frustumCulled={false}>
        <planeGeometry args={[0.07, 0.16]} />
        <meshStandardMaterial roughness={0.55} color="#8cc05a" side={THREE.DoubleSide} />
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
            <meshStandardMaterial roughness={0.55} color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
