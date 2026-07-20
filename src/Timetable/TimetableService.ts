import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type {
  TimetableChange,
  TimetableLesson,
  TimetableWeek,
} from "./TimetableTypes.js";

dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);

const log = createLogger("Timetable");

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface RawMeta {
  filter?: {
    startDate?: string;
    endDate?: string;
    classes?: string[];
  };
  "last-updated"?: string;
}

interface RawLesson {
  id: number;
  class: string;
  teacher: string | null;
  subject: string;
  room: string | null;
  dow: number;
  period: number;
  date: string;
}

interface RawDataResponse {
  meta?: RawMeta;
  data?: {
    timetable?: RawLesson[];
    changes?: unknown[];
  };
  "plain-timetable"?: unknown;
  "plain-changes"?: unknown;
}

interface MetaResponse {
  meta?: { minperiod?: number; maxperiod?: number; maxdow?: number };
  "personal-filter"?: {
    classes?: string[];
    teachers?: string[];
    rooms?: string[];
    startDate?: string | null;
    endDate?: string | null;
  };
}

function weekRange(from?: string): { startDate: string; endDate: string } {
  const base = from
    ? dayjs(from, ["DD.MM.YYYY", "YYYY-MM-DD", "MM/DD/YYYY"], true)
    : dayjs();
  const start = (base.isValid() ? base : dayjs()).startOf("isoWeek");
  const end = start.add(4, "day"); // Mon-Fri
  return {
    startDate: start.format("DD.MM.YYYY"),
    endDate: end.format("DD.MM.YYYY"),
  };
}

function lessonLabel(lesson: TimetableLesson): string {
  const parts = [lesson.subject];
  if (lesson.room) parts.push(lesson.room);
  if (lesson.teacher) parts.push(lesson.teacher);
  return parts.join(" · ");
}

function buildGrid(lessons: TimetableLesson[], maxDow: number): {
  days: string[];
  periods: number[];
  grid: Record<string, Record<string, string>>;
  rows: Array<Record<string, string>>;
} {
  const days = DAY_NAMES.slice(0, Math.max(1, Math.min(maxDow, 7)));
  const periodSet = new Set<number>();
  for (const lesson of lessons) periodSet.add(lesson.period);
  const periods = [...periodSet].sort((a, b) => a - b);
  if (periods.length === 0) {
    for (let p = 1; p <= 10; p++) periods.push(p);
  }

  const grid: Record<string, Record<string, string>> = {};
  const buckets = new Map<string, TimetableLesson[]>();
  for (const lesson of lessons) {
    const day = DAY_NAMES[lesson.dayOfWeek - 1] ?? `Day ${lesson.dayOfWeek}`;
    const key = `${lesson.period}|${day}`;
    const list = buckets.get(key) ?? [];
    list.push(lesson);
    buckets.set(key, list);
  }

  const rows: Array<Record<string, string>> = [];
  for (const period of periods) {
    const row: Record<string, string> = { Period: String(period) };
    const gridRow: Record<string, string> = {};
    for (const day of days) {
      const list = buckets.get(`${period}|${day}`) ?? [];
      const label = list.map(lessonLabel).join(" / ") || "—";
      row[day] = label;
      gridRow[day] = label;
    }
    grid[String(period)] = gridRow;
    rows.push(row);
  }

  return { days, periods, grid, rows };
}

export class TimetableService {
  constructor(private readonly session: IServSession) {}

  async getMeta(): Promise<MetaResponse> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/timetable/jsonttdata`,
    );
    return parseJson<MetaResponse>(res.data, "timetable meta");
  }

  async getWeek(options: { startDate?: string; endDate?: string } = {}): Promise<TimetableWeek> {
    const meta = await this.getMeta();
    const personal = meta["personal-filter"] ?? {};
    const classes = (personal.classes ?? []).filter((c) => c && c !== "%");
    const teachers = personal.teachers?.length ? personal.teachers : ["%"];
    const rooms = personal.rooms?.length ? personal.rooms : ["%"];
    const range = weekRange(options.startDate);
    const startDate = options.startDate
      ? dayjs(options.startDate, ["DD.MM.YYYY", "YYYY-MM-DD"], true).isValid()
        ? dayjs(options.startDate, ["DD.MM.YYYY", "YYYY-MM-DD"], true).format("DD.MM.YYYY")
        : range.startDate
      : range.startDate;
    const endDate = options.endDate
      ? dayjs(options.endDate, ["DD.MM.YYYY", "YYYY-MM-DD"], true).isValid()
        ? dayjs(options.endDate, ["DD.MM.YYYY", "YYYY-MM-DD"], true).format("DD.MM.YYYY")
        : range.endDate
      : range.endDate;

    const filter = {
      startDate,
      endDate,
      classes: classes.length > 0 ? classes : ["%"],
      teachers,
      rooms,
    };

    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/timetable/data`,
      { params: { filter: JSON.stringify(filter) } },
    );
    const payload = parseJson<RawDataResponse>(res.data, "timetable data");
    const rawLessons = payload.data?.timetable ?? [];
    const lessons: TimetableLesson[] = rawLessons.map((lesson) => ({
      id: lesson.id,
      class: lesson.class,
      teacher: lesson.teacher,
      subject: lesson.subject,
      room: lesson.room,
      dayOfWeek: lesson.dow,
      period: lesson.period,
      date: lesson.date,
    }));

    const changes = (payload.data?.changes ?? []) as TimetableChange[];
    const maxDow = meta.meta?.maxdow ?? 5;
    const { days, periods, grid, rows } = buildGrid(lessons, maxDow);

    log.info("Got timetable week");
    return {
      class: classes[0] ?? "personal",
      startDate,
      endDate,
      lastUpdated: payload.meta?.["last-updated"],
      days,
      periods,
      grid,
      lessons,
      changes,
      rows,
    };
  }
}
