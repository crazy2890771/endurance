import { Minus, Plus, ChevronRight, ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  ariaLabel?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex p-1 rounded-2xl bg-card2 gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl font-semibold transition ${size === 'sm' ? 'min-h-[36px] text-sm' : 'min-h-[42px]'} ${value === o.value ? 'bg-sky text-[#03111c] shadow' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChipGroup<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  cols = 3,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  ariaLabel?: string;
  cols?: 2 | 3 | 4 | 5;
}) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }[cols];
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid ${grid} gap-2`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`chip gap-2 ${value === o.value ? 'chip-on' : ''}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 5,
  min = 0,
  max = 1440,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  label: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex items-center rounded-2xl bg-card2 border border-line/60 min-h-[52px]">
      <button type="button" className="icon-btn ml-1" aria-label={`${label} −`} onClick={() => onChange(clamp(value - step))}>
        <Minus size={20} />
      </button>
      <div className="flex-1 flex items-center justify-center gap-1">
        <input
          aria-label={label}
          inputMode="numeric"
          className="w-16 bg-transparent text-center text-xl font-bold outline-none"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
            onChange(isNaN(n) ? 0 : Math.min(max, n));
          }}
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </div>
      <button type="button" className="icon-btn mr-1" aria-label={`${label} +`} onClick={() => onChange(clamp(value + step))}>
        <Plus size={20} />
      </button>
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted mt-1.5">{hint}</p>}
      {error && (
        <p className="text-sm text-danger mt-1.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-6 text-center flex flex-col items-center gap-2 animate-rise">
      <div className="w-14 h-14 rounded-full bg-card2 flex items-center justify-center text-muted mb-1">{icon}</div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-sm text-muted max-w-xs">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, back, right }: { title: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur pt-safe">
      <div className="flex items-center gap-2 px-2 min-h-[56px]">
        {back ? (
          <button className="icon-btn" aria-label={t('common.back')} onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
            <ChevronLeft size={26} />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="flex-1 text-xl font-bold truncate">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function ListLink({ to, icon, title, sub, right }: { to: string; icon: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 min-h-[64px] active:bg-card2 transition">
      <span className="w-10 h-10 rounded-xl bg-card2 flex items-center justify-center text-ink shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold truncate">{title}</span>
        {sub && <span className="block text-xs text-muted truncate">{sub}</span>}
      </span>
      {right}
      <ChevronRight size={20} className="text-muted shrink-0" />
    </Link>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition ${checked ? 'bg-mint' : 'bg-line'}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${checked ? 'translate-x-7' : 'translate-x-1'}`} />
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted" role="status">
      <span className="h-5 w-5 rounded-full border-2 border-line border-t-mint animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-3">
      <h2 className="text-lg font-bold">{children}</h2>
      {right}
    </div>
  );
}
