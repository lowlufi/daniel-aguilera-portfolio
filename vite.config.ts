import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import type { OutputBundle, OutputChunk } from 'rollup';

/*
 * The plane game is one big chunk; these groups split off the parts that change
 * least (backdrops and drawing, enemies and physics, sound) so a deploy that only
 * touches the game screen doesn't make players re-download all of it. Each group
 * only imports from groups above it (art <- enemies <- game), never back, so the
 * chunks have no import cycles. Everything still loads at start, in parallel.
 */
const VUELO_GRUPOS: Record<string, string[]> = {
  'vuelo-arte': ['fondo', 'dibujo', 'oceano', 'valparaiso', 'giro', 'transiciones', 'armas-dibujo', 'retratos', 'escenas', 'luces', 'efectos', 'estelas'],
  'vuelo-enemigos': ['jefes', 'gigantes', 'aereos', 'cazas', 'misiles', 'ia', 'fisica-armas', 'fisica-vuelo'],
  'vuelo-sonido': ['audio-batalla', 'sonido'],
};
const GRUPO_DE = new Map(Object.entries(VUELO_GRUPOS).flatMap(([g, ms]) => ms.map((m) => [m, g] as const)));

function manualChunks(id: string) {
  const m = /[\\/]src[\\/]vuelo[\\/]([\w-]+)\.ts$/.exec(id);
  if (m) return GRUPO_DE.get(m[1]);
  // A manual chunk swallows every dependency not assigned elsewhere, so the code
  // shared with the island and the classic site is pinned to its own chunks;
  // otherwise the home page would end up downloading the plane's art.
  if (/[\\/]src[\\/]game[\\/](dulce|audio|world)\.ts$/.test(id)) return 'dulce';
  if (/[\\/]src[\\/]data\.ts$/.test(id)) return 'data';
  // React itself would otherwise follow data.ts; it gets its own long-lived chunk.
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
  return undefined;
}

/**
 * Every chunk a route's chunk needs before it can run (static imports), or also
 * later (dynamic), without crossing into the main entry (which lazy-loads all routes).
 */
function cierre(bundle: OutputBundle, inicio: string, dinamicos: boolean, entrada: string) {
  const vistos = new Set<string>();
  const pila = [inicio];
  while (pila.length) {
    const f = pila.pop()!;
    if (vistos.has(f) || f === entrada) continue;
    vistos.add(f);
    const c = bundle[f] as OutputChunk | undefined;
    if (!c || c.type !== 'chunk') continue;
    pila.push(...c.imports, ...(dinamicos ? c.dynamicImports : []));
  }
  return [...vistos];
}

/** The game's recorded sounds (public/sonidos), so the installed app has them offline. */
function sonidos(publicDir: string) {
  const dir = path.join(publicDir, 'sonidos');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => `sonidos/${f}`) : [];
}

/*
 * Build-time wiring for the per-route boot path, which plain index.html can't
 * express (one HTML for every route, and the CSP forbids inline scripts):
 * - dist/_headers gets a `Link: rel=preload` per landing route, so Cloudflare
 *   sends them as 103 Early Hints and the browser fetches the route's chunks and
 *   font while the HTML is still on its way, instead of after main.js runs.
 * - dist/aviones-sw.js gets the list of files the installed game needs, and a
 *   version derived from them, so it precaches them and drops stale caches.
 */
function rutasCriticas(): Plugin {
  let outDir = 'dist';
  let publicDir = 'public';
  let headers = new Map<string, string[]>();
  let precache: string[] = [];
  return {
    name: 'rutas-criticas',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
      publicDir = c.publicDir;
    },
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk');
      const entry = chunks.find((c) => c.isEntry);
      const ruta = (nombre: string) => chunks.find((c) => c.isDynamicEntry && c.facadeModuleId?.includes(nombre));
      const asset = (re: RegExp) => Object.keys(bundle).find((f) => re.test(f));
      const css = asset(/^assets\/index-[\w-]+\.css$/);
      const fuente = (n: string) => asset(new RegExp(`^assets/${n}-[\\w-]{8}\\.woff2$`));
      if (!entry) return;
      const precarga = (raiz: string | undefined, fuentes: (string | undefined)[]) => {
        if (!raiz) return [];
        // The entry's own imports are already modulepreloaded by index.html.
        const enHtml = new Set(cierre(bundle, entry.fileName, false, ''));
        const js = cierre(bundle, raiz, false, entry.fileName).filter((f) => !enHtml.has(f));
        return [
          ...js.map((f) => `</${f}>; rel=preload; as=script; crossorigin`),
          ...fuentes.filter(Boolean).map((f) => `</${f}>; rel=preload; as=font; type="font/woff2"; crossorigin`),
        ];
      };
      const isla = ruta('/src/game/IslandGame.tsx')?.fileName;
      const vuelo = ruta('/src/vuelo/VueloGame.tsx')?.fileName;
      const clasico = ruta('/src/sitio/ClassicSite.tsx')?.fileName;
      headers = new Map([
        ['/', precarga(vuelo, [fuente('nunito-latin')])],
        ['/aviones', precarga(vuelo, [fuente('nunito-latin')])],
        ['/isla', precarga(isla, [fuente('nunito-latin')])],
        ...['/clasico', '/proyectos', '/sobre-mi'].map((r) => [r, precarga(clasico, [fuente('inter-latin')])] as [string, string[]]),
      ]);
      precache = vuelo
        ? [
            entry.fileName,
            ...cierre(bundle, vuelo, true, entry.fileName),
            ...(css ? [css] : []),
            ...['nunito-latin', 'fredoka-latin'].map(fuente).filter((f): f is string => !!f),
            ...sonidos(publicDir),
          ].map((f) => `/${f}`)
        : [];
    },
    closeBundle: {
      order: 'post',
      handler() {
        const hPath = path.join(outDir, '_headers');
        if (existsSync(hPath) && headers.size) {
          const lineas = readFileSync(hPath, 'utf8').split('\n');
          for (const [ruta, links] of headers) {
            if (!links.length) continue;
            const linea = `  Link: ${links.join(', ')}`;
            const i = lineas.findIndex((l) => l.trimEnd() === ruta);
            if (i >= 0) lineas.splice(i + 1, 0, linea);
            else lineas.push('', ruta, linea);
          }
          writeFileSync(hPath, lineas.join('\n'));
        }
        // Without a 404.html Cloudflare Pages treats the site as an SPA and answers
        // every unknown URL with index.html and a 200. With it, unknown URLs get a real
        // 404 status, and the app (same HTML) shows its «not found» page.
        const indexPath = path.join(outDir, 'index.html');
        if (existsSync(indexPath)) copyFileSync(indexPath, path.join(outDir, '404.html'));
        const swPath = path.join(outDir, 'aviones-sw.js');
        if (existsSync(swPath) && precache.length) {
          const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 10);
          const sw = readFileSync(swPath, 'utf8')
            .replace(/const VERSION = '[^']*';/, `const VERSION = 'escuadron-dui-${version}';`)
            .replace(/const PRECACHE = \[\];/, `const PRECACHE = ${JSON.stringify(precache)};`);
          writeFileSync(swPath, sw);
        }
      },
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), rutasCriticas()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: { manualChunks },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
