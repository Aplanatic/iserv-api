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
  /** period -> day-name -> lesson label(s) */
  grid: Record<string, Record<string, string>>;
  lessons: TimetableLesson[];
  changes: TimetableChange[];
  rows: Array<Record<string, string>>;
}
