import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import { IServApiError } from "../Core/Errors.js";
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

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const DATE_FORMATS = ["DD.MM.YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;

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
    "orphan-changes"?: unknown[];
  };
  "plain-timetable"?: unknown;
  "plain-changes"?: unknown;
}

interface MetaResponse {
  meta?: {
    minperiod?: number;
    maxperiod?: number;
    maxdow?: number;
    canViewTeacherTimetable?: boolean;
    canViewTeacherChanges?: boolean;
  };
  "personal-filter"?: {
    classes?: string[];
    teachers?: string[];
    rooms?: string[];
    startDate?: string | null;
    endDate?: string | null;
  };
}

function parseRequiredDate(value: string, label: string): dayjs.Dayjs {
  const parsed = dayjs(value.trim(), DATE_FORMATS, true);
  if (!parsed.isValid()) {
    throw new IServApiError(
      `Invalid ${label}: "${value}". Use DD.MM.YYYY or YYYY-MM-DD.`,
      400,
    );
  }
  return parsed;
}

function lessonLabel(lesson: TimetableLesson): string {
  const parts = [lesson.subject];
  if (lesson.room) parts.push(lesson.room);
  if (lesson.teacher) parts.push(lesson.teacher);
  return parts.join(" · ");
}

function normalizeChange(raw: unknown): TimetableChange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const change: TimetableChange = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === null || value === undefined || value === "") continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      change[key] = value;
    }
  }
  return Object.keys(change).length > 0 ? change : null;
}

function collectChanges(payload: RawDataResponse): TimetableChange[] {
  const buckets = [
    payload.data?.changes,
    payload.data?.["orphan-changes"],
    Array.isArray(payload["plain-changes"]) ? payload["plain-changes"] : undefined,
  ];
  const out: TimetableChange[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      const normalized = normalizeChange(item);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

function buildPeriods(
  lessons: TimetableLesson[],
  meta?: MetaResponse["meta"],
): number[] {
  const periodSet = new Set<number>();
  for (const lesson of lessons) periodSet.add(lesson.period);
  if (periodSet.size === 0) {
    const min = meta?.minperiod ?? 1;
    const max = Math.max(min, meta?.maxperiod ?? 10);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  // Fill gaps (e.g. period 7 missing between 6 and 8) so empty slots stay visible
  const min = Math.min(...periodSet);
  const max = Math.max(...periodSet);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

function buildRows(
  lessons: TimetableLesson[],
  days: string[],
  periods: number[],
): Array<Record<string, string>> {
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
    for (const day of days) {
      const list = buckets.get(`${period}|${day}`) ?? [];
      row[day] = list.map(lessonLabel).join(" / ") || "—";
    }
    rows.push(row);
  }
  return rows;
}

export class TimetableService {
  constructor(private readonly session: IServSession) {}

  async getMeta(): Promise<MetaResponse> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/timetable/jsonttdata`,
    );
    return parseJson<MetaResponse>(res.data, "timetable meta");
  }

  async getWeek(
    options: { startDate?: string; endDate?: string } = {},
  ): Promise<TimetableWeek> {
    const meta = await this.getMeta();
    const personal = meta["personal-filter"] ?? {};
    const classes = (personal.classes ?? []).filter((c) => c && c !== "%");
    const teachers = personal.teachers?.length ? personal.teachers : ["%"];
    const rooms = personal.rooms?.length ? personal.rooms : ["%"];

    const requestedStart = options.startDate?.trim();
    const start = requestedStart
      ? parseRequiredDate(requestedStart, "start date").startOf("isoWeek")
      : dayjs().startOf("isoWeek");
    const end = options.endDate
      ? parseRequiredDate(options.endDate, "end date")
      : start.add(4, "day");

    if (end.isBefore(start, "day")) {
      throw new IServApiError(
        "Start date must be on or before end date.",
        400,
      );
    }

    const startDate = start.format("DD.MM.YYYY");
    const endDate = end.format("DD.MM.YYYY");
    const snappedRequested =
      requestedStart &&
      parseRequiredDate(requestedStart, "start date").format("DD.MM.YYYY") !==
        startDate
        ? requestedStart
        : undefined;

    const filter = {
      startDate,
      endDate,
      classes: classes.length > 0 ? classes : ["%"],
      teachers,
      rooms,
    };

    let payload: RawDataResponse;
    try {
      const res = await this.session.http.get(
        `${this.session.baseUrl()}/iserv/timetable/data`,
        { params: { filter: JSON.stringify(filter) } },
      );
      payload = parseJson<RawDataResponse>(res.data, "timetable data");
    } catch (error) {
      if (error instanceof IServApiError && error.status === 400) {
        throw new IServApiError(
          `Timetable rejected date range ${startDate} – ${endDate}. Pick a week inside the published school year.`,
          400,
        );
      }
      throw error;
    }

    const canViewTeachers = Boolean(meta.meta?.canViewTeacherTimetable);
    const canViewChanges = Boolean(meta.meta?.canViewTeacherChanges);

    const rawLessons = payload.data?.timetable ?? [];
    const lessons: TimetableLesson[] = rawLessons.map((lesson) => ({
      id: lesson.id,
      class: lesson.class,
      teacher: canViewTeachers ? lesson.teacher : null,
      subject: lesson.subject,
      room: lesson.room,
      dayOfWeek: lesson.dow,
      period: lesson.period,
      date: lesson.date,
    }));

    const changes = collectChanges(payload);
    const maxDow = meta.meta?.maxdow ?? 5;
    const days = DAY_NAMES.slice(0, Math.max(1, Math.min(maxDow, 7)));
    const periods = buildPeriods(lessons, meta.meta);
    const rows = buildRows(lessons, days, periods);

    const substitutionsUrl = await this.findSubstitutionsUrl().catch(() => undefined);
    const visibilityNote =
      !canViewTeachers && !canViewChanges
        ? "IServ does not expose teacher names or in-app substitutions for this account role."
        : !canViewTeachers
          ? "IServ does not expose teacher names for this account role."
          : !canViewChanges
            ? "IServ does not expose substitutions for this account role."
            : undefined;

    log.info("Got timetable week");
    return {
      class: classes[0] ?? "personal",
      startDate,
      endDate,
      ...(snappedRequested ? { requestedStart: snappedRequested } : {}),
      lastUpdated: payload.meta?.["last-updated"],
      days,
      periods,
      lessons,
      changes,
      rows,
      visibility: {
        teachers: canViewTeachers,
        changes: canViewChanges,
        ...(visibilityNote ? { note: visibilityNote } : {}),
        ...(substitutionsUrl ? { substitutionsUrl } : {}),
      },
    };
  }

  private async findSubstitutionsUrl(): Promise<string | undefined> {
    const res = await this.session.http.get(`${this.session.baseUrl()}/iserv`);
    const html = String(res.data);
    const match = html.match(
      /href="(https?:\/\/[^"]*vertretungsplan[^"]*)"/i,
    );
    return match?.[1];
  }
}
