export interface TimetableLesson {
  id: number;
  class: string;
  teacher: string | null;
  subject: string;
  room: string | null;
  dayOfWeek: number;
  period: number;
  date: string;
}

export interface TimetableChange {
  date?: string;
  period?: number | string;
  class?: string;
  subject?: string;
  room?: string;
  type?: string;
  text?: string;
  teacher?: string;
  [key: string]: unknown;
}

export interface TimetableWeek {
  class: string;
  startDate: string;
  endDate: string;
  lastUpdated?: string;
  days: string[];
  periods: number[];
  /** Structured lessons (source of truth). Teacher may be null when the account cannot view teachers. */
  lessons: TimetableLesson[];
  /** Substitutions/changes when the account can view them; otherwise usually empty. */
  changes: TimetableChange[];
  /** Period × weekday table for display (derived from lessons). */
  rows: Array<Record<string, string>>;
  /** What this account is allowed to see on the timetable API. */
  visibility: {
    teachers: boolean;
    changes: boolean;
  };
}
