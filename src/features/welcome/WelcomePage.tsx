import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Segmented } from '@/components/ui';
import { useSettingsOrDefault } from '@/db/hooks';
import { updateSettings } from '@/db/repo';
import { loadDemoData } from '@/db/demo';
import { useI18n } from '@/i18n';

export function WelcomePage() {
  const { t } = useI18n();
  const s = useSettingsOrDefault();
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    if (demo) await loadDemoData();
    await updateSettings({ onboarded: true });
  };

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex flex-col">
      {/* Mountain-road backdrop drawn in SVG so it works offline */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#090D10" />
            <stop offset=".55" stopColor="#12263a" />
            <stop offset="1" stopColor="#1d4a63" />
          </linearGradient>
          <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a3640" />
            <stop offset="1" stopColor="#0c1115" />
          </linearGradient>
        </defs>
        <rect width="400" height="800" fill="url(#sky)" />
        <path d="M0 560 L70 470 L120 520 L190 430 L260 510 L320 450 L400 530 L400 800 L0 800Z" fill="#14212c" />
        <path d="M0 600 L90 540 L160 580 L240 520 L330 590 L400 560 L400 800 L0 800Z" fill="#0f1922" />
        <path d="M185 600 L215 600 L330 800 L70 800Z" fill="url(#road)" />
        <path d="M200 610 L200 640 M200 660 L200 700 M200 720 L200 780" stroke="#55E5A3" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="relative z-10 flex-1 flex flex-col items-center text-center px-6 pt-[max(env(safe-area-inset-top),48px)]">
        <Logo className="w-24 h-16 text-white mt-10" />
        <h1 className="text-4xl font-extrabold tracking-tight mt-4 leading-tight text-white">
          KIM
          <br />
          ENDURANCE LAB
        </h1>
        <p className="text-xs tracking-[.3em] text-sky mt-3 font-semibold">{t('app.tagline')}</p>
        <p className="text-sm text-white/80 mt-6 max-w-xs">{t('app.sub')}</p>

        <div className="w-full max-w-sm mt-auto mb-[max(env(safe-area-inset-bottom),24px)] flex flex-col gap-3 text-left">
          <div className="rounded-3xl bg-black/40 backdrop-blur p-4 border border-white/10 flex flex-col gap-3">
            <div>
              <p className="text-xs text-white/70 mb-1.5">{t('welcome.language')}</p>
              <Segmented size="sm" value={s.language} onChange={(language) => updateSettings({ language })} options={[{ value: 'en', label: 'English' }, { value: 'th', label: 'ไทย' }]} />
            </div>
            <div>
              <p className="text-xs text-white/70 mb-1.5">{t('welcome.units')}</p>
              <Segmented size="sm" value={s.units} onChange={(units) => updateSettings({ units })} options={[{ value: 'metric', label: 'km' }, { value: 'imperial', label: 'mi' }]} />
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 mt-0.5 accent-[rgb(var(--mint))]" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
              <span>
                <span className="block text-sm font-semibold text-white">{t('welcome.demo')}</span>
                <span className="block text-xs text-white/60">{t('welcome.demoHint')}</span>
              </span>
            </label>
          </div>
          <button className="btn-sky w-full text-base" onClick={start} disabled={busy}>
            {t('welcome.start')} <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
