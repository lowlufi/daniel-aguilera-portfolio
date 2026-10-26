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
├── vuelo/               ← Escuadrón Dui, el juego de aviones (ruta /aviones)
│   ├── VueloGame.tsx    ← Interfaz: hangar de pilotos, marcador, pausa, controles táctiles
│   ├── motor.ts         ← Reglas: oleadas, disparos, daño, cámara, radar, dibujo de la escena
│   ├── dibujo.ts        ← Arte dulce: aviones con Dui, Lulu y Almendrita, vehículos de ratones, terreno, explosiones
│   ├── fisica-vuelo.ts  ← Aerodinámica: sustentación, arrastre inducido, pérdida, límite de g, medio tonel
│   ├── fisica-armas.ts  ← Misiles con navegación proporcional, bombas con arrastre, explosiones, suspensión de vehículos
│   ├── misiles.ts       ← Catálogo de misiles enemigos (buscador, dardo, zigzag, pesado, racimo, enjambre, estratosférico), choques entre misiles
│   ├── estelas.ts       ← Estelas de misil: cinta de fuego, humo pastel con contorno, chispas
│   ├── fondo.ts         ← Fondo cozy por capas que cambia con la altura: valle, mar de nubes, estratosfera y espacio (estrellas, galaxia, luna)
│   ├── ia.ts            ← Cerebro de los vehículos ratón: esquivar bombas, dispersarse, salvas coordinadas
│   ├── aereos.ts        ← Ratones voladores: helicóptero, enjambre de drones abejorro, globo con minas, ovnis
│   ├── gigantes.ts      ← Enemigos de tierra de todos los tamaños: motos, infantería con fusil o bazuca, tren blindado, Ratonzilla
│   ├── cazas.ts         ← Cazas ratón (desde la oleada 3): persiguen con la misma física de vuelo, ráfagas y misiles
│   ├── jefes.ts         ← Jefes voladores por piezas: Dirigible Gran Queso y Nave nodriza del Emperador Ratón
│   ├── efectos.ts       ← Explosiones en capas, onda expansiva, escombros, fuego, piezas que caen, restos ardiendo
│   ├── audio-batalla.ts ← Silbido doppler de los misiles que persiguen, alarma, motor dañado, fuego, viento, ambiente por altura, avisos de jefe
│   ├── fisica-tipos.ts  ← Tipos compartidos de la física
│   └── sonido.ts        ← Muestras grabadas (CC0) y motores en loop con tono según la velocidad
├── sitio/               ← Versión clásica (/clasico, /proyectos, /sobre-mi, /privacidad)
│   ├── ClassicSite.tsx
│   ├── ContactComposer.tsx
│   └── equipo.ts        ← Detecta equipo modesto o red lenta para apagar efectos caros
├── index.css            ← Tailwind, "liquid glass", paleta de la isla ASCII por clima
└── main.tsx
public/
├── sonidos/             ← Efectos grabados CC0 de Freesound para /aviones (300 KB, ver CREDITOS.txt)
├── videos/fondo-*-720.mp4  ← Videos de fondo livianos para celulares (0,3–0,8 MB)
├── _headers             ← Seguridad y caché (Cloudflare Pages)
├── _redirects           ← SPA fallback /* → /index.html
└── favicon.svg, og-image.*, robots.txt, sitemap.xml
```

## Rutas

| Ruta | Página |
|---|---|
| `/` | Isla de Daniel en 2D, en pixel art dulce de 16 bits: Dui (el gato) recorre la isla, cava, salta, trepa y junta los 5 sellos de la libreta |
| `/aviones` | Escuadrón Dui: juego de aviones en 2D. Dui, Lulu o Almendrita detienen a los ratones antes de que lleguen a la despensa |
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

## Escuadrón Dui (/aviones)

- **Pilotos:** Lulu (gatita negra de ojos amarillos) en la Avioneta Mostaza, ágil; Dui en el Caza Mandarina, el más rápido; Almendrita (yorkshire) en el Bombardero Nube, blindado y con bombas triples.
- **Jefa:** al terminar las oleadas 1, 4, 7… llega la vecina Margarita en su carro de feria con escoba, gorro rojo y mal genio: lanza chanclas, tomates y maceteros y grita frases («¡Ricachones $&#%!», «¡Hagan asados con parrilla eléctrica!!»).
- **Objetivo:** los vehículos de los ratones (jeep con cohetes, camión con misil guiado, tanque antiaéreo y batería SAM) avanzan hacia la despensa; si cinco llegan, se acaba. Oleadas cada vez más difíciles, cielo de día, tarde y noche, latas de atún en paracaídas que dan vida.
- **Física:** escala de 3,5 m por px y 1 s de juego = 5 s reales (g ≈ 70 px/s², mismo número de Froude que en la realidad). El avión vuela con sustentación y arrastre inducido, cambia velocidad por altura, entra en pérdida y gira limitado por g; para dar la vuelta hace un Immelmann, un split-S o una vuelta de campana. Los misiles usan navegación proporcional con límite de g y motor que se apaga (se esquivan con un giro cerrado o con bengalas); bombas con arrastre y mira de impacto exacta; explosiones con escalado cúbico de Hopkinson-Cranz; vehículos con suspensión resorte-amortiguador.
- **Daño por piezas y vidas:** cada impacto arranca la pieza más cercana (cola, ala, motor, cabina, bodega) con efecto real en el vuelo; el golpe siguiente a la última destruye el avión. Hay 3 aviones por partida y la partida se guarda en el navegador para continuarla después.
- **Enemigos con IA y aéreos:** los ratones esquivan bombas, se dispersan y disparan en salvas; desde la oleada 2 llegan helicópteros, drones kamikaze y globos con minas. Combos de derribos hasta ×5.
- **Sin ayudas de puntería:** los misiles salen derecho por la nariz y no hay mira de bomba. Las explosiones cavan cráteres en el terreno (estilo Worms) y el viento empuja bombas y humo.
- **Misiles enemigos:** seis tipos, cada uno con su forma de esquivarlo; dos misiles que chocan explotan, las explosiones revientan en cadena a los cercanos y los tuyos pueden derribarlos.
- **Espacio aéreo hasta el espacio:** se puede subir unos 10 km; el fondo pasa del valle al mar de nubes, la estratosfera y el espacio con ovnis. El botón 🌄 cambia el cielo (automático, día, tarde, noche). Los enemigos solo disparan cuando se ven en pantalla, y una flecha en el borde indica dónde están.
- **Recompensas y puentes:** se empieza con pocos misiles, bombas y bengalas; algunos enemigos llevan globos que, al derribarlos, quedan flotando y suman un puesto de esa arma. Con el avión muy dañado aparecen globos de reparación 🔧. Si el terreno queda muy roto, los ratones se bajan y arman puentes.
- **Enemigos de todos los tamaños y jefes:** motos, infantería que salta de los vehículos destruidos, tren blindado, Ratonzilla; el Dirigible Gran Queso llega al terminar las oleadas 3, 9… y la Nave nodriza en la 6, 12… (o si te quedas mucho en el espacio); se rompen por piezas.
- **Al perder:** desde la oleada 3 se puede seguir desde la misma oleada (puntaje a 0).
- **Armas del jugador:** misil que va donde apunta la nariz (si mantienes la nariz 1 s sobre un enemigo, se **fija** y el misil lo persigue; disparado al cielo se queda sin combustible y cae en picada), bombas de gran radio, **metralla** que se calienta si la mantienes, y bengalas que se recargan cada 4 s y engañan a la mayoría de los misiles. Misiles y bombas derriban misiles enemigos.
- **Super nitro:** apretar acelerar dos veces seguidas da un empujón de 2,5 s por sobre la velocidad máxima (se recarga en 9 s). Volando rápido y alejándote, los misiles se quedan atrás.
- **Choques:** estrellarse fuerte contra el suelo destruye el avión al instante; un roce cuesta una pieza.
- **Sonido:** sin música de fondo; efectos grabados reales con licencia CC0 (motores en loop, misiles, explosiones, antiaéreo, alarma), en estéreo según la posición.
- **Controles (siempre en pantalla):** flechas o WASD pilotear, E/Shift acelerar (dos veces: super nitro), Q/Ctrl frenar (aerofrenos), Espacio/J misil, K bomba, L bengalas, H/F metralla, Z o rueda zoom, Esc pausa. En celular, sin deslizar: mantener la mitad izquierda gira la nariz en sentido antihorario y la derecha en sentido horario (volando a la izquierda, izquierda baja y derecha sube); doble toque para el super nitro; botones con nombre a la derecha.

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
