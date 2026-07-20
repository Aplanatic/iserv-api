import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { IServApiError } from "../Core/Errors.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("Modules");

export interface ModuleListResult {
  title: string;
  empty?: boolean;
  message?: string;
  items: Array<Record<string, string>>;
  tables?: Array<{ headers: string[]; rows: Array<Record<string, string>> }>;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function loadContent(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, aside, .navbar, .sidebar, .breadcrumb, .fileupload, .dropzone, .modal").remove();
  const content = $("#content").first().length
    ? $("#content").first()
    : $("main").first();
  return { $, content };
}

function tableRows(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<Element>,
): { headers: string[]; rows: Array<Record<string, string>> } {
  const headers: string[] = [];
  table.find("thead tr").first().find("th, td").each((_i, cell) => {
    headers.push(clean($(cell).text()));
  });
  while (headers.length && !headers[0]) headers.shift();
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const finalHeaders = headers.map((h, i) => h || `Col ${i + 1}`);

  const rows: Array<Record<string, string>> = [];
  table.find("tbody tr").each((_i, row) => {
    const values: string[] = [];
    $(row)
      .find("td, th")
      .each((_j, cell) => values.push(clean($(cell).text())));
    while (values.length && !values[0] && values.length > finalHeaders.length) {
      values.shift();
    }
    while (
      values.length &&
      !values[values.length - 1] &&
      values.length > finalHeaders.length
    ) {
      values.pop();
    }
    if (values.every((v) => !v || /^(delete|hide|edit|show|highlight unread posts)$/i.test(v))) {
      return;
    }
    // Skip section header rows with a single label
    if (values.length === 1 && finalHeaders.length > 1) return;

    const data: Record<string, string> = {};
    if (finalHeaders.length) {
      finalHeaders.forEach((h, i) => {
        if (values[i]) data[h] = values[i]!;
      });
    } else {
      values.forEach((v, i) => {
        if (v) data[`Col ${i + 1}`] = v;
      });
    }
    // Clean forum title noise and duplicated deadline cells
    if (data.Title) {
      data.Title = data.Title.replace(/\s*Highlight unread posts\s*/gi, "").trim();
    }
    for (const key of Object.keys(data)) {
      const text = data[key]!;
      // Collapse accidental doubled cell text (common in IServ deadline columns)
      if (text.length >= 8 && text.length % 2 === 0) {
        const half = text.length / 2;
        if (text.slice(0, half) === text.slice(half)) {
          data[key] = text.slice(0, half);
        }
      }
      // Prefer first datetime if two were concatenated
      if (/deadline|date|edited|created|post/i.test(key)) {
        const m = text.match(
          /^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M)/i,
        );
        if (m) data[key] = m[1]!;
      }
      if (!data[key] || /^none$/i.test(data[key]!)) delete data[key];
    }
    // Drop noisy href-only columns from display payloads later; keep for now if useful
    if (Object.keys(data).length) rows.push(data);
  });
  return { headers: finalHeaders, rows };
}

export class ModulePageService {
  constructor(private readonly session: IServSession) {}

  private async getHtml(path: string): Promise<string> {
    const res = await this.session.http.get(`${this.session.baseUrl()}${path}`);
    return res.data as string;
  }

  async listNews(options: { search?: string; limit?: number } = {}): Promise<ModuleListResult> {
    const params = options.search ? `?search=${encodeURIComponent(options.search)}` : "";
    const html = await this.getHtml(`/iserv/news${params}`);
    const { $, content } = loadContent(html);
    // Remove sidebar panels
    content.find(".panel-heading").each((_i, el) => {
      const h = clean($(el).text()).toLowerCase();
      if (["search", "latest", "categories", "news subscriptions"].includes(h)) {
        $(el).closest(".panel").remove();
      }
    });
    const limit = options.limit ?? 25;
    const items: Array<Record<string, string>> = [];
    content.find(".row.news").each((i, el) => {
      if (i >= limit) return;
      const $el = $(el);
      const title = clean($el.find(".news-title a, h3 a, h3").first().text());
      if (!title) return;
      const href = $el.find(".news-title a, h3 a").first().attr("href") ?? "";
      const meta = clean(
        $el.find(".text-muted, small, .news-meta").first().text() ||
          $el
            .text()
            .replace(title, "")
            .split("|")
            .slice(0, 2)
            .join(" | ")
            .slice(0, 120),
      );
      const body = clean(
        $el.find("p, .news-content").first().text(),
      ).slice(0, 240);
      const idMatch = href.match(/\/news\/show\/(\d+)/);
      items.push({
        title,
        ...(idMatch?.[1] ? { id: idMatch[1] } : {}),
        ...(meta ? { meta } : {}),
        ...(body ? { summary: body } : {}),
        ...(href ? { href } : {}),
      });
    });
    log.info("Listed news");
    return {
      title: "News",
      empty: items.length === 0,
      ...(items.length === 0 ? { message: "No news entries found." } : {}),
      items,
    };
  }

  async showNews(id: string): Promise<ModuleListResult> {
    const trimmed = id.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new IServApiError(
        `Invalid news id "${id}". Use a numeric id from news list (e.g. 360).`,
        400,
      );
    }
    let html: string;
    try {
      html = await this.getHtml(`/iserv/news/show/${encodeURIComponent(trimmed)}`);
    } catch (error) {
      if (error instanceof IServApiError && [403, 404, 500].includes(error.status)) {
        throw new IServApiError(
          `News entry ${trimmed} was not found or is not readable. Run news list to see available ids.`,
          error.status === 500 ? 404 : error.status,
        );
      }
      throw error;
    }
    const { $, content } = loadContent(html);
    const title =
      clean(content.find("h1, h2, h3, .news-title").first().text()) ||
      `News ${trimmed}`;
    const meta = clean(content.find(".text-muted, small").first().text());
    const paragraphs = content
      .find("p")
      .map((_i, el) => clean($(el).text()))
      .get()
      .filter((p) => p.length > 0);
    const body = paragraphs.join("\n\n");
    return {
      title,
      items: [
        {
          title,
          ...(meta ? { meta } : {}),
          ...(body ? { body: body.slice(0, 4000) } : {}),
          id: trimmed,
        },
      ],
    };
  }

  async listExercises(options: { search?: string } = {}): Promise<ModuleListResult> {
    const params = options.search
      ? `?filter%5Bsearch%5D=${encodeURIComponent(options.search)}`
      : "";
    return this.listTablePage(`/iserv/exercise${params}`, "Current exercises", [
      "Exercise",
      "Deadline",
      "Feedbacks",
      "Tags",
    ]);
  }

  async listPastExercises(): Promise<ModuleListResult> {
    return this.listTablePage(
      "/iserv/exercise/past/exercise",
      "Past exercises",
      ["Exercise", "Deadline", "Feedbacks", "Tags"],
    );
  }

  async listForums(): Promise<ModuleListResult> {
    return this.listTablePage("/iserv/forums", "Forums", [
      "Title",
      "Topics",
      "Posts",
      "New",
      "Last post",
    ]);
  }

  async listEtherpads(): Promise<ModuleListResult> {
    return this.listTablePage("/iserv/etherpad", "Etherpads", [
      "Title",
      "Owner",
      "Last edited",
      "Created",
      "Tags",
    ]);
  }

  async listMailingLists(): Promise<ModuleListResult> {
    return this.listTablePage("/iserv/mailinglist", "Mailing lists", [
      "Title",
      "Owner",
      "Entries",
    ]);
  }

  async listPolls(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/poll");
    const { $, content } = loadContent(html);
    const text = clean(content.text());
    const empty =
      /no polls|currently no polls|keine umfrage/i.test(text) ||
      content.find("table tbody tr td").length === 0;
    if (empty) {
      return {
        title: "Polls",
        empty: true,
        message:
          content.find(".alert, .text-muted, p").first().text().replace(/\s+/g, " ").trim() ||
          "There are currently no polls you can participate in.",
        items: [],
      };
    }
    return this.listTablePage("/iserv/poll", "Polls");
  }

  async listGroups(): Promise<ModuleListResult> {
    // Active-only view hides most memberships; showHidden=1 returns the full set.
    const html = await this.getHtml("/iserv/groupview?showHidden=1");
    const { $, content } = loadContent(html);
    const items: Array<Record<string, string>> = [];
    const seen = new Set<string>();
    content
      .find("a.group, .flex-item.group, a[href*='/iserv/groupview/']")
      .each((_i, el) => {
        const $el = $(el);
        const href = $el.attr("href") ?? "";
        if (!/\/iserv\/groupview\/[^/?#]+/i.test(href)) return;
        const name =
          clean($el.find("h4, .media-heading").first().text()) || clean($el.text());
        if (!name || /^show all groups$/i.test(name)) return;
        const key = href.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ name, href });
      });
    return {
      title: "Groups",
      empty: items.length === 0,
      ...(items.length === 0 ? { message: "No groups visible." } : {}),
      items,
    };
  }

  async listCourseSelections(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/courseselection");
    const { content } = loadContent(html);
    const text = clean(content.text());
    if (/no open selections|keine offenen/i.test(text) || text.length < 80) {
      return {
        title: "Course selections",
        empty: true,
        message:
          text || "There are no open selections at the moment.",
        items: [],
      };
    }
    return this.listTablePage("/iserv/courseselection", "Course selections");
  }

  async listPrintJobs(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/print");
    const { $, content } = loadContent(html);
    // Print page is mostly an upload form; surface job tokens if present.
    const text = clean(content.text());
    const jobs: Array<Record<string, string>> = [];
    const tokenMatch = text.match(/\(\d{2}\)[\d()A-Za-z-]+/g) ?? [];
    for (const token of tokenMatch.slice(0, 20)) {
      jobs.push({ job: token });
    }
    return {
      title: "Print",
      empty: jobs.length === 0,
      message:
        jobs.length === 0
          ? "No print jobs queued. Use the web UI to upload documents for printing."
          : undefined,
      items: jobs,
    };
  }

  async getOfficeInfo(): Promise<ModuleListResult> {
    return {
      title: "Office",
      items: [
        { action: "Create spreadsheet", type: "calculation" },
        { action: "Create document", type: "document" },
        { action: "Create presentation", type: "presentation" },
        { action: "Open existing file", type: "open" },
      ],
      message: "Office integration is available. Create or open documents from Files.",
    };
  }

  async getAccountSettings(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/account/settings");
    const { $, content } = loadContent(html);
    const items: Array<Record<string, string>> = [];
    content.find(".form-group").each((_i, group) => {
      const $g = $(group);
      const label = clean($g.find("label").first().text()).replace(/\*$/, "").trim();
      if (!label || label.length > 80) return;
      const select = $g.find("select").first();
      const checked = $g.find("input:checked");
      let value = "";
      if (select.length) {
        value = clean(select.find("option:selected").text());
      } else if (checked.length) {
        value = clean(checked.parent().text()) || String(checked.val() ?? "");
      } else {
        const input = $g.find("input:not([type=hidden]):not([type=submit])").first();
        value = String(input.val() ?? input.attr("value") ?? "").trim();
      }
      if (label && value) items.push({ setting: label, value });
    });
    return {
      title: "Account settings",
      empty: items.length === 0,
      items,
    };
  }

  async getHelpOverview(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/help");
    const { $, content } = loadContent(html);
    const items: Array<Record<string, string>> = [];
    content.find("a[href]").each((_i, a) => {
      const title = clean($(a).text());
      const href = $(a).attr("href") ?? "";
      if (!title || title.length < 3 || title.length > 100) return;
      if (href.startsWith("#") || href.includes("logout")) return;
      items.push({ title, href });
    });
    // Dedup
    const seen = new Set<string>();
    const unique = items.filter((item) => {
      if (seen.has(item.title!)) return false;
      seen.add(item.title!);
      return true;
    });
    return {
      title: "Help",
      empty: unique.length === 0,
      message:
        unique.length === 0
          ? "Help documentation is available in the IServ web UI."
          : undefined,
      items: unique.slice(0, 40),
    };
  }

  async getAccountLogins(): Promise<ModuleListResult> {
    const html = await this.getHtml("/iserv/account/info/last_logins");
    const { $, content } = loadContent(html);
    const table = content.find("table").first();
    if (!table.length) {
      return { title: "Recent logins", empty: true, message: "No login history found.", items: [] };
    }
    const { rows } = tableRows($, table as cheerio.Cheerio<Element>);
    return {
      title: "Recent logins",
      empty: rows.length === 0,
      items: rows.slice(0, 50),
    };
  }

  async getAccountInfoPage(): Promise<ModuleListResult> {
    // Prefer the same data as getOwnInfo when possible; fall back to login table.
    const html = await this.getHtml("/iserv/account/info");
    const { $, content } = loadContent(html);
    const tables = content.find("table");
    const allRows: Array<Record<string, string>> = [];
    tables.each((_i, table) => {
      const { rows } = tableRows($, $(table) as cheerio.Cheerio<Element>);
      allRows.push(...rows);
    });
    return {
      title: "Account information",
      empty: allRows.length === 0,
      items: allRows.slice(0, 50),
    };
  }

  private async listTablePage(
    path: string,
    title: string,
    preferredHeaders?: string[],
  ): Promise<ModuleListResult> {
    const html = await this.getHtml(path);
    const { $, content } = loadContent(html);
    const emptyText = clean(content.find(".alert, .text-muted, p").first().text());
    const tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }> = [];
    content.find("table").each((_i, table) => {
      const parsed = tableRows($, $(table) as cheerio.Cheerio<Element>);
      if (parsed.rows.length === 0) return;
      // Prefer tables that match preferred headers
      if (preferredHeaders?.length) {
        const headerSet = new Set(parsed.headers.map((h) => h.toLowerCase()));
        const hits = preferredHeaders.filter((h) => headerSet.has(h.toLowerCase())).length;
        if (hits === 0 && tables.length > 0) return;
      }
      // Skip pure upload progress tables
      if (
        parsed.headers.some((h) => /upload|progress|file list/i.test(h)) &&
        !parsed.headers.some((h) => /title|exercise|deadline|owner|entries/i.test(h))
      ) {
        return;
      }
      tables.push(parsed);
    });

    const primary = tables[0];
    if (!primary || primary.rows.length === 0) {
      return {
        title,
        empty: true,
        message: emptyText || `No ${title.toLowerCase()} found.`,
        items: [],
      };
    }
    log.info(`Listed ${title}`);
    return {
      title,
      empty: false,
      items: primary.rows,
      tables,
    };
  }
}
