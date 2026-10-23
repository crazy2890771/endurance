import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { enUS, th as thLocale } from 'date-fns/locale';
import { format as dfFormat } from 'date-fns';
import type { Language } from '@/domain/types';
import { en, type TKey } from './en';
import { th } from './th';

const DICTS: Record<Language, Record<TKey, string>> = { en, th };

export type TFn = (key: TKey, params?: Record<string, string | number>) => string;

export function translate(lang: Language, key: TKey, params?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface I18nValue {
  lang: Language;
  t: TFn;
  /** date-fns format with the active locale. */
  fmt: (d: Date | number, pattern: string) => string;
}

const I18nCtx = createContext<I18nValue>({
  lang: 'en',
  t: (k, p) => translate('en', k, p),
  fmt: (d, p) => dfFormat(d, p, { locale: enUS }),
});

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const locale = lang === 'th' ? thLocale : enUS;
    return { lang, t: (k, p) => translate(lang, k, p), fmt: (d, p) => dfFormat(d, p, { locale }) };
  }, [lang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
export type { TKey };
