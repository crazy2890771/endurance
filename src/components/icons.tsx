import { Bike, Dumbbell, Moon, Waves, type LucideProps } from 'lucide-react';
import type { Activity } from '@/domain/types';
import { useI18n } from '@/i18n';

/** Running figure (lucide has no runner glyph). */
export function RunIcon({ size = 24, strokeWidth = 2, className, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...(rest as React.SVGProps<SVGSVGElement>)}
    >
      <circle cx="14.5" cy="4" r="2" />
      <path d="M8 21l3-6 3 2v5" />
      <path d="M5 11l3-3 4 0 3 4 3 1" />
      <path d="M12 8l-1.5 5 3.5 4" />
    </svg>
  );
}

export const ACTIVITY_ICON: Record<Activity, React.ComponentType<LucideProps>> = {
  run: RunIcon,
  cycle: Bike,
  swim: Waves,
  strength: Dumbbell,
  rest: Moon,
};

export const ACTIVITY_TEXT: Record<Activity, string> = {
  run: 'text-run',
  cycle: 'text-cycle',
  swim: 'text-swim',
  strength: 'text-strength',
  rest: 'text-muted',
};

export const ACTIVITY_BG: Record<Activity, string> = {
  run: 'bg-run/15',
  cycle: 'bg-cycle/15',
  swim: 'bg-swim/15',
  strength: 'bg-strength/15',
  rest: 'bg-muted/15',
};

export const ACTIVITY_BAR: Record<Activity, string> = {
  run: 'bg-run',
  cycle: 'bg-cycle',
  swim: 'bg-swim',
  strength: 'bg-strength',
  rest: 'bg-muted',
};

export function ActivityBadge({ activity, size = 'md' }: { activity: Activity; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n();
  const Icon = ACTIVITY_ICON[activity];
  const box = size === 'lg' ? 'w-16 h-16' : size === 'sm' ? 'w-9 h-9' : 'w-12 h-12';
  const icon = size === 'lg' ? 32 : size === 'sm' ? 18 : 24;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${box} ${ACTIVITY_BG[activity]} ${ACTIVITY_TEXT[activity]}`} title={t(`activity.${activity}`)}>
      <Icon size={icon} strokeWidth={2.2} />
    </span>
  );
}
