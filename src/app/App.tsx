import { Component, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarDays, History, House, Settings, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSettings } from '@/db/hooks';
import { ensureInitialized } from '@/db/repo';
import { I18nProvider, useI18n, translate } from '@/i18n';
import { startSyncScheduler } from '@/sync/sync';
import { Spinner } from '@/components/ui';
import { UIProvider } from './ui';
import { HomePage } from '@/features/home/HomePage';
import { PlannerPage } from '@/features/planner/PlannerPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DataPage, GeneralPage, RulesPage, TemplatesPage, ZonesPage } from '@/features/settings/pages';
import { SyncPage } from '@/features/settings/SyncPage';
import { PlanCheckPage } from '@/features/plancheck/PlanCheckPage';
import { DutiesPage } from '@/features/duty/DutiesPage';
import { ImportPage } from '@/features/duty/ImportPage';
import { DutyTypesPage } from '@/features/duty/DutyTypesPage';
import { WelcomePage } from '@/features/welcome/WelcomePage';
import { WorkoutEditor } from '@/features/workout/WorkoutEditor';
import { WorkoutDetail } from '@/features/workout/WorkoutDetail';
import { CompleteSheet } from '@/features/workout/CompleteSheet';
import { DutyEditor } from '@/features/duty/DutyEditor';

export function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string>();
  useEffect(() => {
    ensureInitialized()
      .then(() => {
        setReady(true);
        startSyncScheduler();
        void navigator.storage?.persist?.();
      })
      .catch((e) => setInitError(String(e?.message ?? e)));
  }, []);
  const settings = useSettings();
  useTheme(settings?.theme ?? 'dark');

  if (initError) return <Fatal message={initError} />;
  if (!ready || !settings) return <Spinner />;

  return (
    <I18nProvider lang={settings.language}>
      <ErrorBoundary>
        <BrowserRouter>
          <UIProvider>
            {settings.onboarded ? <Shell /> : <WelcomePage />}
          </UIProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </I18nProvider>
  );
}

function useTheme(pref: 'dark' | 'light' | 'system') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = pref === 'light' || (pref === 'system' && mq.matches);
      document.documentElement.classList.toggle('light', light);
      document.documentElement.classList.toggle('dark', !light);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F2F5F7' : '#090D10');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

function Shell() {
  const { lang } = useI18n();
  const loc = useLocation();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className="min-h-[100dvh] max-w-2xl mx-auto">
      <OfflineBanner />
      <UpdatePrompt />
      <main key={loc.pathname} className="animate-fade-in">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/plan-check" element={<PlanCheckPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/duties" element={<DutiesPage />} />
          <Route path="/settings/import" element={<ImportPage />} />
          <Route path="/settings/duty-types" element={<DutyTypesPage />} />
          <Route path="/settings/rules" element={<RulesPage />} />
          <Route path="/settings/zones" element={<ZonesPage />} />
          <Route path="/settings/templates" element={<TemplatesPage />} />
          <Route path="/settings/general" element={<GeneralPage />} />
          <Route path="/settings/data" element={<DataPage />} />
          <Route path="/settings/sync" element={<SyncPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <WorkoutEditor />
      <WorkoutDetail />
      <CompleteSheet />
      <DutyEditor />
    </div>
  );
}

function BottomNav() {
  const { t } = useI18n();
  const items = [
    { to: '/', icon: House, label: t('nav.home'), end: true },
    { to: '/planner', icon: CalendarDays, label: t('nav.planner') },
    { to: '/history', icon: History, label: t('nav.history') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-bg/90 backdrop-blur border-t border-line/50 pb-safe" aria-label="Main">
      <div className="max-w-2xl mx-auto grid grid-cols-4">
        {items.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex flex-col items-center justify-center gap-1 min-h-[64px] text-[11px] font-semibold transition ${isActive ? 'text-sky' : 'text-muted'}`}
          >
            {({ isActive }) => (
              <>
                <Icon size={24} strokeWidth={isActive ? 2.4 : 2} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function OfflineBanner() {
  const { t } = useI18n();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="sticky top-0 z-30 bg-warn/15 text-warn text-xs font-semibold flex items-center justify-center gap-2 py-1.5 pt-[max(env(safe-area-inset-top),6px)]" role="status">
      <WifiOff size={14} /> {t('offline.banner')}
    </div>
  );
}

function UpdatePrompt() {
  const { t } = useI18n();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed top-[max(env(safe-area-inset-top),12px)] inset-x-4 z-[70] max-w-md mx-auto card p-3 flex items-center gap-3 shadow-xl animate-rise">
      <span className="flex-1 text-sm font-medium">{t('update.available')}</span>
      <button className="btn-sky min-h-[40px] text-sm" onClick={() => updateServiceWorker(true)}>
        {t('update.reload')}
      </button>
    </div>
  );
}

function Fatal({ message }: { message: string }) {
  const lang = (navigator.language ?? 'en').startsWith('th') ? 'th' : 'en';
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center gap-3">
      <p className="text-lg font-bold">{translate(lang, 'error.title')}</p>
      <p className="text-sm text-muted break-all">{message}</p>
      <button className="btn-primary" onClick={() => location.reload()}>
        {translate(lang, 'error.reload')}
      </button>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Fatal message={this.state.error.message} />;
    return this.props.children;
  }
}
