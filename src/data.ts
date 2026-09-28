import {
  Brain,
  GraduationCap,
  Leaf,
  Newspaper,
  Music,
  Headphones,
  AudioWaveform,
  Scissors,
  Code2,
  Cpu,
  Globe,
  Gauge,
  type LucideIcon,
} from 'lucide-react';

export const SOCIAL = {
  github: 'https://github.com/lowlufi',
  linkedin: 'https://www.linkedin.com/in/danielaguileracampusano/',
  instagram: 'https://instagram.com/daanieleduardo',
  email: 'danieleduardoaguilerac@gmail.com',
};

export type Project = {
  id: number;
  title: string;
  description: string;
  tags: string[];
  icon: LucideIcon;
  url: string;
  featured?: boolean;
  comingSoon?: boolean;
};

export const PROJECTS: Project[] = [
  {
    id: 1,
    title: 'Latise',
    description: '"Tu mente digital": plataforma con herramientas cognitivas y experiencia web minimalista.',
    tags: ['React', 'TypeScript', 'Tailwind'],
    icon: Brain,
    url: 'https://www.latise.cl',
    featured: true,
  },
  {
    id: 2,
    title: 'ConexEd',
    description: 'Plataforma para digitalizar la gestión de prácticas profesionales en liceos técnico-profesionales de Chile.',
    tags: ['Web App', 'Educación', 'Tailwind'],
    icon: GraduationCap,
    url: 'https://conexed.cl',
    featured: true,
  },
  {
    id: 3,
    title: 'Saludenti',
    description: 'E-commerce de cosmética natural artesanal: productos orgánicos, cruelty-free y aromaterapia.',
    tags: ['E-commerce', 'Landing'],
    icon: Leaf,
    url: 'https://saludenti.cl',
    featured: true,
  },
  {
    id: 4,
    title: 'San Antonio News',
    description: 'Portal de todas las noticias de la zona en un solo lugar.',
    tags: ['Medios', 'CMS'],
    icon: Newspaper,
    url: 'https://sanantonionews.cl',
  },
  {
    id: 5,
    title: 'Donñelo',
    description: 'Otro Mundo Musical — proyecto y plataforma de identidad para artista.',
    tags: ['Música', 'Marca'],
    icon: Music,
    url: 'https://donnelo.cl',
  },
  {
    id: 6,
    title: 'JuanJeh Music',
    description: 'Sitio web del músico JuanJeh — presencia digital y vitrina para su trabajo musical.',
    tags: ['Música', 'Sitio Web'],
    icon: Headphones,
    url: 'https://juanjehmusic.cl',
  },
  {
    id: 7,
    title: 'CRM Masterización',
    description: 'CRM para CRM Masterización Inc — gestión de clientes y proyectos para estudio de masterización musical.',
    tags: ['CRM', 'SaaS', 'Audio'],
    icon: AudioWaveform,
    url: 'https://crm-masterizacion.cl',
  },
  {
    id: 8,
    title: 'Barbería Digital',
    description: 'Plataforma para agendar horas en barberías — gestión de reservas, calendario y catálogo de servicios.',
    tags: ['Reservas', 'Web App', 'Próximamente'],
    icon: Scissors,
    url: '#',
    comingSoon: true,
  },
];

export type SkillGroup = {
  title: string;
  icon: LucideIcon;
  items: string[];
};

export const SKILLS: SkillGroup[] = [
  {
    title: 'Frontend',
    icon: Code2,
    items: ['React', 'TypeScript', 'Tailwind', 'Motion', 'Vite'],
  },
  {
    title: 'Cloud & Backend',
    icon: Globe,
    items: ['Cloudflare Pages', 'AWS', 'Node.js', 'REST APIs'],
  },
  {
    title: 'IoT & Hardware',
    icon: Cpu,
    items: ['NFC', 'Arduino', 'Microcontroladores'],
  },
  {
    title: 'Performance',
    icon: Gauge,
    items: ['Web Vitals', 'SEO técnico', 'Accesibilidad'],
  },
];
