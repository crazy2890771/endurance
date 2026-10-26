/** Remind to save a backup once a month; "Later" snoozes the reminder for a week. */
export const BACKUP_EVERY_DAYS = 30;
export const BACKUP_SNOOZE_DAYS = 7;

const DAY_MS = 86_400_000;

export interface BackupState {
  lastAt?: string;
  snoozeUntil?: string;
}

export function backupDue(state: BackupState | undefined, hasData: boolean, now = new Date()): boolean {
  if (!hasData) return false;
  if (state?.snoozeUntil && new Date(state.snoozeUntil) > now) return false;
  if (!state?.lastAt) return true;
  return now.getTime() - new Date(state.lastAt).getTime() >= BACKUP_EVERY_DAYS * DAY_MS;
}

export const snoozeUntil = (now = new Date()) => new Date(now.getTime() + BACKUP_SNOOZE_DAYS * DAY_MS).toISOString();

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/** Chrome/Android's install prompt, kept so a button can show it later. iOS has none. */
export let installPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
  });
}
export const clearInstallPrompt = () => (installPrompt = null);
