# Portafolio — Daniel Aguilera Campusano

Sitio personal de Daniel Eduardo Aguilera Campusano, Ingeniero en Informática con mención en gestión de la información.

**Producción:** https://danielaguileracampusano.pages.dev/

## Stack

- **React 19** + **TypeScript** (estrictamente tipado, `tsc --noEmit`)
- **Vite 6** como bundler y dev server
- **Tailwind CSS 4** (plugin de Vite, sin `postcss.config`)
- **Motion** (sucesor de Framer Motion) para animaciones y scroll-linked transforms
- **Lenis** para inercia de scroll sitio-completo
- **lucide-react** para los íconos de las tarjetas
- Router SPA hecho a mano con `history.pushState` (3 rutas + 404)

## Estructura

```
src/
├── App.tsx        ← Componente raíz, rutas, fondo de video, todas las páginas
├── index.css      ← Tailwind + sistema "liquid glass" + tipografías Google Fonts
└── main.tsx       ← Mount React
public/
├── _headers       ← Cabeceras de seguridad y caché (Cloudflare Pages)
├── _redirects     ← SPA fallback /* → /index.html
├── favicon.svg
├── og-image.svg
├── robots.txt
└── sitemap.xml
index.html         ← Meta tags, OG, JSON-LD (Person schema)
```

## Rutas

| Ruta | Página |
|---|---|
| `/` | Hero + proyectos destacados + contacto |
| `/proyectos` | Catálogo completo con filtro por tags |
| `/sobre-mi` | Bio extendida, stack y valores |
| `/privacidad` | Política de cookies / Ley 19.628 + 21.719 |
| _otras_ | 404 "Perdido en el espacio" |

## Features

- **Command Palette** (⌘K / Ctrl+K) — buscador global de páginas, proyectos, temas y contacto.
- **Composer de mensaje** — modal con motivo + nombre + primer mensaje que genera un `mailto:` pre-armado.
- **Theme switcher** — 3 temas (Noche / Atardecer / Aurora) que ciclan automáticamente o se eligen manualmente. La preferencia se guarda en `localStorage`.
- **Tilt 3D** — tarjetas con perspectiva al hover (desktop only).
- **Scroll progress** — barra superior con `scrollYProgress`.
- **Tag filter** — chips clickeables en `/proyectos` con animación de layout.

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
- **Tres videos de fondo** (night/sunset/aurora) que ciclan automáticamente al final de cada uno, con crossfade de 700ms. Si el usuario tiene `prefers-reduced-motion`, se usa un gradiente estático.
- **Sin analytics, sin tracking**: solo cookies técnicas de Cloudflare y una marca en `localStorage` para el aviso de cookies.
