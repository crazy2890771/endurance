import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/i18n';
import { versionLabel } from '@/lib/version';

export const SPLASH_MS = 1500;

/** Brand screen shown for 1.5 s on every launch; it fades out on its own (tap to skip). */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), SPLASH_MS - 350);
    const done = setTimeout(onDone, SPLASH_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[80] overflow-hidden flex flex-col items-center justify-center text-center px-6 bg-[#090D10] transition-opacity duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      onClick={onDone}
      role="status"
      aria-label={t('app.name')}
    >
      {/* Mountain-road backdrop drawn in SVG so it works offline */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="splash-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#090D10" />
            <stop offset=".55" stopColor="#12263a" />
            <stop offset="1" stopColor="#1d4a63" />
          </linearGradient>
          <linearGradient id="splash-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a3640" />
            <stop offset="1" stopColor="#0c1115" />
          </linearGradient>
        </defs>
        <rect width="400" height="800" fill="url(#splash-sky)" />
        <path d="M0 560 L70 470 L120 520 L190 430 L260 510 L320 450 L400 530 L400 800 L0 800Z" fill="#14212c" />
        <path d="M0 600 L90 540 L160 580 L240 520 L330 590 L400 560 L400 800 L0 800Z" fill="#0f1922" />
        <path d="M185 600 L215 600 L330 800 L70 800Z" fill="url(#splash-road)" />
        <path d="M200 610 L200 640 M200 660 L200 700 M200 720 L200 780" stroke="#55E5A3" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="relative z-10 flex flex-col items-center -mt-24 animate-rise">
        <Logo className="w-24 h-16 text-white" />
        <h1 className="text-4xl font-extrabold tracking-tight mt-4 leading-tight text-white">
          KIM
          <br />
          ENDURANCE LAB
        </h1>
        <p className={`text-sky mt-3 font-semibold ${lang === 'th' ? 'text-sm' : 'text-xs tracking-[.3em]'}`}>{t('app.tagline')}</p>
      </div>
      <p className="absolute bottom-[calc(max(env(safe-area-inset-bottom),32px)+14px)] inset-x-0 z-10 flex justify-center">
        <span className="rounded-md bg-black/40 px-2 py-0.5 text-[11px] text-white/60 tabular-nums">{versionLabel()}</span>
      </p>
      <div className="absolute bottom-[max(env(safe-area-inset-bottom),32px)] left-1/2 -translate-x-1/2 z-10 w-24 h-1 rounded-full bg-white/15 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-sky rounded-full" style={{ animation: `splash-progress ${SPLASH_MS}ms linear forwards` }} />
      </div>
    </div>
  );
}
