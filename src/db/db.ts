import Dexie, { type Table } from 'dexie';
import type { AppSettings, Duty, DutyType, RuleOverride, SyncConflict, Workout, WorkoutTemplate } from '@/domain/types';

export class EnduranceDB extends Dexie {
  workouts!: Table<Workout, string>;
  duties!: Table<Duty, string>;
  dutyTypes!: Table<DutyType, string>;
  templates!: Table<WorkoutTemplate, string>;
  settings!: Table<AppSettings, string>;
  overrides!: Table<RuleOverride, string>;
  conflicts!: Table<SyncConflict, string>;

  // The database keeps its original name so existing data survives the rename to Ground Time.
  constructor(name = 'kim-endurance-lab') {
    super(name);
    this.version(1).stores({
      workouts: 'id, date, activity, status, updatedAt, dirty',
      duties: 'id, date, endDate, dutyTypeId, sourceKey, updatedAt, dirty',
      dutyTypes: 'id, code, updatedAt, dirty',
      templates: 'id, name, updatedAt, dirty',
      settings: 'id',
      overrides: 'key',
      conflicts: 'id, table, recordId, createdAt',
    });
  }
}

export const db = new EnduranceDB();

export type SyncedTable = 'workouts' | 'duties' | 'dutyTypes' | 'templates';
export const SYNCED_TABLES: SyncedTable[] = ['workouts', 'duties', 'dutyTypes', 'templates'];
