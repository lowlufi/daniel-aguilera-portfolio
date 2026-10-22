import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ClassicRoute } from './sitio/ClassicSite';

// Each experience lives in its own chunk: the island never downloads the
// classic site (Lenis, videos, pages) and the classic site never downloads the
// island. Whichever one matches the landing URL starts downloading right away,
// in parallel with React booting.
const loadIslandGame = () => import('./game/IslandGame');
const loadClassicSite = () => import('./sitio/ClassicSite');
const loadVuelo = () => import('./vuelo/VueloGame');
const landingPath = typeof window !== 'undefined' ? window.location.pathname : '/';
const earlyGame = landingPath === '/' ? loadIslandGame() : null;
const earlyVuelo = landingPath === '/aviones' ? loadVuelo() : null;
const earlyClassic = landingPath !== '/' && landingPath !== '/aviones' ? loadClassicSite() : null;
const IslandGame = lazy(() => earlyGame ?? loadIslandGame());
const VueloGame = lazy(() => earlyVuelo ?? loadVuelo());
const ClassicSite = lazy(() => earlyClassic ?? loadClassicSite());
// The composer is only needed once someone asks to write.
const ContactComposer = lazy(() => import('./sitio/ContactComposer'));

const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Daniel Eduardo — Portafolio interactivo',
    description: 'Explora la isla de Daniel Eduardo: Ingeniero en Informática. Desarrollo web full stack, IoT y soluciones a medida.',
  },
  '/aviones': {
    title: 'Escuadrón Dui — Juego de aviones de Daniel Eduardo',
    description: 'Pilotea el avión de Dui, esquiva misiles y detén a los ratones antes de que lleguen a la despensa. Un juego de Daniel Eduardo.',
  },
  '/clasico': {
    title: 'Daniel Eduardo — Portafolio',
    description: 'Portafolio de Daniel Eduardo — Ingeniero en Informática con mención en gestión de la información. Desarrollo web full stack, IoT y soluciones a medida.',
  },
  '/proyectos': { title: 'Proyectos — Daniel Eduardo', description: 'Proyectos web de Daniel Eduardo: plataformas educativas, e-commerce, medios, música y SaaS.' },
  '/sobre-mi': { title: 'Sobre mí — Daniel Eduardo', description: 'Quién es Daniel Eduardo, Ingeniero en Informática, y las herramientas que usa.' },
  '/privacidad': { title: 'Privacidad — Daniel Eduardo', description: 'Política de privacidad del portafolio de Daniel Eduardo.' },
};

function setMeta(selector: string, attr: string, value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

// The island is drawn with text now, so any browser runs it: no more WebGL
// check sending some visitors straight to the classic version.
function canRunGame() {
  return typeof window !== 'undefined';
}

function getInitialPath() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

const KNOWN_ROUTES = ['/', '/aviones', '/clasico', '/proyectos', '/sobre-mi', '/privacidad'];

export default function App() {
  const [pathname, setPathname] = useState<string>(getInitialPath);
  const [gameSupported] = useState(canRunGame);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerUsed, setComposerUsed] = useState(false);
  const scrollTopRef = useRef<(() => void) | null>(null);
  const openComposer = useCallback(() => {
    setComposerUsed(true);
    setComposerOpen(true);
  }, []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);
  const registerScrollTop = useCallback((fn: (() => void) | null) => {
    scrollTopRef.current = fn;
  }, []);

  const navigate = useCallback((to: string) => {
    if (typeof window === 'undefined') return;
    if (to !== window.location.pathname) {
      window.history.pushState({}, '', to);
      setPathname(to);
      if (scrollTopRef.current) scrollTopRef.current();
      else window.scrollTo({ top: 0 });
    }
  }, []);
  const playGame = useCallback(() => navigate('/'), [navigate]);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  type Route = 'game' | 'vuelo' | ClassicRoute;
  const route: Route =
    pathname === '/' ? (gameSupported ? 'game' : 'home') :
    pathname === '/aviones' ? 'vuelo' :
    pathname === '/clasico' ? 'home' :
    pathname === '/proyectos' ? 'projects' :
    pathname === '/sobre-mi' ? 'about' :
    pathname === '/privacidad' ? 'privacy' :
    KNOWN_ROUTES.includes(pathname) ? 'home' : '404';

  // Per-route title, description, canonical, and noindex on unknown URLs.
  useEffect(() => {
    const meta = ROUTE_META[pathname];
    const url = `https://danieleduardo.cl${meta ? pathname : '/'}`;
    document.title = meta?.title ?? 'Página no encontrada — Daniel Eduardo';
    setMeta('meta[name="description"]', 'content', meta?.description ?? ROUTE_META['/clasico'].description);
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[property="og:url"]', 'content', url);
    let robots = document.head.querySelector('meta[name="robots"]');
    if (!meta) {
      if (!robots) {
        robots = document.createElement('meta');
        robots.setAttribute('name', 'robots');
        document.head.appendChild(robots);
      }
      robots.setAttribute('content', 'noindex');
    } else robots?.remove();
  }, [pathname]);


  const composer = composerUsed && (
    <Suspense fallback={null}>
      <ContactComposer open={composerOpen} onClose={closeComposer} />
    </Suspense>
  );

  if (route === 'vuelo') {
    return (
      <div className="fixed inset-0 bg-[#92d2ff] text-[#5b4636] overflow-hidden">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-cozy text-lg">Preparando el avión…</div>}>
          <VueloGame navigate={navigate} />
        </Suspense>
      </div>
    );
  }

  if (route === 'game') {
    return (
      <div className="fixed inset-0 bg-[#f6b38a] text-[#5b4636] overflow-hidden">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-cozy text-lg">Cargando la isla…</div>}>
          <IslandGame navigate={navigate} openComposer={openComposer} paused={composerOpen} />
        </Suspense>
        {composer}
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={<div className="min-h-screen bg-black" />}>
        <ClassicSite
          route={route}
          pathname={pathname}
          navigate={navigate}
          openComposer={openComposer}
          composerOpen={composerOpen}
          onPlay={gameSupported ? playGame : undefined}
          registerScrollTop={registerScrollTop}
        />
      </Suspense>
      <div className="font-sans text-white">{composer}</div>
    </>
  );
}
