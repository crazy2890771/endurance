import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Left header slot (e.g. back button). */
  leading?: ReactNode;
  tall?: boolean;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer, leading, tall }: SheetProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`relative w-full sm:max-w-lg bg-card border border-line/60 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col outline-none animate-sheet-up sm:animate-rise ${tall ? 'h-[92dvh] sm:h-[85vh]' : 'max-h-[92dvh] sm:max-h-[85vh]'}`}
      >
        <div className="sm:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 min-h-[56px]">
          <div className="w-11">{leading}</div>
          <h2 className="flex-1 text-center text-lg font-bold truncate">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={22} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 overscroll-contain">{children}</div>
        {footer && <div className="px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] border-t border-line/40">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
