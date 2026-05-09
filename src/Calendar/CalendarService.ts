import * as cheerio from "cheerio";
import { format } from "date-fns";
import { IServApiError } from "../Core/Errors.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type {
  AlarmType,
  CalendarEvent,
  CalendarEventSearchResult,
  CalendarEventSource,
  CalendarEventsByCalendar,
  CreateEventOptions,
  DeleteEventOptions,
  Recurring,
  UpcomingEvents,
} from "./CalendarTypes.js";

const log = createLogger("Calendar");

const ALARM_PRESETS = ["0M", "5M", "15M", "30M", "1H", "2H", "12H", "1D", "2D", "7D"] as const;

type FormData = Record<string, string | string[] | number | boolean>;

function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    throw new IServApiError(`Invalid date: "${dateStr}"`, 400);
  }
  return date;
}

function offsetMinutes(dateStr: string): number {
  const m = dateStr.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2] ?? "0", 10) * 60 + parseInt(m[3] ?? "0", 10));
}

function formatLocal(dateStr: string, fmt: string): string {
  const date = parseDate(dateStr);
  const offset = offsetMinutes(dateStr);
  const adjusted = new Date(date.getTime() + offset * 60_000);
  return format(adjusted, fmt);
}

function toIsoMs(date: Date): string {
  return date.toISOString();
}

function stringifyStatusResponse(value: unknown, fallback: Record<string, unknown>): string {
  if (typeof value !== "string") {
    return JSON.stringify({ status: "success", ...fallback, data: value });
  }

  try {
    const parsed = parseJson<Record<string, unknown>>(value, "calendar write response");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify({ status: "success", ...parsed });
    }
  } catch {}

  return JSON.stringify({ status: "success", ...fallback, data: value });
}

function parseAlarmPreset(preset: string): { days: number; hours: number; minutes: number } {
  const num = parseInt(preset, 10);
  const unit = preset.slice(String(num).length);
  if (unit === "M") return { days: 0, hours: 0, minutes: num };
  if (unit === "H") return { days: 0, hours: num, minutes: 0 };
  if (unit === "D") return { days: num, hours: 0, minutes: 0 };
  return { days: 0, hours: 0, minutes: 0 };
}

function buildAlarmData(alarms: AlarmType[], start: Date): FormData {
  const result: FormData = {};
  for (let i = 0; i < alarms.length; i++) {
    const alarm = alarms[i];
    if (alarm === undefined) continue;

    if (typeof alarm === "string") {
      if (!(ALARM_PRESETS as readonly string[]).includes(alarm)) {
        throw new IServApiError(
          `Invalid alarm preset: ${alarm}. Must be one of ${ALARM_PRESETS.join(", ")}`,
          400,
        );
      }
      const { days, hours, minutes } = parseAlarmPreset(alarm);
      const typeStr = alarm.endsWith("D") ? `P${alarm}` : `PT${alarm}`;
      result[`eventForm[alarms][${i}][trigger][type]`] = typeStr;
      result[`eventForm[alarms][${i}][trigger][interval][days]`] = String(days);
      result[`eventForm[alarms][${i}][trigger][interval][hours]`] = String(hours);
      result[`eventForm[alarms][${i}][trigger][interval][minutes]`] = String(minutes);
      result[`eventForm[alarms][${i}][trigger][before]`] = "1";
      result[`eventForm[alarms][${i}][trigger][dateTime]`] = `${format(start, "dd.MM.yyyy")}+00:00`;
    } else if ("custom_date_time" in alarm) {
      const dt = parseDate(alarm.custom_date_time.dateTime);
      result[`eventForm[alarms][${i}][trigger][type]`] = "custom_date_time";
      result[`eventForm[alarms][${i}][trigger][interval][days]`] = "0";
      result[`eventForm[alarms][${i}][trigger][interval][hours]`] = "0";
      result[`eventForm[alarms][${i}][trigger][interval][minutes]`] = "0";
      result[`eventForm[alarms][${i}][trigger][before]`] = "1";
      result[`eventForm[alarms][${i}][trigger][dateTime]`] = format(dt, "dd.MM.yyyy HH:mm");
    } else if ("custom_interval" in alarm) {
      const ci = alarm.custom_interval;
      if (!("days" in ci.interval && "hours" in ci.interval && "minutes" in ci.interval)) {
        throw new IServApiError("custom_interval.interval must have days, hours, minutes", 400);
      }
      result[`eventForm[alarms][${i}][trigger][type]`] = "custom_interval";
      result[`eventForm[alarms][${i}][trigger][interval][days]`] = String(ci.interval.days);
      result[`eventForm[alarms][${i}][trigger][interval][hours]`] = String(ci.interval.hours);
      result[`eventForm[alarms][${i}][trigger][interval][minutes]`] = String(ci.interval.minutes);
      result[`eventForm[alarms][${i}][trigger][before]`] = ci.before ? "1" : "0";
      result[`eventForm[alarms][${i}][trigger][dateTime]`] = `${format(start, "dd.MM.yyyy")}+00:00`;
    }
  }
  return result;
}

function buildRecurringData(recurring: Recurring): FormData {
  if (!recurring.intervalType) throw new IServApiError("intervalType must be present!", 400);

  if (
    recurring.intervalType !== "WEEKDAYS" &&
    recurring.intervalType !== "NO" &&
    recurring.interval === undefined
  ) {
    throw new IServApiError("interval must be present!", 400);
  }

  if (recurring.interval !== undefined && (recurring.interval < 1 || recurring.interval > 30)) {
    throw new IServApiError("Interval can only be between 1 and 30", 400);
  }

  if (recurring.intervalType === "MONTHLY") {
    if (!recurring.monthlyIntervalType)
      throw new IServApiError("monthlyIntervalType must be present!", 400);
    if (recurring.monthlyIntervalType === "BYDAY") {
      if (!recurring.monthInterval) throw new IServApiError("monthInterval must be present!", 400);
      if (!recurring.monthDay) throw new IServApiError("monthDay must be present!", 400);
    }
    if (recurring.monthlyIntervalType === "BYMONTHDAY") {
      if (!recurring.monthDayInMonth)
        throw new IServApiError("monthDayInMonth must be present!", 400);
    }
  }

  if (recurring.intervalType === "WEEKLY" && !recurring.recurrenceDays) {
    throw new IServApiError("recurrenceDays must be present!", 400);
  }

  if (recurring.intervalType !== "NO") {
    if (!recurring.endType) throw new IServApiError("endType must be present!", 400);
    if (recurring.endType === "COUNT" && recurring.endInterval === undefined) {
      throw new IServApiError("endInterval must be present!", 400);
    }
    if (recurring.endType === "UNTIL" && !recurring.untilDate) {
      throw new IServApiError("untilDate must be present!", 400);
    }
  }

  const result: FormData = {};
  if (recurring.intervalType) result["eventForm[recurring][intervalType]"] = recurring.intervalType;
  if (recurring.interval !== undefined)
    result["eventForm[recurring][interval]"] = String(recurring.interval);
  if (recurring.monthlyIntervalType)
    result["eventForm[recurring][monthlyIntervalType]"] = recurring.monthlyIntervalType;
  if (recurring.monthDayInMonth !== undefined)
    result["eventForm[recurring][monthDayInMonth]"] = String(recurring.monthDayInMonth);
  if (recurring.monthInterval !== undefined)
    result["eventForm[recurring][monthInterval]"] = String(recurring.monthInterval);
  if (recurring.monthDay) result["eventForm[recurring][monthDay]"] = recurring.monthDay;
  if (recurring.recurrenceDays)
    result["eventForm[recurring][recurrenceDays][]"] = recurring.recurrenceDays;
  if (recurring.endType) result["eventForm[recurring][endType]"] = recurring.endType;
  if (recurring.endInterval !== undefined)
    result["eventForm[recurring][endInterval]"] = String(recurring.endInterval);
  if (recurring.untilDate) result["eventForm[recurring][untilDate]"] = recurring.untilDate;
  return result;
}

async function resolveParticipants(
  participants: string[],
  session: IServSession,
): Promise<string[]> {
  return Promise.all(
    participants.map(async (participant) => {
      const results = await session.http.get(`${session.baseUrl()}/iserv/core/autocomplete/api`, {
        params: { type: "list,mail", query: participant, limit: 1 },
      });
      const items = parseJson<Array<{ value: string }>>(results.data, "participant lookup");
      if (!Array.isArray(items) || !items[0] || typeof items[0].value !== "string") {
        throw new IServApiError(`User "${participant}" not found!`, 404);
      }
      return items[0].value;
    }),
  );
}

function buildEventFormData(
  options: CreateEventOptions,
  token: string,
  startDate: Date,
  endDate: Date,
  resolvedParticipants: string[],
): URLSearchParams {
  const {
    subject,
    calendar,
    category = "",
    location = "",
    alarms = [],
    description = "",
    showMeAs = "OPAQUE",
    privacy = "PUBLIC",
    recurring = {},
  } = options;

  const data: FormData = {
    "eventForm[uid]": "",
    "eventForm[etag]": "",
    "eventForm[hash]": "",
    "eventForm[calendarOrg]": "",
    "eventForm[startOrg]": "",
    "eventForm[action]": "create",
    "eventForm[seriesAction]": "",
    "eventForm[invited]": "",
    "eventForm[subscription]": "",
    "eventForm[subject]": subject,
    "eventForm[calendar]": calendar,
    "eventForm[category]": category,
    "eventForm[location]": location,
    "eventForm[startDate]": format(startDate, "dd.MM.yyyy"),
    "eventForm[startTime]": format(startDate, "HH:mm"),
    "eventForm[endDate]": format(endDate, "dd.MM.yyyy"),
    "eventForm[endTime]": format(endDate, "HH:mm"),
    "eventForm[description]": description,
    "eventForm[showMeAs]": showMeAs,
    "eventForm[privacy]": privacy,
    "eventForm[recurring][intervalType]": "NO",
    "eventForm[recurring][interval]": "1",
    "eventForm[recurring][monthlyIntervalType]": "BYMONTHDAY",
    "eventForm[recurring][monthDayInMonth]": "",
    "eventForm[recurring][endType]": "NEVER",
    "eventForm[submit]": "",
    "eventForm[_token]": token,
    "eventForm[participants][]": resolvedParticipants,
  };

  const recurringData =
    Object.keys(recurring).length > 0 ? buildRecurringData(recurring as Recurring) : {};
  const alarmData = alarms.length > 0 ? buildAlarmData(alarms, startDate) : {};
  const mergedData: FormData = { ...data, ...recurringData, ...alarmData };

  const formData = new URLSearchParams();
  for (const [key, value] of Object.entries(mergedData)) {
    if (Array.isArray(value)) {
      for (const v of value) formData.append(key, String(v));
    } else {
      formData.append(key, String(value));
    }
  }
  return formData;
}

export class CalendarService {
  constructor(private readonly session: IServSession) {}

  async getUpcomingEvents(): Promise<UpcomingEvents> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/api/upcoming`,
    );
    log.info("Got upcoming events");
    return parseJson<UpcomingEvents>(res.data, "upcoming calendar events");
  }

  async getEventSources(): Promise<CalendarEventSource[]> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/api/eventsources`,
    );
    log.info("Got event sources");
    return parseJson<CalendarEventSource[]>(res.data, "calendar event sources");
  }

  async getEvents(start: string, end: string): Promise<CalendarEventsByCalendar> {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/feed/calendar-multi`,
      {
        params: {
          start: format(startDate, "yyyy-MM-dd"),
          end: format(endDate, "yyyy-MM-dd"),
        },
      },
    );
    log.debug(`Got calendar events from ${start} to ${end}`);
    return parseJson<CalendarEventsByCalendar>(res.data, "calendar events");
  }

  async searchEvents(
    query: string,
    start: string,
    end: string,
  ): Promise<CalendarEventSearchResult[]> {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/api/lookup_event`,
      {
        params: {
          summary: query,
          start: toIsoMs(startDate),
          end: toIsoMs(endDate),
        },
      },
    );
    log.debug(`Searched events: "${query}" from ${start} to ${end}`);
    return parseJson<CalendarEventSearchResult[]>(res.data, "calendar event search");
  }

  async getPluginEvents(plugin: string, start: string, end: string): Promise<CalendarEvent[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(plugin)) {
      throw new IServApiError(`Invalid plugin name: "${plugin}"`, 400);
    }
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/feed/plugin`,
      {
        params: {
          plugin,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      },
    );
    log.debug(`Got ${plugin} events from ${start} to ${end}`);
    return parseJson<CalendarEvent[]>(res.data, `${plugin} calendar events`);
  }

  async deleteEvent(options: DeleteEventOptions): Promise<string> {
    const { uid, hash, calendar, start, series = false } = options;
    if (!/^[A-Za-z0-9_@.-]+$/.test(uid)) throw new IServApiError("Invalid uid", 400);
    if (!/^[A-Za-z0-9_=-]+$/.test(hash)) throw new IServApiError("Invalid hash", 400);
    if (!/^[A-Za-z0-9_@./-]+$/.test(calendar) || calendar.includes("..")) {
      throw new IServApiError("Invalid calendar", 400);
    }
    const res = await this.session.http.post(
      `${this.session.baseUrl()}/iserv/calendar/delete`,
      null,
      {
        params: {
          uid,
          hash,
          cal: calendar,
          start:
            formatLocal(start, "yyyy-MM-dd'T'HH:mm:ss") +
            (start.match(/([+-]\d{2}:\d{2})$/)?.[1] ?? "Z"),
          edit_series: series ? "series" : "single",
        },
      },
    );
    log.debug(`Deleted event ${uid}`);
    return stringifyStatusResponse(res.data, { uid, calendar });
  }

  async createEvent(options: CreateEventOptions): Promise<string> {
    const { subject, calendar, start, end, isAllDayLong = false, participants = [] } = options;

    const tokenRes = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/calendar/create_simple`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "*/*",
        },
      },
    );

    const $ = cheerio.load(tokenRes.data as string);
    const token = $("#eventForm__token").val() as string | undefined;
    if (!token) throw new IServApiError("Could not retrieve CSRF token for event creation", 500);

    const startDate = parseDate(start);
    const endDate = parseDate(end);
    const resolvedParticipants = await resolveParticipants(participants, this.session);
    const formData = buildEventFormData(options, token, startDate, endDate, resolvedParticipants);

    const res = await this.session.http.post(
      `${this.session.baseUrl()}/iserv/calendar/create`,
      formData.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        params: {
          subject,
          calendar,
          start: formatLocal(start, "dd.MM.yyyy"),
          end: formatLocal(end, "dd.MM.yyyy"),
          startTime: formatLocal(start, "HH:mm"),
          endTime: formatLocal(end, "HH:mm"),
          allDay: isAllDayLong,
        },
      },
    );

    const $res = cheerio.load(res.data as string);
    const error = $res("[data-type='error']").text().trim();
    if (error) throw new IServApiError(`IServ rejected event: ${error}`, 422);

    log.info("Event created");
    return JSON.stringify({
      status: "success",
      subject,
      calendar,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      ...(resolvedParticipants.length > 0 && { participants: resolvedParticipants }),
    });
  }
}
