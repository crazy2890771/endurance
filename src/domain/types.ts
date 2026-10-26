/** ISO calendar date, `YYYY-MM-DD`, always interpreted in the user's local time zone. */
export type ISODate = string;
/** Local wall-clock time, `HH:mm`. */
export type HHmm = string;

export type Activity = 'run' | 'cycle' | 'swim' | 'strength' | 'rest';
export type WorkoutStatus = 'planned' | 'completed' | 'skipped';
export type HRZone = 1 | 2 | 3 | 4 | 5;

export type RunType = 'easy' | 'recovery' | 'tempo' | 'interval' | 'long';
export type CycleType = 'easy' | 'endurance' | 'tempo' | 'interval';
export type SwimType = 'easy' | 'technique' | 'endurance' | 'interval';
export type StrengthType = 'upper' | 'lower' | 'full' | 'mobility';
export type WorkoutType = RunType | CycleType | SwimType | StrengthType | 'rest';

export type Location = 'outdoor' | 'indoor' | 'pool' | 'openwater';

export interface IntervalSet {
  reps: number;
  /** Work distance in metres (optional). */
  distanceM?: number;
  /** Work duration in seconds (optional). */
  durationSec?: number;
  /** Recovery between reps in seconds. */
  recoverySec?: number;
  target?: string;
}

export interface WorkoutResult {
  durationMin?: number;
  distanceKm?: number;
  avgHr?: number;
  /** Pace or speed exactly as the user typed it, e.g. `5:30` (/km), `1:55` (/100 m) or `28` (km/h). */
  avgPace?: string;
  rpe?: number;
  notes?: string;
  /** Strava activity this result came from (prevents importing it twice). */
  stravaId?: number;
  completedAt: string;
}

/** Fields shared by every synced record. */
export interface SyncFields {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete tombstone so deletions propagate to other devices. */
  deleted?: boolean;
  /** 1 when the record has local changes not yet pushed to the cloud. */
  dirty?: 0 | 1;
}

export interface Workout extends SyncFields {
  date: ISODate;
  startTime?: HHmm;
  activity: Activity;
  type: WorkoutType;
  location?: Location;
  durationMin: number;
  distanceKm?: number;
  hrZone?: HRZone;
  target?: string;
  notes?: string;
  intervals?: IntervalSet[];
  status: WorkoutStatus;
  /** Sort order inside a day. */
  order: number;
  result?: WorkoutResult;
}

export type TrainingAllowance = 'yes' | 'limited' | 'no';

export interface DutyType extends SyncFields {
  code: string;
  label: string;
  color: string;
  allowsTraining: TrainingAllowance;
  builtin?: boolean;
  /** Extra keywords used to match imported roster entries to this type. */
  keywords?: string[];
}

export type DutySource = 'manual' | 'csv' | 'ics' | 'pdf' | 'aims';

export interface Duty extends SyncFields {
  date: ISODate;
  dutyTypeId: string;
  startTime?: HHmm;
  /** End date for duties that run past midnight or span several days. Defaults to `date`. */
  endDate?: ISODate;
  endTime?: HHmm;
  title?: string;
  notes?: string;
  source: DutySource;
  /** Stable fingerprint used to detect duplicate imports. */
  sourceKey?: string;
}

export interface WorkoutTemplate extends SyncFields {
  name: string;
  activity: Activity;
  type: WorkoutType;
  location?: Location;
  durationMin: number;
  distanceKm?: number;
  hrZone?: HRZone;
  target?: string;
  notes?: string;
  intervals?: IntervalSet[];
}

export interface RuleConfig {
  consecutiveHard: { enabled: boolean; maxDays: number };
  hardRecovery: { enabled: boolean; minHours: number };
  consecutiveRun: { enabled: boolean; maxDays: number };
  weeklyRest: { enabled: boolean; minDays: number };
  /** bufferMin before/after a duty; after a duty that ends past midnight, overnightRestMin applies instead. */
  dutyOverlap: { enabled: boolean; bufferMin: number; overnightRestMin?: number };
  runVolume: { enabled: boolean; maxIncreasePct: number; minBaseKm: number };
  /** Max long runs, interval sessions and tempo sessions per week — each counted separately. */
  keySessionsPerWeek: { enabled: boolean; max: number };
  /** Hard sessions: at least minHours before an early report (before 08:00), and not the day after an overnight duty. */
  hardNearDuty: { enabled: boolean; minHours: number };
}

export interface HRZoneRange {
  min: number;
  max: number;
}

export type Units = 'metric' | 'imperial';
export type Language = 'en' | 'th';
export type ThemePref = 'dark' | 'light' | 'system';

export interface AppSettings {
  id: 'app';
  onboarded: boolean;
  units: Units;
  language: Language;
  theme: ThemePref;
  weekStartsOn: 0 | 1;
  maxHr?: number;
  restingHr?: number;
  hrZones: Record<HRZone, HRZoneRange>;
  rules: RuleConfig;
  sync: {
    enabled: boolean;
    url?: string;
    anonKey?: string;
    lastPulledAt?: string;
    lastSyncedAt?: string;
    lastError?: string;
  };
  deviceId: string;
  /** Monthly backup reminder: when a backup was last saved, and until when "Later" hides it. */
  backup?: { lastAt?: string; snoozeUntil?: string };
  /** Strava link: `token` is the Worker-encrypted Strava token, unreadable on the device. */
  strava?: { token: string; athlete?: string; connectedAt: string; lastSyncAt?: string };
  /** The "add to Home Screen" card was closed. */
  installHintDismissed?: boolean;
  /** One-off data migrations already applied on this device. */
  migrations?: string[];
  updatedAt: string;
}

/** A warning is acknowledged by storing its key; the workout itself is never modified. */
export interface RuleOverride {
  key: string;
  createdAt: string;
}

/** A losing version from a sync conflict, kept so the user never silently loses data. */
export interface SyncConflict {
  id: string;
  table: 'workouts' | 'duties' | 'dutyTypes' | 'templates';
  recordId: string;
  local: unknown;
  remote: unknown;
  keptVersion: 'local' | 'remote';
  createdAt: string;
}
