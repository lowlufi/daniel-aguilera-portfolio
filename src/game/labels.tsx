import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { GameStore } from './store';
import { DANIEL, DOCK_END, GARDEN, HOUSE, MAILBOX, PLAZA, PROJECT_SIGNS, STATION, WELCOME, WORKSHOP } from './world';

// Floating name tags. They live in one plain DOM layer on top of the canvas and
// get re-projected every frame — cheaper than one React root per label.

type LabelDef = {
  text: string;
  x: number;
  y: number;
  z: number;
  tone: 'cream' | 'orange';
  size: number;
  // Only visible when the player stands within this distance.
  nearOnly?: number;
  bob?: boolean;
};

export const LABELS: LabelDef[] = [
  { text: 'Casa de Daniel', x: HOUSE.x, y: 4.7, z: HOUSE.z, tone: 'cream', size: 20 },
  { text: 'Taller', x: WORKSHOP.x, y: 5.2, z: WORKSHOP.z, tone: 'cream', size: 20 },
  { text: '📌 Proyectos', x: PLAZA.x, y: 2.7, z: PLAZA.z, tone: 'orange', size: 20 },
  { text: '🌻 Huerto de habilidades', x: GARDEN.x, y: 2.6, z: GARDEN.z, tone: 'orange', size: 20 },
  { text: '✉️ Buzón', x: MAILBOX.x, y: 2.1, z: MAILBOX.z, tone: 'orange', size: 20 },
  { text: '👋 ¡Bienvenid@!', x: WELCOME.x, y: 1.85, z: WELCOME.z, tone: 'cream', size: 20 },
  { text: '💬 Daniel', x: DANIEL.x, y: 1.95, z: DANIEL.z, tone: 'orange', size: 20, bob: true },
  { text: '📡 Estación ESP32', x: STATION.x, y: 2.05, z: STATION.z, tone: 'cream', size: 16 },
  { text: '🌊 Muelle', x: DOCK_END.x, y: 1.2, z: DOCK_END.z, tone: 'cream', size: 16, nearOnly: 4 },
  ...PROJECT_SIGNS.map((s) => ({ text: s.project.title, x: s.x, y: 2.15, z: s.z, tone: 'cream' as const, size: 14, nearOnly: 2.2 })),
];

const els: (HTMLDivElement | null)[] = [];

export function LabelsOverlay() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {LABELS.map((l, i) => (
        <div
          key={i}
          ref={(el) => {
            els[i] = el;
          }}
          className={`font-cozy absolute left-0 top-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-extrabold shadow-[0_3px_0_rgba(91,70,54,0.25)] ${
            l.tone === 'orange' ? 'bg-[#f0a45d] text-[#3d2410]' : 'bg-[#fff8e7]/95 text-[#6b4f3a]'
          }`}
          style={{ opacity: 0, willChange: 'transform, opacity', transition: 'opacity 250ms ease' }}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

export function LabelProjector({ store }: { store: GameStore }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    LABELS.forEach((l, i) => {
      const el = els[i];
      if (!el) return;
      const y = l.bob ? l.y + Math.sin(t * 3) * 0.06 : l.y;
      v.set(l.x, y, l.z);
      const dist = camera.position.distanceTo(v);
      v.project(camera);
      let visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      if (visible && l.nearOnly) visible = (store.pos.x - l.x) ** 2 + (store.pos.z - l.z) ** 2 < l.nearOnly ** 2;
      el.style.opacity = visible ? '1' : '0';
      if (!visible && v.z >= 1) return;
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      const scale = Math.min(1.35, Math.max(0.4, (l.size / dist) * 0.9));
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    });
  });
  return null;
}
