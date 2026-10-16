import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from 'motion/react';
import Lenis from 'lenis';
import { PROJECTS, SKILLS, SOCIAL, type Project } from '../data';
import { isModestDevice, isSlowConnection } from './equipo';
import {
  Github,
  Linkedin,
  Mail,
  Instagram,
  ExternalLink,
  ArrowUpRight,
  ArrowLeft,
  Brain,
  GraduationCap,
  Leaf,
  Newspaper,
  Music,
  Headphones,
  AudioWaveform,
  Scissors,
  Search,
  CornerDownLeft,
  Home,
  Folder,
  User,
  Sparkles,
  Code2,
  Cpu,
  Globe,
  Zap,
  Gauge,
  Palette,
  Shield,
  X,
  Gamepad2,
  type LucideIcon,
} from 'lucide-react';

type Theme = 'night' | 'sunset' | 'aurora';

// Originals (1924×1076, ~14 MB each) for large screens. Phones, tablets and
// modest devices get a 720p re-encode of the same clip (~0.3–0.8 MB each).
const VIDEOS: Record<Theme, string> = {
  night: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4',
  sunset: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_171521_25968ba2-b594-4b32-aab7-f6b69398a6fa.mp4',
  aurora: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260330_145725_08886141-ed95-4a8e-8d6d-b75eaadce638.mp4',
};
const VIDEOS_LIGHT: Record<Theme, string> = {
  night: '/videos/fondo-night-720.mp4',
  sunset: '/videos/fondo-sunset-720.mp4',
  aurora: '/videos/fondo-aurora-720.mp4',
};

const THEME_ORDER: Theme[] = ['night', 'sunset', 'aurora'];
const THEME_LABELS: Record<Theme, string> = {
  night: 'Noche',
  sunset: 'Atardecer',
  aurora: 'Aurora',
};

const FADE_MS = 700;
const SWAP_LEAD_S = 0.7;


function useCanHover() {
  const [canHover, setCanHover] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return canHover;
}

function useIsMac() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);
  return isMac;
}

const FEATURED = PROJECTS.filter((p) => p.featured);

const ALL_TAGS = Array.from(new Set(PROJECTS.flatMap((p) => p.tags))).sort();


type ProjectCardProps = {
  project: Project;
  index: number;
  reduceMotion: boolean;
  canHover: boolean;
  compact?: boolean;
  key?: number | string;
};

function ProjectCard({ project, index, reduceMotion, canHover, compact = false }: ProjectCardProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hoverGlow = useMotionValue(0);
  const smoothGlow = useSpring(hoverGlow, { stiffness: 180, damping: 26 });

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const sRotateX = useSpring(rotateX, { stiffness: 220, damping: 22 });
  const sRotateY = useSpring(rotateY, { stiffness: 220, damping: 22 });

  const tiltEnabled = canHover && !reduceMotion;

  function handleMouseEnter() {
    if (!tiltEnabled) return;
    hoverGlow.set(1);
  }

  function handleMouseLeave() {
    hoverGlow.set(0);
    rotateX.set(0);
    rotateY.set(0);
  }

  function handleMouseMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (!tiltEnabled) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(x * 12);
    rotateX.set(-y * 12);
  }

  const padding = compact ? 'p-6 md:p-8' : 'p-7 md:p-10';
  const titleClass = compact ? 'text-xl md:text-[1.4rem]' : 'text-2xl md:text-[1.6rem]';
  const bodyClass = compact ? 'text-[0.85rem] md:text-[0.9rem] mb-6' : 'text-sm md:text-[0.95rem] mb-8';

  return (
    <motion.div
      ref={wrapperRef}
      layout
      onMouseEnter={tiltEnabled ? handleMouseEnter : undefined}
      onMouseLeave={tiltEnabled ? handleMouseLeave : undefined}
      onMouseMove={tiltEnabled ? handleMouseMove : undefined}
      className="relative"
      style={tiltEnabled ? { perspective: 1400 } : undefined}
      transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
    >
      {canHover && (
        <motion.div
          aria-hidden
          style={{ opacity: smoothGlow }}
          className="absolute -inset-4 rounded-[2.5rem] blur-2xl pointer-events-none bg-white/10"
        />
      )}

      <motion.div
        style={tiltEnabled ? { rotateX: sRotateX, rotateY: sRotateY, transformStyle: 'preserve-3d' } : undefined}
        className="relative"
      >
        <motion.a
          href={project.comingSoon ? undefined : project.url}
          target={project.comingSoon ? undefined : '_blank'}
          rel={project.comingSoon ? undefined : 'noopener noreferrer'}
          aria-disabled={project.comingSoon || undefined}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          whileTap={project.comingSoon || reduceMotion ? undefined : { scale: 0.97 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={reduceMotion ? { duration: 0.3 } : { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: index * 0.06 }}
          style={{ contain: 'paint' }}
          className={`liquid-glass-strong group flex flex-col ${padding} rounded-[1.5rem] ${project.comingSoon ? 'cursor-default' : ''}`}
        >
          <div className="relative flex items-center justify-between mb-7">
            <div className="liquid-glass p-3 rounded-[0.75rem]">
              <project.icon size={20} className="text-white" strokeWidth={1.5} />
            </div>
            {project.comingSoon ? (
              <span className="liquid-glass rounded-full px-2.5 py-1 text-[9.5px] tracking-[0.18em] uppercase text-white/85 whitespace-nowrap">
                Próximamente
              </span>
            ) : (
              <span className="opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                <ExternalLink size={16} className="text-white/70 group-hover:text-white" strokeWidth={1.5} />
              </span>
            )}
          </div>

          <h3 className={`relative ${titleClass} mb-3 font-display tracking-tight`}>{project.title}</h3>
          <p className={`relative leading-relaxed font-light ${bodyClass} flex-1 text-white/75`}>
            {project.description}
          </p>

          <div className="relative flex flex-wrap gap-1.5 mt-auto">
            {project.tags.map((tag) => (
              <span key={tag} className="liquid-glass rounded-full px-3 py-1 text-[10.5px] tracking-wide text-white/85 whitespace-nowrap">
                {tag}
              </span>
            ))}
          </div>
        </motion.a>
      </motion.div>
    </motion.div>
  );
}

type PageProps = {
  navigate: (to: string) => void;
  reduceMotion: boolean;
  canHover: boolean;
  openComposer: () => void;
};

function HomePage({ navigate, reduceMotion, canHover, openComposer }: PageProps) {
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 600], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 600], [1, 0.95]);

  return (
    <>
      {/* Hero */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative flex flex-col items-center justify-start min-h-[100svh] px-6 text-center pt-[12svh] md:pt-[14svh]"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-6 max-w-4xl"
        >
          <h1
            className="font-light tracking-tight font-display"
            style={{ fontSize: 'clamp(2rem, 11vw, 8rem)', lineHeight: 1.02 }}
          >
            Daniel <br />
            <span className="font-semibold italic text-white/90">Eduardo</span>
          </h1>
          <p className="max-w-2xl mx-auto text-sm md:text-xl font-light text-white/65 leading-relaxed">
            Ingeniero en Informática con mención en gestión de la información. Siempre apasionado por la tecnología y por innovar a partir de ella en todas sus formas.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.4 }}
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          style={{ bottom: 'max(3rem, calc(env(safe-area-inset-bottom) + 1.5rem))' }}
        >
          <span className="text-[10px] tracking-[0.24em] uppercase text-white/55">Desliza para explorar</span>
          <div className="w-[1px] h-12 bg-gradient-to-b from-white/40 to-transparent" />
        </motion.div>
      </motion.section>

      {/* Selected Work */}
      <section className="px-5 sm:px-6 py-20 md:py-32 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-16 md:mb-20"
        >
          <h2 className="text-3xl md:text-5xl font-display font-light flex flex-col md:flex-row md:items-baseline gap-3 md:gap-4 tracking-tight">
            <span>Proyectos Destacados</span>
            <span className="text-[10px] md:text-xs font-sans tracking-[0.24em] uppercase pb-1 md:flex-1 md:border-b text-white/55 border-white/15">Creativo y Técnico</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7">
          {FEATURED.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} reduceMotion={reduceMotion} canHover={canHover} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-12 md:mt-16 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <motion.a
            href="/proyectos"
            onClick={(e) => {
              e.preventDefault();
              navigate('/proyectos');
            }}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className="liquid-glass group inline-flex items-center gap-3 px-6 py-3 rounded-full text-sm tracking-wide text-white/85 hover:text-white transition-colors"
          >
            Ver todos los proyectos
            <ArrowUpRight size={15} strokeWidth={1.5} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </motion.a>
          <motion.a
            href="/sobre-mi"
            onClick={(e) => {
              e.preventDefault();
              navigate('/sobre-mi');
            }}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className="inline-flex items-center gap-2 px-5 py-3 text-sm tracking-wide text-white/55 hover:text-white transition-colors"
          >
            Sobre mí
            <ArrowUpRight size={14} strokeWidth={1.5} className="opacity-70" />
          </motion.a>
        </motion.div>
      </section>

      {/* Footer */}
      <section className="px-6 py-24 border-t border-white/10 text-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] blur-[120px] rounded-[100%] pointer-events-none bg-white/5" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative z-10 space-y-8"
        >
          <h2
            className="font-display font-light tracking-tight"
            style={{ fontSize: 'clamp(2.25rem, 7vw, 4.5rem)', lineHeight: 1.05 }}
          >
            Construyamos algo<br/> <span className="italic text-white/55">extraordinario</span>.
          </h2>
          <p className="max-w-md mx-auto text-white/60">
            Actualmente abierto a nuevas oportunidades y proyectos interesantes.
          </p>
          <motion.button
            type="button"
            onClick={openComposer}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className="inline-flex items-center gap-2 px-7 py-3.5 mt-8 rounded-full font-medium transition-transform hover:scale-105 bg-white text-black"
          >
            Contáctame
            <Mail size={15} strokeWidth={2} />
          </motion.button>

          <div className="flex items-center justify-center gap-2 pt-4">
            <a href={SOCIAL.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="inline-flex items-center justify-center w-11 h-11 rounded-full text-white/60 hover:text-white hover:bg-white/5 transition-colors">
              <Github strokeWidth={1.5} size={18} />
            </a>
            <a href={SOCIAL.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="inline-flex items-center justify-center w-11 h-11 rounded-full text-white/60 hover:text-white hover:bg-white/5 transition-colors">
              <Linkedin strokeWidth={1.5} size={18} />
            </a>
            <a href={SOCIAL.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="inline-flex items-center justify-center w-11 h-11 rounded-full text-white/60 hover:text-white hover:bg-white/5 transition-colors">
              <Instagram strokeWidth={1.5} size={18} />
            </a>
          </div>
        </motion.div>

        <div className="mt-32 pt-8 text-[10px] uppercase tracking-[0.24em] flex flex-col md:flex-row items-center justify-between gap-4 max-w-7xl mx-auto border-t relative z-10 text-white/55 border-white/5">
          <span>© {new Date().getFullYear()} Daniel Eduardo</span>
          <div className="flex items-center gap-5">
            <a
              href="/sobre-mi"
              onClick={(e) => { e.preventDefault(); navigate('/sobre-mi'); }}
              className="hover:text-white/70 transition-colors"
            >
              Sobre mí
            </a>
            <a
              href="/privacidad"
              onClick={(e) => { e.preventDefault(); navigate('/privacidad'); }}
              className="hover:text-white/70 transition-colors"
            >
              Privacidad
            </a>
            <span>Todos los derechos reservados</span>
          </div>
        </div>
      </section>
    </>
  );
}

function TagFilter({ active, onChange }: { active: string | null; onChange: (tag: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2 md:gap-2.5 mb-10 md:mb-12">
      <button
        onClick={() => onChange(null)}
        aria-pressed={active === null}
        className={`liquid-glass px-3.5 py-2 md:py-1.5 rounded-full text-[11.5px] md:text-xs tracking-wide transition-colors ${
          active === null ? 'text-white bg-white/15' : 'text-white/65 hover:text-white'
        }`}
      >
        Todos
        <span className="ml-1.5 text-white/55">{PROJECTS.length}</span>
      </button>
      {ALL_TAGS.map((tag) => {
        const count = PROJECTS.filter((p) => p.tags.includes(tag)).length;
        const isActive = active === tag;
        return (
          <button
            key={tag}
            onClick={() => onChange(isActive ? null : tag)}
            aria-pressed={isActive}
            className={`liquid-glass px-3.5 py-2 md:py-1.5 rounded-full text-[11.5px] md:text-xs tracking-wide transition-colors ${
              isActive ? 'text-white bg-white/15' : 'text-white/65 hover:text-white'
            }`}
          >
            {tag}
            <span className="ml-1.5 text-white/55">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectsPage({ navigate, reduceMotion, canHover, openComposer }: PageProps) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = useMemo(
    () => (activeTag ? PROJECTS.filter((p) => p.tags.includes(activeTag)) : PROJECTS),
    [activeTag],
  );

  return (
    <>
      <section className="px-6 pt-24 md:pt-32 pb-8 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <a
            href="/clasico"
            onClick={(e) => {
              e.preventDefault();
              navigate('/clasico');
            }}
            className="liquid-glass inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wide text-white/85 hover:text-white transition-colors mb-10"
          >
            <ArrowLeft size={14} strokeWidth={1.5} />
            Volver al inicio
          </a>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-light tracking-tight">
            Proyectos
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-white/65 font-light">
            Una selección de sitios, plataformas y experiencias web que he diseñado y construido — desde catálogos locales hasta plataformas educativas y sistemas internos.
          </p>
        </motion.div>
      </section>

      <section className="px-6 pb-32 max-w-7xl mx-auto">
        <h2 className="sr-only">Lista de proyectos</h2>
        <TagFilter active={activeTag} onChange={setActiveTag} />

        <motion.div
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={index}
                reduceMotion={reduceMotion}
                canHover={canHover}
                compact
              />
            ))}
          </AnimatePresence>
        </motion.div>

        {filtered.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-white/60 py-16"
          >
            Sin proyectos con esa etiqueta — todavía.
          </motion.p>
        )}
      </section>

      <section className="px-6 py-24 border-t border-white/10 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative z-10 space-y-6 max-w-2xl mx-auto"
        >
          <h2 className="text-3xl md:text-4xl font-display font-light tracking-tight italic text-white/85">
            ¿Tienes un proyecto en mente?
          </h2>
          <motion.button
            type="button"
            onClick={openComposer}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className="inline-flex items-center gap-2 px-6 py-3 mt-2 rounded-full font-medium transition-transform hover:scale-105 bg-white text-black text-sm"
          >
            Conversemos
            <Mail size={14} strokeWidth={2} />
          </motion.button>
        </motion.div>
      </section>
    </>
  );
}

function AboutPage({ navigate, reduceMotion, openComposer }: PageProps) {
  return (
    <>
      <section className="px-6 pt-24 md:pt-32 pb-12 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <a
            href="/clasico"
            onClick={(e) => {
              e.preventDefault();
              navigate('/clasico');
            }}
            className="liquid-glass inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wide text-white/85 hover:text-white transition-colors mb-10"
          >
            <ArrowLeft size={14} strokeWidth={1.5} />
            Volver al inicio
          </a>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-light tracking-tight">
            Sobre <span className="italic text-white/85">mí</span>
          </h1>
          <p className="mt-6 max-w-3xl text-base md:text-lg text-white/70 font-light leading-relaxed">
            Soy Daniel Eduardo, Ingeniero en Informática con mención en gestión de la información por la Universidad de Playa Ancha. Construyo experiencias web, plataformas educativas, e-commerce y sistemas IoT — uniendo el detalle artesanal con el rigor técnico.
          </p>
          <p className="mt-4 max-w-3xl text-base md:text-lg text-white/55 font-light leading-relaxed">
            Me obsesiona la artesanía digital: que el código sea simple, que la interfaz se sienta natural, y que cada microinteracción tenga una razón.
          </p>
        </motion.div>
      </section>

      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-2xl md:text-3xl font-display font-light tracking-tight mb-8 flex items-baseline gap-3"
        >
          <span>Stack &amp; oficio</span>
          <span className="text-[10px] tracking-[0.24em] uppercase text-white/55">Lo que uso</span>
        </motion.h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-6">
          {SKILLS.map((group, i) => (
            <motion.div
              key={group.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={reduceMotion ? { duration: 0.3 } : { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="liquid-glass-strong rounded-[1.25rem] p-6 md:p-7"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="liquid-glass p-2.5 rounded-[0.65rem]">
                  <group.icon size={18} className="text-white" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg md:text-xl font-display tracking-tight">{group.title}</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <span key={item} className="liquid-glass rounded-full px-3 py-1 text-[10.5px] tracking-wide text-white/85">
                    {item}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-24 max-w-5xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-2xl md:text-3xl font-display font-light tracking-tight mb-8 flex items-baseline gap-3"
        >
          <span>Lo que me mueve</span>
          <span className="text-[10px] tracking-[0.24em] uppercase text-white/55">Principios</span>
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          {[
            { icon: Sparkles, title: 'Artesanía digital', body: 'Código simple, interfaces que se sienten naturales. Lo invisible cuando funciona, evidente cuando no.' },
            { icon: Palette, title: 'Detalle obsesivo', body: 'Microinteracciones, easing, tipografía. Lo que separa "funciona" de "se siente bien".' },
          ].map((v, i) => (
            <motion.div
              key={v.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={reduceMotion ? { duration: 0.3 } : { duration: 0.6, delay: i * 0.1 }}
              className="liquid-glass-strong rounded-[1.25rem] p-6 md:p-7"
            >
              <div className="liquid-glass inline-flex p-2.5 rounded-[0.65rem] mb-4">
                <v.icon size={18} className="text-white" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg md:text-xl font-display tracking-tight mb-2">{v.title}</h3>
              <p className="text-sm md:text-[0.92rem] text-white/65 leading-relaxed font-light">{v.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="px-6 py-24 border-t border-white/10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="space-y-6 max-w-2xl mx-auto"
        >
          <h2 className="text-3xl md:text-4xl font-display font-light tracking-tight italic text-white/85">
            Hablemos.
          </h2>
          <motion.button
            type="button"
            onClick={openComposer}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className="inline-flex items-center gap-2 px-6 py-3 mt-2 rounded-full font-medium transition-transform hover:scale-105 bg-white text-black text-sm"
          >
            Escríbeme
            <Mail size={14} strokeWidth={2} />
          </motion.button>
        </motion.div>
      </section>
    </>
  );
}

function PrivacyPage({ navigate }: PageProps) {
  return (
    <section className="px-6 pt-24 md:pt-32 pb-32 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <a
          href="/clasico"
          onClick={(e) => {
            e.preventDefault();
            navigate('/clasico');
          }}
          className="liquid-glass inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wide text-white/85 hover:text-white transition-colors mb-10"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Volver al inicio
        </a>

        <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight mb-4">
          Privacidad y Cookies
        </h1>
        <p className="text-sm text-white/50 mb-10">Última actualización: {new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long' })}</p>

        <div className="space-y-8 text-white/75 leading-relaxed">
          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Resumen</h2>
            <p>Este sitio es un portafolio personal estático. <strong className="text-white">No recopilo datos personales, no uso analíticas, no rastreo a quienes lo visitan y no comparto información con terceros.</strong></p>
          </section>

          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Datos personales</h2>
            <p>El único dato personal que puede llegarme es voluntariamente, cuando una persona decide escribirme al correo público (<a className="underline hover:no-underline" href={`mailto:${SOCIAL.email}`}>{SOCIAL.email}</a>). En ese caso, el mensaje queda almacenado en mi servicio de correo y será usado únicamente para responder.</p>
          </section>

          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Cookies</h2>
            <p>El sitio no instala cookies de marketing, analítica ni publicidad. Las únicas cookies presentes son:</p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong className="text-white">Cloudflare (<code className="text-white/80 text-sm">__cf_bm</code>):</strong> cookie técnica esencial para protección anti-bot. No identifica a la persona usuaria.</li>
              <li><strong className="text-white">Preferencias locales:</strong> en <code className="text-white/80 text-sm">localStorage</code> se guarda el aviso de cookies dismissado y, opcionalmente, el tema visual elegido. No son cookies y no se envían a ningún servidor.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Servicios de terceros</h2>
            <p>Para funcionar, el sitio carga recursos desde:</p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong className="text-white">Cloudflare Pages</strong> — hosting y CDN.</li>
              <li><strong className="text-white">Amazon CloudFront</strong> — entrega de los videos de fondo.</li>
              <li><strong className="text-white">Google Fonts</strong> — tipografías (Inter, Playfair Display).</li>
            </ul>
            <p className="mt-3">Estos servicios pueden registrar metadatos técnicos (IP, agente de usuario, hora) por motivos de seguridad y entrega de contenido. Consulta sus políticas para más detalle.</p>
          </section>

          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Tus derechos</h2>
            <p>Según la Ley 19.628 sobre Protección de la Vida Privada y la Ley 21.719 (Protección de Datos Personales) de Chile, tienes derecho a acceder, rectificar, cancelar y oponerte al tratamiento de tus datos. Para ejercerlos, escríbeme a <a className="underline hover:no-underline" href={`mailto:${SOCIAL.email}`}>{SOCIAL.email}</a>.</p>
          </section>

          <section>
            <h2 className="text-xl md:text-2xl font-display italic text-white/90 mb-3">Cambios</h2>
            <p>Si actualizo esta política, la nueva versión queda publicada en esta misma página con la fecha de la última revisión arriba.</p>
          </section>
        </div>
      </motion.div>
    </section>
  );
}

function NotFoundPage({ navigate }: PageProps) {
  return (
    <section className="flex flex-col items-center justify-center min-h-[100svh] px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-6"
      >
        <p className="text-[11px] tracking-[0.3em] uppercase text-white/60">Error 404</p>
        <h1
          className="font-display font-light italic text-white/90 tracking-tight"
          style={{ fontSize: 'clamp(3rem, 14vw, 9rem)', lineHeight: 0.95 }}
        >
          Perdido<br/>en el espacio
        </h1>
        <p className="max-w-md mx-auto text-white/60 text-sm md:text-base">
          La página que buscas no existe o cambió de órbita.
        </p>
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="/clasico"
            onClick={(e) => { e.preventDefault(); navigate('/clasico'); }}
            className="liquid-glass px-6 py-3 rounded-full text-sm tracking-wide text-white/90 hover:text-white transition-colors"
          >
            Volver al inicio
          </a>
          <a
            href="/proyectos"
            onClick={(e) => { e.preventDefault(); navigate('/proyectos'); }}
            className="text-sm text-white/60 hover:text-white transition-colors underline-offset-4 hover:underline"
          >
            Ver proyectos
          </a>
        </div>
      </motion.div>
    </section>
  );
}

function CookieNotice({ navigate }: { navigate: (to: string) => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const dismissed = window.localStorage.getItem('cookie-notice-dismissed');
      if (!dismissed) {
        const t = setTimeout(() => setShow(true), 1200);
        return () => clearTimeout(t);
      }
    } catch {
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem('cookie-notice-dismissed', '1');
    } catch {
      // ignore
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label="Aviso de cookies"
      className="liquid-glass-strong !fixed left-3 right-3 md:left-auto md:right-6 md:max-w-sm z-40 rounded-[1.25rem] p-4 md:p-5 pr-9 md:pr-12"
      style={{ bottom: 'max(0.75rem, calc(env(safe-area-inset-bottom) + 0.5rem))' }}
    >
      <button
        onClick={dismiss}
        aria-label="Cerrar aviso"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={14} strokeWidth={1.8} />
      </button>

      <p className="text-[12.5px] md:text-sm text-white/85 leading-relaxed">
        Solo una cookie técnica de Cloudflare. <span className="text-white/55">Sin analíticas, sin rastreo.</span>
      </p>

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          onClick={(e) => {
            e.preventDefault();
            navigate('/privacidad');
            dismiss();
          }}
          className="text-[11.5px] md:text-xs tracking-wide px-3 py-1.5 rounded-full text-white/70 hover:text-white transition-colors"
        >
          Más info
        </button>
        <button
          onClick={dismiss}
          className="text-[11.5px] md:text-xs tracking-wide font-medium px-3.5 py-1.5 rounded-full bg-white text-black hover:opacity-90 transition-opacity"
        >
          Entendido
        </button>
      </div>
    </motion.div>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 32, mass: 0.4 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX, transformOrigin: '0% 50%' }}
      className="fixed top-0 left-0 right-0 h-[2px] z-50 bg-gradient-to-r from-white/70 via-white to-white/70 pointer-events-none"
    />
  );
}

type TopControlsProps = {
  theme: Theme;
  setManualTheme: (t: Theme) => void;
  openPalette: () => void;
  isMac: boolean;
  onPlay?: () => void;
};

function TopControls({ theme, setManualTheme, openPalette, isMac, onPlay }: TopControlsProps) {
  const shortcut = isMac ? '⌘K' : 'Ctrl K';
  return (
    <div className="fixed top-4 right-4 md:top-5 md:right-5 z-40 flex items-center gap-2">
      {onPlay && (
        <button
          onClick={onPlay}
          aria-label="Abrir modo juego"
          title="Modo juego"
          className="liquid-glass group inline-flex items-center gap-2 h-11 px-3.5 rounded-full text-white/80 hover:text-white transition-colors"
        >
          <Gamepad2 size={16} strokeWidth={1.6} />
          <span className="hidden md:inline text-[10.5px] tracking-[0.18em] uppercase text-white/55 group-hover:text-white/80 transition-colors">
            Jugar
          </span>
        </button>
      )}
      <button
        onClick={openPalette}
        aria-label={`Abrir buscador (${shortcut})`}
        title={`Buscador (${shortcut})`}
        className="liquid-glass group inline-flex items-center gap-2 h-11 pl-3.5 pr-3 md:pr-3.5 rounded-full text-white/80 hover:text-white transition-colors"
      >
        <Search size={15} strokeWidth={1.6} />
        <span className="hidden md:inline text-[10.5px] tracking-[0.18em] uppercase text-white/55 group-hover:text-white/80 transition-colors">
          {shortcut}
        </span>
      </button>

      <div className="liquid-glass inline-flex items-center gap-0.5 h-11 px-1.5 rounded-full">
        {THEME_ORDER.map((t) => {
          const active = theme === t;
          return (
            <button
              key={t}
              onClick={() => setManualTheme(t)}
              aria-pressed={active}
              aria-label={`Tema ${THEME_LABELS[t]}`}
              title={THEME_LABELS[t]}
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors"
            >
              <span
                aria-hidden
                className={`block rounded-full transition-all duration-300 ${active ? 'w-3 h-3' : 'w-2.5 h-2.5 opacity-50'}`}
                style={{
                  background:
                    t === 'night' ? 'linear-gradient(135deg,#9aa6ff,#3f4d8a)' :
                    t === 'sunset' ? 'linear-gradient(135deg,#ffb887,#c8467a)' :
                    'linear-gradient(135deg,#9cf2c9,#6e7df2)',
                  boxShadow: active ? '0 0 0 1px rgba(255,255,255,0.6), 0 0 12px rgba(255,255,255,0.25)' : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

type CommandItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  action: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  navigate: (to: string) => void;
  setManualTheme: (t: Theme) => void;
  openComposer: () => void;
  isMac: boolean;
};

function CommandPalette({ open, onClose, navigate, setManualTheme, openComposer, isMac }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = [
      { id: 'p:game', group: 'Páginas', label: 'Modo juego (isla)', icon: Gamepad2, keywords: 'juego isla ascii', action: () => navigate('/') },
      { id: 'p:home', group: 'Páginas', label: 'Inicio (versión clásica)', icon: Home, action: () => navigate('/clasico') },
      { id: 'p:projects', group: 'Páginas', label: 'Proyectos', icon: Folder, action: () => navigate('/proyectos') },
      { id: 'p:about', group: 'Páginas', label: 'Sobre mí', icon: User, action: () => navigate('/sobre-mi') },
      { id: 'p:privacy', group: 'Páginas', label: 'Privacidad', icon: Shield, action: () => navigate('/privacidad') },
    ];

    const projects: CommandItem[] = PROJECTS.map((p) => ({
      id: `pr:${p.id}`,
      group: 'Proyectos',
      label: p.title,
      hint: p.comingSoon ? 'Próximamente' : p.url.replace(/^https?:\/\//, ''),
      icon: p.icon,
      keywords: p.tags.join(' '),
      action: () => {
        if (p.comingSoon) {
          navigate('/proyectos');
          return;
        }
        window.open(p.url, '_blank', 'noopener,noreferrer');
      },
    }));

    const themes: CommandItem[] = THEME_ORDER.map((t) => ({
      id: `t:${t}`,
      group: 'Tema',
      label: `Tema: ${THEME_LABELS[t]}`,
      icon: Sparkles,
      action: () => setManualTheme(t),
    }));

    const contact: CommandItem[] = [
      { id: 'c:compose', group: 'Contacto', label: 'Escribir un correo', hint: SOCIAL.email, icon: Mail, keywords: 'email mail contacto mensaje hablar escribir composer', action: openComposer },
      { id: 'c:github', group: 'Contacto', label: 'GitHub', hint: SOCIAL.github.replace(/^https?:\/\//, ''), icon: Github, action: () => window.open(SOCIAL.github, '_blank', 'noopener,noreferrer') },
      { id: 'c:linkedin', group: 'Contacto', label: 'LinkedIn', hint: 'linkedin.com/in/danielaguileracampusano', icon: Linkedin, action: () => window.open(SOCIAL.linkedin, '_blank', 'noopener,noreferrer') },
      { id: 'c:instagram', group: 'Contacto', label: 'Instagram', hint: '@daanieleduardo', icon: Instagram, action: () => window.open(SOCIAL.instagram, '_blank', 'noopener,noreferrer') },
    ];

    return [...pages, ...projects, ...themes, ...contact];
  }, [navigate, setManualTheme, openComposer]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const haystack = `${it.label} ${it.hint ?? ''} ${it.keywords ?? ''} ${it.group}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group) ?? [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(filtered.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[selected];
        if (it) {
          it.action();
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, selected, onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[5svh] sm:pt-[10svh] md:pt-[16svh] px-3 sm:px-4"
          onClick={onClose}
          role="dialog"
          aria-label="Buscador y atajos"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="liquid-glass-strong relative w-full max-w-xl rounded-2xl overflow-hidden flex flex-col max-h-[88svh]"
          >
            <div className="flex items-center gap-3 px-4 md:px-5 py-3 md:py-3.5 border-b border-white/10 shrink-0">
              <Search size={16} className="text-white/55 shrink-0" strokeWidth={1.6} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Buscar páginas, proyectos, temas o contacto"
                placeholder="Buscar páginas, proyectos…"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/50 text-base"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div data-lenis-prevent className="flex-1 overflow-y-auto py-2 overscroll-contain">
              {filtered.length === 0 && (
                <p className="text-center text-white/60 text-sm py-10 px-4">
                  Sin resultados para «{query}».
                </p>
              )}
              {grouped.map(([group, list]) => (
                <div key={group} className="py-1">
                  <div className="px-4 md:px-5 pt-2 pb-1 text-[10px] tracking-[0.2em] uppercase text-white/55">{group}</div>
                  {list.map((it) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const active = idx === selected;
                    return (
                      <button
                        key={it.id}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => { it.action(); onClose(); }}
                        className={`w-full flex items-center gap-3 px-4 md:px-5 py-3 md:py-2.5 text-left transition-colors ${
                          active ? 'bg-white/10 text-white' : 'text-white/80 active:bg-white/10 hover:bg-white/5'
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-8 h-8 md:w-7 md:h-7 rounded-md shrink-0 ${active ? 'bg-white/15' : 'bg-white/5'}`}>
                          <it.icon size={15} strokeWidth={1.6} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] md:text-sm truncate">{it.label}</span>
                          {it.hint && <span className="block text-[11px] text-white/60 truncate">{it.hint}</span>}
                        </span>
                        {active && (
                          <CornerDownLeft size={13} className="text-white/55 shrink-0 hidden md:block" strokeWidth={1.7} />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="hidden md:flex border-t border-white/10 px-4 md:px-5 py-2 items-center gap-3 text-[10.5px] tracking-[0.16em] uppercase text-white/55 shrink-0">
              <span><kbd className="text-white/70 font-sans">↑↓</kbd> navegar</span>
              <span><kbd className="text-white/70 font-sans">↵</kbd> abrir</span>
              <span className="ml-auto"><kbd className="text-white/70 font-sans">{isMac ? '⌘' : 'Ctrl'} K</kbd> cerrar</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function loadStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem('preferred-theme');
    if (v === 'night' || v === 'sunset' || v === 'aurora') return v;
  } catch {
    // ignore
  }
  return null;
}

// Each background video weighs ~14 MB. Only the one on screen is downloaded;
// the next one starts loading this many seconds before the automatic swap.
const PRELOAD_NEXT_S = 8;

const overlayByTheme: Record<Theme, string> = {
  night: 'bg-gradient-to-b from-black/20 via-black/45 to-black/85',
  sunset: 'bg-gradient-to-b from-orange-950/30 via-black/30 to-black/70',
  aurora: 'bg-gradient-to-b from-black/10 via-black/20 to-black/55',
};
const fallbackByTheme: Record<Theme, string> = {
  night: 'bg-gradient-to-br from-indigo-950 via-slate-900 to-black',
  sunset: 'bg-gradient-to-br from-orange-900 via-rose-900 to-slate-900',
  aurora: 'bg-gradient-to-br from-violet-900 via-indigo-950 to-black',
};

function nextTheme(t: Theme): Theme {
  return THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length];
}

function BackgroundVideos({ theme, onEnded, light }: { theme: Theme; onEnded: () => void; light: boolean }) {
  const sources = light ? VIDEOS_LIGHT : VIDEOS;
  const refs = useRef<Record<Theme, HTMLVideoElement | null>>({ night: null, sunset: null, aurora: null });
  // Theme whose video is ready and fading in; the previous one stays visible meanwhile.
  const [shown, setShown] = useState<Theme | null>(null);
  const [wanted, setWanted] = useState<Record<Theme, boolean>>(() => ({ night: false, sunset: false, aurora: false, [theme]: true }));
  const want = useCallback((t: Theme) => setWanted((w) => (w[t] ? w : { ...w, [t]: true })), []);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    want(theme);
    const v = refs.current[theme];
    if (!v) return;
    const start = () => {
      v.currentTime = 0;
      v.play().catch(() => {});
      setShown(theme);
    };
    if (v.readyState >= 3) {
      start();
      return;
    }
    v.addEventListener('canplay', start, { once: true });
    return () => v.removeEventListener('canplay', start);
  }, [theme, want, wanted[theme]]);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => {
      THEME_ORDER.forEach((t) => {
        if (t !== shown) refs.current[t]?.pause();
      });
    }, FADE_MS);
    const v = refs.current[shown];
    if (!v) return () => clearTimeout(timer);
    // While the next video is still loading, the old one keeps playing: it must
    // not trigger yet another swap.
    const ended = () => {
      if (themeRef.current === shown) onEnded();
    };
    const tick = () => {
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const remaining = dur - v.currentTime;
      if (remaining < PRELOAD_NEXT_S) want(nextTheme(shown));
      if (remaining < SWAP_LEAD_S && remaining > 0) ended();
    };
    v.addEventListener('timeupdate', tick);
    v.addEventListener('ended', ended);
    return () => {
      clearTimeout(timer);
      v.removeEventListener('timeupdate', tick);
      v.removeEventListener('ended', ended);
    };
  }, [shown, onEnded, want]);

  return (
    <>
      {THEME_ORDER.map((t) => (
        <motion.video
          key={t}
          ref={(el: HTMLVideoElement | null) => {
            refs.current[t] = el;
          }}
          src={wanted[t] ? sources[t] : undefined}
          muted
          playsInline
          preload={wanted[t] ? 'auto' : 'none'}
          disablePictureInPicture
          disableRemotePlayback
          initial={{ opacity: 0 }}
          animate={{ opacity: shown === t ? 1 : 0 }}
          transition={{ duration: FADE_MS / 1000, ease: 'easeInOut' }}
          className="absolute inset-0 object-cover w-full h-full"
        />
      ))}
    </>
  );
}

export type ClassicRoute = 'home' | 'projects' | 'about' | 'privacy' | '404';

type ClassicSiteProps = {
  route: ClassicRoute;
  pathname: string;
  navigate: (to: string) => void;
  openComposer: () => void;
  composerOpen: boolean;
  onPlay?: () => void;
  registerScrollTop: (fn: (() => void) | null) => void;
};

export default function ClassicSite({ route, pathname, navigate, openComposer, composerOpen, onPlay, registerScrollTop }: ClassicSiteProps) {
  const switchingRef = useRef(false);
  const lenisRef = useRef<Lenis | null>(null);
  const [theme, setTheme] = useState<Theme>(() => loadStoredTheme() ?? 'night');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const prefersReduced = useReducedMotion() ?? false;
  const canHover = useCanHover();
  const isMac = useIsMac();
  const [lite] = useState(isModestDevice);
  const [slowNet] = useState(isSlowConnection);
  // Modest devices keep the look but skip the expensive bits (tilt, smooth
  // scroll, animated sheen, SVG refraction).
  const reduceMotion = prefersReduced;
  const richEffects = !lite;
  const showVideo = !prefersReduced && !slowNet;
  const [lightVideo] = useState(
    () => lite || (typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1024px)').matches),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('lite', lite);
    return () => root.classList.remove('lite');
  }, [lite]);

  // Smooth wheel scrolling only where there is a wheel: on touch screens Lenis
  // would just run a requestAnimationFrame loop forever for nothing.
  useEffect(() => {
    if (reduceMotion || !canHover || !richEffects) return;
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.4,
      // Lenis calls preventDefault on every wheel event, even while stopped, so
      // panels with their own scroll (sheets, palette, composer) couldn't scroll
      // with a mouse wheel or trackpad. They opt out with data-lenis-prevent.
      allowNestedScroll: true,
      prevent: (node) => !!node.closest?.('[data-lenis-prevent]'),
    });
    lenisRef.current = lenis;
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduceMotion, canHover, richEffects]);

  useEffect(() => {
    registerScrollTop(() => {
      // force: navigating from the palette happens while Lenis is stopped.
      if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
      else window.scrollTo({ top: 0 });
    });
    return () => registerScrollTop(null);
  }, [registerScrollTop]);

  useEffect(() => {
    if (!lenisRef.current) return;
    if (paletteOpen || composerOpen) lenisRef.current.stop();
    else lenisRef.current.start();
  }, [paletteOpen, composerOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        if (composerOpen) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerOpen]);

  const switchActive = useCallback(() => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setTheme((prev) => nextTheme(prev));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      switchingRef.current = false;
    }, FADE_MS * 2);
    return () => clearTimeout(t);
  }, [theme]);

  const setManualTheme = useCallback((t: Theme) => {
    setTheme(t);
    try {
      window.localStorage.setItem('preferred-theme', t);
    } catch {
      // ignore
    }
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const pageProps: PageProps = { navigate, reduceMotion, canHover: canHover && richEffects, openComposer };

  let pageEl: ReactNode = null;
  if (route === 'projects') pageEl = <ProjectsPage {...pageProps} />;
  else if (route === 'about') pageEl = <AboutPage {...pageProps} />;
  else if (route === 'privacy') pageEl = <PrivacyPage {...pageProps} />;
  else if (route === '404') pageEl = <NotFoundPage {...pageProps} />;
  else pageEl = <HomePage {...pageProps} />;

  return (
    <div className="relative min-h-screen font-sans selection:bg-white/30 bg-black text-white">
      {richEffects && (
        <svg
          aria-hidden
          style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
        >
          <defs>
            <filter
              id="liquid-glass-distortion"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.01 0.012"
                numOctaves={1}
                seed={3}
                result="noise"
              />
              <feGaussianBlur in="noise" stdDeviation={2} result="softNoise" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="softNoise"
                scale={14}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      )}

      <div aria-hidden className="fixed inset-0 z-0 overflow-hidden">
        <div className={`absolute inset-0 ${fallbackByTheme[theme]}`} />
        {showVideo && <BackgroundVideos theme={theme} onEnded={switchActive} light={lightVideo} />}
        <div className={`absolute inset-0 pointer-events-none transition-colors duration-700 ${overlayByTheme[theme]}`} />
      </div>

      <ScrollProgress />

      {route !== 'home' && (
        <motion.a
          href="/clasico"
          onClick={(e) => { e.preventDefault(); navigate('/clasico'); }}
          aria-label="Inicio — Daniel Eduardo"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
          className="liquid-glass fixed top-4 left-4 md:top-5 md:left-5 z-40 inline-flex items-center justify-center w-11 h-11 rounded-full font-display italic text-lg text-white/90 hover:text-white transition-colors"
          style={{ paddingTop: 2 }}
        >
          D
        </motion.a>
      )}

      <TopControls
        theme={theme}
        setManualTheme={setManualTheme}
        openPalette={openPalette}
        isMac={isMac}
        onPlay={onPlay}
      />

      <motion.main
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full"
      >
        {pageEl}
      </motion.main>

      <CookieNotice navigate={navigate} />

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        navigate={navigate}
        setManualTheme={setManualTheme}
        openComposer={openComposer}
        isMac={isMac}
      />
    </div>
  );
}
