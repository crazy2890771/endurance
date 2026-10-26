import type {
  Activity,
  AppSettings,
  DutyType,
  HRZone,
  Location,
  RuleConfig,
  Workout,
  WorkoutType,
} from './types';

export const ACTIVITIES: Activity[] = ['run', 'cycle', 'swim', 'strength', 'rest'];
export const TRAINING_ACTIVITIES: Exclude<Activity, 'rest'>[] = ['run', 'cycle', 'swim', 'strength'];

export const TYPES_BY_ACTIVITY: Record<Activity, WorkoutType[]> = {
  run: ['easy', 'recovery', 'tempo', 'interval', 'long'],
  cycle: ['easy', 'endurance', 'tempo', 'interval'],
  swim: ['easy', 'technique', 'endurance', 'interval'],
  strength: ['upper', 'lower', 'full', 'mobility'],
  rest: ['rest'],
};

export const LOCATIONS_BY_ACTIVITY: Record<Activity, Location[]> = {
  run: ['outdoor', 'indoor'],
  cycle: ['outdoor', 'indoor'],
  swim: ['pool', 'openwater'],
  strength: [],
  rest: [],
};

export const DEFAULT_ZONE_BY_TYPE: Partial<Record<WorkoutType, HRZone>> = {
  easy: 2,
  recovery: 1,
  endurance: 2,
  long: 2,
  technique: 2,
  tempo: 3,
  interval: 4,
};

/** Whether a workout type supports structured interval sets. */
export const supportsIntervals = (type: WorkoutType) => type === 'interval' || type === 'tempo';

/** Activities where distance is typically measured in metres rather than kilometres. */
export const usesMetres = (a: Activity) => a === 'swim';

/**
 * High-intensity: sessions that need recovery afterwards (intervals, tempo, or HR zone 4–5).
 * This is a deterministic classification — not a recommendation.
 */
export function isHighIntensity(w: Pick<Workout, 'activity' | 'type' | 'hrZone'>): boolean {
  if (w.activity === 'rest') return false;
  if (w.hrZone !== undefined && w.hrZone >= 4) return true;
  if (w.activity === 'strength') return false;
  return w.type === 'interval' || w.type === 'tempo';
}

/** Hard day contributors: high-intensity sessions, long runs and lower/full-body strength. */
export function isHardSession(w: Pick<Workout, 'activity' | 'type' | 'hrZone' | 'durationMin'>): boolean {
  if (isHighIntensity(w)) return true;
  if (w.activity === 'run' && w.type === 'long') return true;
  if (w.activity === 'strength' && (w.type === 'lower' || w.type === 'full')) return true;
  return false;
}

export const BUILTIN_DUTY_TYPES: Omit<DutyType, 'createdAt' | 'updatedAt'>[] = [
  { id: 'dt-flight', code: 'Flight', label: 'Flight', color: '#FF6370', allowsTraining: 'limited', builtin: true, keywords: ['FLT', 'FLIGHT', 'FLY', 'SECTOR'] },
  { id: 'dt-standby', code: 'Standby', label: 'Standby', color: '#FFB547', allowsTraining: 'yes', builtin: true, keywords: ['SBY', 'STBY', 'STANDBY', 'HSBY', 'ASBY', 'RES'] },
  { id: 'dt-dm', code: 'DM', label: 'Duty / Meeting', color: '#8C9BA6', allowsTraining: 'limited', builtin: true, keywords: ['DM', 'MEETING', 'GROUND', 'SIM', 'TRG', 'OFFICE'] },
  { id: 'dt-al', code: 'AL', label: 'Annual Leave', color: '#55E5A3', allowsTraining: 'yes', builtin: true, keywords: ['AL', 'LEAVE', 'VAC'] },
  { id: 'dt-roff', code: 'ROFF', label: 'Requested Off', color: '#52BFFF', allowsTraining: 'yes', builtin: true, keywords: ['ROFF', 'RDO'] },
  { id: 'dt-rest', code: 'Rest', label: 'Rest', color: '#A78BFA', allowsTraining: 'yes', builtin: true, keywords: ['REST', 'RST', 'LAYOVER', 'LO'] },
  { id: 'dt-off', code: 'OFF', label: 'Day Off', color: '#55E5A3', allowsTraining: 'yes', builtin: true, keywords: ['OFF', 'DO', 'X'] },
];

export const DEFAULT_RULES: RuleConfig = {
  consecutiveHard: { enabled: true, maxDays: 1 },
  hardRecovery: { enabled: true, minHours: 48 },
  consecutiveRun: { enabled: true, maxDays: 3 },
  weeklyRest: { enabled: true, minDays: 1 },
  dutyOverlap: { enabled: true, bufferMin: 60 },
  runVolume: { enabled: true, maxIncreasePct: 10, minBaseKm: 10 },
  longRunPerWeek: { enabled: true, max: 1 },
};

export function defaultHrZones(maxHr = 185): AppSettings['hrZones'] {
  const pct = (p: number) => Math.round((maxHr * p) / 100);
  return {
    1: { min: pct(50), max: pct(60) - 1 },
    2: { min: pct(60), max: pct(70) - 1 },
    3: { min: pct(70), max: pct(80) - 1 },
    4: { min: pct(80), max: pct(90) - 1 },
    5: { min: pct(90), max: maxHr },
  };
}

export function defaultSettings(): AppSettings {
  return {
    id: 'app',
    onboarded: false,
    units: 'metric',
    language: 'en',
    theme: 'dark',
    weekStartsOn: 1,
    maxHr: undefined,
    hrZones: defaultHrZones(),
    rules: structuredClone(DEFAULT_RULES),
    sync: { enabled: false },
    deviceId: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
}
