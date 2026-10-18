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
- **Sin WebGL ni three.js**: la isla es un juego 2D de plataformas en pixel art dulce estilo 16 bits (arte original inspirado en los plataformas de Super Nintendo): pasteles, formas redondas, contornos de color, colinas a rayas y árboles chupetín. Hasta octubre de 2026 era 3D con three.js/R3F y andaba lenta en celulares modestos; pasó por versiones ASCII, pixel art simple, crayón y pixel art noventero antes de esta.

## Estructura

```
src/
├── App.tsx              ← Solo enrutado; carga cada parte bajo demanda (React.lazy)
├── data.ts              ← Proyectos, habilidades y redes
├── game/                ← La isla (ruta /)
│   ├── IslandGame.tsx   ← Interfaz: libreta, diálogos, logros, clima, sonido, accesibilidad
│   ├── PixelScene.tsx   ← La escena: cámara, física (gravedad, salto, agua), cavar, pasto, estrellas, clima, luz
│   ├── dulce.ts         ← El arte: paleta pastel, bloques con contorno de color, cielo, colinas, nubes, árboles, Dui, Daniel, cosas
│   ├── ambiente.ts      ← Fogata, faroles, pétalos, mariposas, luciérnagas, gradación de color
│   ├── sprites.ts       ← Paleta de colores de partículas (del pixel art anterior)
│   ├── world.ts         ← El mundo de bloques: superficie, casas, árboles, huerto, muelle, cuevas, estrellas
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
| `/` | Isla de Daniel en 2D, en pixel art dulce de 16 bits: Dui (el gato) recorre la isla, cava, salta, trepa y junta los 5 sellos de la libreta |
| `/clasico` | Hero + proyectos destacados + contacto |
| `/proyectos` | Catálogo completo con filtro por tags |
| `/sobre-mi` | Bio extendida, stack y valores |
| `/privacidad` | Política de cookies / Ley 19.628 + 21.719 |
| _otras_ | 404 "Perdido en el espacio" |

## La isla

- **Controles:** A/D o flechas para caminar, Shift para correr, Espacio o W para saltar, F para el zarpazo (corta pasto alto y cava tierra; con S cava bajo las patas), E para interactuar. En celular, joystick (hacia arriba salta) y botón 🐾; tocar el mapa hace caminar a Dui, tocar un bloque cercano lo cava y tocar a Dui le hace cariño.
- **Mundo:** 220 × 80 bloques (`world.ts`). Colinas suaves que se caminan sin saltar, casas de bloques con techo escalonado (se puede subir), huerto con cerca, estación con LED, tablón y 12 letreros de proyectos, muelle sobre el mar y cinco cuevas bajo tierra. Lo cavado se rellena solo al minuto y el pasto vuelve a crecer a los 45 s.
- **Estrellas:** 12. Ocho bajo el pasto alto (zarpazo) y cuatro en cuevas (hay que cavar). Las tomadas se guardan por índice en `localStorage`.
- **Coordenadas:** x en bloques; la vertical va en `pos.z` (pies), así `IslandGame` sigue midiendo distancias con `hypot(dx, dz)` sin saber que el mundo es 2D.
- **Clima:** `weather.ts` mezcla cielo, nubes, lluvia, nieve, niebla y estrellas; de noche y bajo tierra una capa oscura deja luz alrededor de Dui, las ventanas y las estrellas reveladas.
- **Arte:** todo se dibuja con código, sin imágenes, a 1 píxel de arte = 1 píxel del canvas, agrandado por un número entero sin suavizar (`image-rendering: pixelated`). Paleta pastel, contorno en un tono oscuro del propio color (nunca negro), esquinas redondeadas, tierra con lunares, colinas a rayas, nubes infladas y árboles dibujados enteros como figuras redondas. Dui es una bolita de gato naranja con ojos grandes y mejillas rosadas. Personajes, árboles y cosas se dibujan una vez por pose y quedan en caché.
- **Física de gato:** salta ~2,75 bloques, flota y nada, y trepa paredes manteniendo el salto (un pozo hondo ya no es una trampa). Al caminar solo bajo tierra, escarba hacia su destino.
- **Música y sonido:** chiptune original generado con Web Audio («Isla de Dui», Fa mayor, 140 BPM; versión tranquila a 96 BPM de noche y con lluvia): pulso con vibrato, bajo triangular, batería de ruido y eco. Efectos en el mismo estilo (salto, aterrizaje, cavar, estrella, logro, maullido). Sin sonidos ambientales; desde 🎧 se ajusta el volumen.
- **Rendimiento:** el canvas tiene la resolución del arte (unos 450×270 píxeles en escritorio), no la de la pantalla. El terreno se pinta en trozos de 8×8 bloques (caché acotada, dos trozos nuevos por cuadro y el anillo vecino se adelanta); cielo, colinas, nubes y poses quedan en caché.
- **Accesible:** región `aria-live` que anuncia qué hay cerca, barra "Ir a / Más lugares" con teclado y avisos con `role="status"`.
- En desarrollo existen `window.__island` (estado y `walkTo`), `window.__pixel` (cámara y escala) y `window.__pixelSpots` (estrellas) para pruebas.

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
