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
  /** Original --start value when it was snapped to the ISO week Monday */
  requestedStart?: string;
  lastUpdated?: string;
  days: string[];
  periods: number[];
  /** Structured lessons (source of truth). Teacher omitted when the account cannot view teachers. */
  lessons: TimetableLesson[];
  /** Substitutions/changes when the account can view them; otherwise usually empty. */
  changes: TimetableChange[];
  /** Period × weekday table for display (derived from lessons). */
  rows: Array<Record<string, string>>;
  /** What this account is allowed to see on the timetable API. */
  visibility: {
    teachers: boolean;
    changes: boolean;
    note?: string;
    /** External substitutions board when IServ itself exposes no changes */
    substitutionsUrl?: string;
  };
}

export interface TimetableDay {
  class: string;
  date: string;
  dateLabel: string;
  dayName: string;
  dayOfWeek: number;
  lessons: TimetableLesson[];
  /** Compact period rows for display */
  rows: Array<Record<string, string>>;
  changes: TimetableChange[];
  lastUpdated?: string;
  visibility: TimetableWeek["visibility"];
  empty: boolean;
  message?: string;
}
