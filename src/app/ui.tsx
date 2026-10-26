import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ISODate, WorkoutTemplate } from '@/domain/types';
import { useI18n } from '@/i18n';
import { Sheet } from '@/components/Sheet';

export type SheetState =
  | { kind: 'none' }
  | { kind: 'workoutEditor'; id?: string; date?: ISODate; startTime?: string; template?: WorkoutTemplate }
  | { kind: 'workoutDetail'; id: string }
  | { kind: 'complete'; id: string }
  | { kind: 'dutyEditor'; id?: string; date?: ISODate };

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn';
  action?: { label: string; run: () => void };
}

interface ConfirmReq {
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UIValue {
  sheet: SheetState;
  open: (s: SheetState) => void;
  close: () => void;
  toast: (text: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  confirm: (text: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  /** Workout currently being moved via "tap a day" mode. */
  moving: { id: string; name: string } | null;
  setMoving: (m: { id: string; name: string } | null) => void;
}

const Ctx = createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [moving, setMoving] = useState<UIValue['moving']>(null);
  const seq = useRef(0);

  const toast = useCallback<UIValue['toast']>((text, opts) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-2), { id, text, tone: opts?.tone ?? 'ok', action: opts?.action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), opts?.action ? 5000 : 2600);
  }, []);

  const confirm = useCallback<UIValue['confirm']>(
    (text, opts) => new Promise<boolean>((resolve) => setConfirmReq({ text, ...opts, resolve })),
    [],
  );

  const value = useMemo<UIValue>(
    () => ({ sheet, open: setSheet, close: () => setSheet({ kind: 'none' }), toast, confirm, moving, setMoving }),
    [sheet, toast, confirm, moving],
  );

  const answer = (ok: boolean) => {
    confirmReq?.resolve(ok);
    setConfirmReq(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink text-bg px-4 py-3 shadow-xl animate-rise max-w-md w-full">
            {x.tone === 'ok' ? <CheckCircle2 size={20} className="text-mint shrink-0" /> : <AlertTriangle size={20} className="text-warn shrink-0" />}
            <span className="flex-1 text-sm font-medium">{x.text}</span>
            {x.action && (
              <button
                className="text-sm font-bold text-sky px-2 min-h-[36px]"
                onClick={() => {
                  x.action!.run();
                  setToasts((ts) => ts.filter((y) => y.id !== x.id));
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Sheet open={!!confirmReq} onClose={() => answer(false)} title={t('common.confirm')}>
        <p className="text-base mb-6 mt-2">{confirmReq?.text}</p>
        <div className="grid grid-cols-2 gap-3 pb-2">
          <button className="btn-ghost" onClick={() => answer(false)}>
            {t('common.cancel')}
          </button>
          <button className={confirmReq?.danger ? 'btn bg-danger text-white' : 'btn-primary'} onClick={() => answer(true)}>
            {confirmReq?.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUI outside UIProvider');
  return v;
}
