import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight, Mail, Sparkles, X, Zap, type LucideIcon } from 'lucide-react';
import { SOCIAL } from '../data';
import { trapTab } from './foco';

type ContactReason = 'proyecto' | 'colaboracion' | 'saludo';

const CONTACT_REASONS: Record<ContactReason, { label: string; subject: string; icon: LucideIcon }> = {
  proyecto: { label: 'Tengo un proyecto', subject: 'Tengo un proyecto en mente', icon: Sparkles },
  colaboracion: { label: 'Colaboración', subject: 'Me gustaría colaborar contigo', icon: Zap },
  saludo: { label: 'Solo saludar', subject: 'Hola Daniel', icon: Mail },
};

export default function ContactComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<ContactReason>('proyecto');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setReason('proyecto');
      setName('');
      setMessage('');
      setCopied(false);
      return;
    }
    // El foco entra al diálogo al abrir y vuelve al botón que lo abrió al cerrar.
    const opener = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  const subject = CONTACT_REASONS[reason].subject;

  const body = useMemo(() => {
    const trimmedName = name.trim();
    const trimmedMessage = message.trim();
    const greet = trimmedName ? `Hola Daniel,\n\nSoy ${trimmedName}.` : 'Hola Daniel,';
    const middle = trimmedMessage ? `\n\n${trimmedMessage}` : '';
    const closing = trimmedName ? `\n\nSaludos,\n${trimmedName}` : '\n\nSaludos,';
    return greet + middle + closing;
  }, [name, message]);

  function handleSend() {
    const url = `mailto:${SOCIAL.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    setTimeout(onClose, 100);
  }

  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(SOCIAL.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        trapTab(e, panelRef.current);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center pt-[3svh] sm:pt-[6svh] md:pt-0 px-3 sm:px-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Componer mensaje"
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            ref={panelRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="liquid-glass-strong relative w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[94svh] outline-none"
          >
            <div className="flex items-start justify-between px-5 md:px-6 py-4 border-b border-white/10 shrink-0">
              <div>
                <h2 className="text-xl md:text-2xl font-display italic tracking-tight">Hablemos.</h2>
                <p className="text-[12px] md:text-[12.5px] text-white/55 mt-1">Te ayudo a empezar el correo — lo terminas en tu app.</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="inline-flex items-center justify-center w-9 h-9 -mt-1 -mr-1 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div data-lenis-prevent className="flex-1 overflow-y-auto px-5 md:px-6 py-5 space-y-5 overscroll-contain">
              <div>
                <p id="composer-motivo" className="block text-[10.5px] tracking-[0.2em] uppercase text-white/55 mb-2.5">Motivo</p>
                <div role="group" aria-labelledby="composer-motivo" className="grid grid-cols-3 gap-2">
                  {(Object.keys(CONTACT_REASONS) as ContactReason[]).map((k) => {
                    const r = CONTACT_REASONS[k];
                    const active = reason === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setReason(k)}
                        aria-pressed={active}
                        className={`liquid-glass rounded-[0.85rem] px-2 py-3 text-[11.5px] md:text-xs tracking-wide transition-all ${
                          active ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'
                        }`}
                        style={active ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)' } : undefined}
                      >
                        <r.icon size={15} strokeWidth={1.5} className="mx-auto mb-1.5" />
                        <span className="block leading-tight">{r.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="composer-nombre" className="block text-[10.5px] tracking-[0.2em] uppercase text-white/55 mb-2">
                  Tu nombre <span className="text-white/55 normal-case tracking-normal">(opcional)</span>
                </label>
                <input
                  id="composer-nombre"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="¿Cómo te llamas?"
                  className="w-full liquid-glass rounded-[0.85rem] px-4 py-3 bg-transparent outline-none text-base text-white placeholder:text-white/50"
                  autoComplete="name"
                  autoCapitalize="words"
                />
              </div>

              <div>
                <label htmlFor="composer-mensaje" className="block text-[10.5px] tracking-[0.2em] uppercase text-white/55 mb-2">
                  Primer mensaje <span className="text-white/55 normal-case tracking-normal">(opcional)</span>
                </label>
                <textarea
                  id="composer-mensaje"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Una línea para arrancar — puedes seguir en tu correo."
                  rows={3}
                  className="w-full liquid-glass rounded-[0.85rem] px-4 py-3 bg-transparent outline-none text-base text-white placeholder:text-white/50 resize-none leading-relaxed"
                />
              </div>

              <div className="liquid-glass rounded-[0.85rem] px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-white/55">
                  <Mail size={11} strokeWidth={1.5} /> Vista previa
                </div>
                <p className="text-[12px] md:text-[12.5px]">
                  <span className="text-white/55">Para:</span>{' '}
                  <button
                    onClick={handleCopyEmail}
                    className="text-white/85 hover:text-white transition-colors inline-flex items-center gap-1.5"
                    title="Copiar correo"
                  >
                    {SOCIAL.email}
                    <span className="text-[10px] tracking-[0.15em] uppercase text-white/60">
                      {copied ? '✓ Copiado' : 'Copiar'}
                    </span>
                  </button>
                </p>
                <p className="text-[12px] md:text-[12.5px]">
                  <span className="text-white/55">Asunto:</span>{' '}
                  <span className="text-white/85">{subject}</span>
                </p>
              </div>
            </div>

            <div className="border-t border-white/10 px-5 md:px-6 py-4 flex items-center justify-between gap-3 shrink-0">
              <p className="text-[10.5px] md:text-[11px] text-white/60 leading-tight flex-1">
                Abriré tu app de correo<br className="sm:hidden" /> con todo listo.
              </p>
              <button
                onClick={handleSend}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-medium text-sm hover:opacity-90 transition-opacity shrink-0"
              >
                Abrir correo
                <ArrowUpRight size={14} strokeWidth={2} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
