import type { JsonValue } from "../Core/HttpClient.js";

export type IntervalType = "NO" | "DAILY" | "WEEKDAYS" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type WeekDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type AlarmPreset = "0M" | "5M" | "15M" | "30M" | "1H" | "2H" | "12H" | "1D" | "2D" | "7D";

export interface Recurring {
  intervalType?: IntervalType;
  interval?: number;
  monthlyIntervalType?: "BYMONTHDAY" | "BYDAY";
  monthDayInMonth?: number;
  monthInterval?: 1 | 2 | 3 | 4 | -1;
  monthDay?: WeekDay;
  recurrenceDays?: WeekDay[];
  endType?: "NEVER" | "COUNT" | "UNTIL";
  endInterval?: number;
  untilDate?: string;
}

export interface CustomDateTimeAlarm {
  custom_date_time: {
    dateTime: string;
  };
}

export interface CustomIntervalAlarm {
  custom_interval: {
    interval: {
      days: number;
      hours: number;
      minutes: number;
    };
    before: boolean;
  };
}

export type AlarmType = AlarmPreset | CustomDateTimeAlarm | CustomIntervalAlarm;

export interface CreateEventOptions {
  subject: string;
  calendar: string;
  start: string;
  end: string;
  category?: string;
  location?: string;
  alarms?: AlarmType[];
  isAllDayLong?: boolean;
  description?: string;
  participants?: string[];
  showMeAs?: "OPAQUE" | "TRANSPARENT";
  privacy?: "PUBLIC" | "CONFIDENTIAL" | "PRIVATE";
  recurring?: Recurring;
}

export interface DeleteEventOptions {
  uid: string;
  hash: string;
  calendar: string;
  start: string;
  series?: boolean;
}

export type CalendarEvent = Record<string, JsonValue>;

export interface UpcomingEvents {
  events: CalendarEvent[];
  errors: JsonValue[];
}

export interface CalendarEventSource {
  label: string;
  id: string;
  subscription: boolean;
  color: string;
  textColor: string;
  url: string;
  type: "cal" | "plugin" | string;
  droppable: boolean;
}

export type CalendarEventsByCalendar = Record<string, CalendarEvent[]>;

export type CalendarEventSearchResult = Record<string, JsonValue>;
