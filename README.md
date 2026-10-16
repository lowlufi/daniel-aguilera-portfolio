# Portafolio — Daniel Aguilera Campusano

Sitio personal de Daniel Eduardo Aguilera Campusano, Ingeniero en Informática con mención en gestión de la información.

**Producción:** https://danieleduardo.cl (Cloudflare Pages, proyecto `danielaguileracampusano`)

## Stack

- **React 19** + **TypeScript** (estrictamente tipado, `tsc --noEmit`)
- **Vite 6** como bundler y dev server
- **Tailwind CSS 4** (plugin de Vite, sin `postcss.config`)
- **Motion** (sucesor de Framer Motion) para animaciones del sitio clásico
- **Lenis** para inercia de scroll (solo escritorio, se apaga en equipos modestos)
- **lucide-react** para los íconos
- Router SPA hecho a mano con `history.pushState`
- **Sin WebGL**: la isla del juego se dibuja con texto (ASCII). Hasta octubre de 2026 era 3D con three.js/R3F y andaba lenta en celulares modestos.

## Estructura

```
src/
├── App.tsx              ← Solo enrutado; carga cada parte bajo demanda (React.lazy)
├── data.ts              ← Proyectos, habilidades y redes
├── game/                ← La isla (ruta /)
│   ├── IslandGame.tsx   ← Interfaz: libreta, diálogos, logros, clima, sonido, accesibilidad
│   ├── AsciiScene.tsx   ← El mundo dibujado en un <pre>: movimiento, colisiones, pasto, estrellas
│   ├── world.ts         ← Mapa: lugares, árboles, caminos, colisiones, estrellas
│   ├── store.ts         ← Estado por cuadro compartido entre escena e interfaz
│   ├── progress.ts      ← Libreta de 5 sellos, guardada en localStorage
│   ├── weather.ts       ← Climas y mezcla de sonido de cada uno
│   └── audio.ts         ← Efectos y ambientes con Web Audio
├── sitio/               ← Versión clásica (/clasico, /proyectos, /sobre-mi, /privacidad)
│   ├── ClassicSite.tsx
│   ├── ContactComposer.tsx
│   └── equipo.ts        ← Detecta equipo modesto o red lenta para apagar efectos caros
├── index.css            ← Tailwind, "liquid glass", paleta de la isla ASCII por clima
└── main.tsx
public/
├── videos/fondo-*-720.mp4  ← Videos de fondo livianos para celulares (0,3–0,8 MB)
├── _headers             ← Seguridad y caché (Cloudflare Pages)
├── _redirects           ← SPA fallback /* → /index.html
└── favicon.svg, og-image.*, robots.txt, sitemap.xml
```

## Rutas

| Ruta | Página |
|---|---|
| `/` | Isla de Daniel en ASCII: Dui (el gato, `@`) recorre la isla y junta los 5 sellos de la libreta |
| `/clasico` | Hero + proyectos destacados + contacto |
| `/proyectos` | Catálogo completo con filtro por tags |
| `/sobre-mi` | Bio extendida, stack y valores |
| `/privacidad` | Política de cookies / Ley 19.628 + 21.719 |
| _otras_ | 404 "Perdido en el espacio" |

## La isla

- **Controles:** WASD o flechas para caminar, Shift para correr, Espacio para cortar pasto, E para interactuar. En celular, joystick y tijeras; tocar el mapa hace caminar a Dui y tocar a Dui le hace cariño.
- **Leyenda:** `@` Dui · `D` Daniel · `T` letreros · `Y` `^` árboles · `"` pasto (`,` cortado) · `*` estrellas · `~` mar · `M` buzón.
- **Solo ASCII puro** en el mapa: símbolos como ♣ ★ ≈ caen a otra fuente en Android y rompen la grilla.
- **Accesible:** región `aria-live` que anuncia qué hay cerca, barra "Ir a / Más lugares" con teclado y avisos con `role="status"`.
- **Rendimiento:** dibuja solo cuando algo cambia (~7 veces por segundo caminando); 60 fps con la CPU 6 veces más lenta. El chunk de la isla pesa ~39 KB gzip (antes 447 KB en 3D).
- En desarrollo existen `window.__island` (estado y `walkTo`) y `window.__ascii` (métricas de la grilla) para pruebas.

## Features del sitio clásico

- **Command Palette** (⌘K / Ctrl+K) — buscador global de páginas, proyectos, temas y contacto.
- **Composer de mensaje** — modal con motivo + nombre + primer mensaje que genera un `mailto:` pre-armado.
- **Theme switcher** — 3 temas (Noche / Atardecer / Aurora) con video de fondo; preferencia en `localStorage`.
- **Modo liviano automático** — en equipos de ≤4 núcleos o ≤4 GB se apagan tilt 3D, brillo animado y refracción SVG; con ahorro de datos o red 2G/3G no se carga video.
- **Tag filter** — chips clickeables en `/proyectos`.

## Desarrollo local

Requisitos: **Node.js 20+**.

```bash
npm install
npm run dev
```

El sitio queda disponible en http://localhost:3000.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con HMR (puerto 3000) |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Previsualiza el build localmente |
| `npm run lint` | Type-check con TypeScript (`tsc --noEmit`) |
| `npm run clean` | Borra la carpeta `dist/` (cross-platform) |

## Deploy

El sitio se aloja en **Cloudflare Pages**.

Para deploy manual desde local:

```bash
npm run build
npx wrangler pages deploy dist --project-name=danielaguileracampusano
```

`public/_redirects` redirige todas las rutas a `index.html` para que el router SPA funcione, y `public/_headers` añade cabeceras de seguridad (HSTS, no-sniff, no-frame, COOP, CORP) y caché agresivo para assets con hash.

## Notas de diseño

- **Liquid glass**: las tarjetas usan `backdrop-filter` con `saturate` + un sheen diagonal animado. En Chromium desktop se reemplaza el blur por un filtro SVG de distorsión (`feTurbulence` + `feDisplacementMap`) para un efecto refractivo más realista.
- **Tres videos de fondo** (night/sunset/aurora) que ciclan con crossfade de 700ms. Cada uno se descarga solo cuando le toca (el siguiente, 8 s antes). En pantallas ≤1024 px y equipos modestos se usa la versión 720p de `public/videos/`; en escritorio, los originales de CloudFront (~14 MB cada uno). Con `prefers-reduced-motion`, gradiente estático.
- **Sin analytics, sin tracking**: solo cookies técnicas de Cloudflare y una marca en `localStorage` para el aviso de cookies.
