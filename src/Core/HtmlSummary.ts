import { load } from "cheerio";
import type { CheerioAPI, Element } from "cheerio";
import type { AnyNode, Text } from "domhandler";

export interface HtmlExtractedData {
  kind: "html-extracted";
  title?: string;
  tables: HtmlTable[];
  keyValues: Record<string, string>;
  lists: HtmlList[];
  sections: HtmlSection[];
  items: HtmlItem[];
  emptyMessage?: string;
  bytes: number;
}

export interface HtmlTable {
  caption?: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface HtmlList {
  label?: string;
  items: string[];
}

export interface HtmlSection {
  level: number;
  heading: string;
  content: string[];
}

export interface HtmlItem {
  title: string;
  subtitle?: string;
  body?: string;
  href?: string;
  meta?: Record<string, string>;
}

const CHROME_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "path",
  "defs",
  "use",
  "nav",
  "header",
  "footer",
  "aside",
  ".navbar",
  ".sidebar",
  ".iserv-menu",
  ".menu-sidebar",
  ".breadcrumb",
  "#sidebar",
  ".skip-link",
  "[hidden]",
  ".hidden",
  ".d-none",
  "[aria-hidden='true']",
  ".sr-only",
  ".fileupload",
  ".dropzone",
  ".modal",
].join(", ");

function collectText(node: Element | undefined): string {
  if (!node) return "";
  let text = "";
  for (const child of node.childNodes as AnyNode[]) {
    if (child.type === "text") {
      text += (child as Text).data;
    } else if (child.type === "tag") {
      const el = child as Element;
      if (el.tagName === "br") text += " ";
      else if (!["script", "style", "svg"].includes(el.tagName)) {
        text += collectText(el);
      }
    }
  }
  return text;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf($: CheerioAPI, el: Element | undefined): string {
  return cleanText(collectText(el));
}

/**
 * Extracts structured content from an authenticated HTML page.
 * Scopes to the main content region and ignores navigation chrome.
 */
export function summarizeHtml(value: string): HtmlExtractedData {
  const $ = load(value);
  const pageTitle = $("title").first().text().replace(/\s+/g, " ").trim() || undefined;
  const bytes = Buffer.byteLength(value);

  // Prefer the real content region; fall back to main/body.
  let $root = $("#content").first();
  if (!$root.length) $root = $("main .page-content, main .content, main").first();
  if (!$root.length) $root = $("body");

  // Work on a clone so we can strip chrome without losing page title.
  const rootHtml = $.html($root);
  const $c = load(`<div id="__root">${rootHtml}</div>`);
  $c(CHROME_SELECTORS).remove();
  // Drop pure navigation panels that often sit beside content
  $c(".panel-heading").each((_i, el) => {
    const heading = textOf($c, el as Element).toLowerCase();
    if (
      ["search", "latest", "categories", "news subscriptions", "quick access"].includes(
        heading,
      )
    ) {
      $c(el).closest(".panel, .card").remove();
    }
  });

  const tables = extractTables($c);
  const keyValues = extractKeyValues($c);
  const lists = extractLists($c);
  const sections = extractSections($c);
  const items = extractItems($c);
  const emptyMessage = extractEmptyMessage($c);

  // Prefer module-ish title from h1 inside content
  const h1 = textOf($c, $c("h1").first().get(0) as Element | undefined);
  const title = h1 || pageTitle;

  return {
    kind: "html-extracted",
    title,
    tables,
    keyValues,
    lists,
    sections,
    items,
    ...(emptyMessage ? { emptyMessage } : {}),
    bytes,
  };
}

function extractEmptyMessage($: CheerioAPI): string | undefined {
  const candidates = [
    ".alert-info",
    ".alert-warning",
    ".empty",
    ".no-results",
    ".text-muted",
    "p",
  ];
  for (const sel of candidates) {
    const el = $(sel).filter((_i, node) => {
      const t = textOf($, node as Element).toLowerCase();
      return (
        t.includes("no ") ||
        t.includes("currently no") ||
        t.includes("there are no") ||
        t.includes("there're no") ||
        t.includes("nichts") ||
        t.includes("keine ")
      );
    }).first();
    if (el.length) {
      const msg = textOf($, el.get(0) as Element);
      if (msg.length > 8 && msg.length < 240) return msg;
    }
  }
  return undefined;
}

function extractTables($: CheerioAPI): HtmlTable[] {
  const result: HtmlTable[] = [];
  $("table").each((_i, tableEl) => {
    const $table = $(tableEl);
    // Skip upload/file-picker helper tables
    const cls = ($table.attr("class") ?? "").toLowerCase();
    if (cls.includes("fileupload") || cls.includes("dz-")) return;
    if ($table.closest(".fileupload, .dropzone, .modal").length) return;

    const caption = $table.find("caption").first().text().trim() || undefined;
    const headers: string[] = [];
    $table.find("thead tr").first().find("th, td").each((_j, cell) => {
      const text = textOf($, cell as Element);
      // Skip empty action columns
      headers.push(text || "");
    });

    // Drop leading/trailing empty header columns (checkbox/action cols)
    while (headers.length && !headers[0]) headers.shift();
    while (headers.length && !headers[headers.length - 1]) headers.pop();

    if (headers.length === 0) {
      $table.find("tbody tr, tr").first().find("th").each((_j, cell) => {
        headers.push(textOf($, cell as Element));
      });
    }

    const finalHeaders =
      headers.filter(Boolean).length > 0
        ? headers.map((h, i) => h || `Col ${i + 1}`)
        : [];

    const rows: Record<string, string>[] = [];
    $table.find("tbody tr").each((_j, row) => {
      const $row = $(row);
      // Skip group header rows (single cell spanning)
      const cells = $row.find("td");
      if (cells.length === 0) return;
      if (cells.length === 1 && $row.find("th").length === 0) {
        const only = textOf($, cells.get(0) as Element);
        if (only && finalHeaders.length === 0) {
          // section label row — skip as data
          return;
        }
      }

      const values: string[] = [];
      $row.find("td, th").each((_k, cell) => {
        values.push(textOf($, cell as Element));
      });
      // strip empty leading/trailing action cells to align with headers
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

      // Skip empty or pure-action rows
      if (values.every((v) => !v || /^(delete|hide|edit|show)$/i.test(v))) return;

      const rowData: Record<string, string> = {};
      if (finalHeaders.length > 0) {
        for (let k = 0; k < Math.max(finalHeaders.length, values.length); k++) {
          const header = finalHeaders[k] ?? `Col ${k + 1}`;
          if (values[k]) rowData[header] = values[k]!;
        }
      } else {
        values.forEach((v, k) => {
          if (v) rowData[`Col ${k + 1}`] = v;
        });
      }
      if (Object.keys(rowData).length > 0) rows.push(rowData);
    });

    if (rows.length > 0) {
      result.push({
        caption,
        headers: finalHeaders.length
          ? finalHeaders
          : Object.keys(rows[0] ?? {}),
        rows,
      });
    }
  });
  return result;
}

function extractKeyValues($: CheerioAPI): Record<string, string> {
  const kv: Record<string, string> = {};

  $("dl").each((_i, dl) => {
    $(dl)
      .find("dt")
      .each((_j, dt) => {
        const key = textOf($, dt as Element);
        const dd = $(dt).next("dd").get(0) as Element | undefined;
        if (key && dd) {
          const value = textOf($, dd);
          if (value) kv[key] = value;
        }
      });
  });

  $(".form-group, .field, .mb-3").each((_i, group) => {
    const $group = $(group);
    const labelEl = $group.find("label, .control-label").get(0) as Element | undefined;
    const label = labelEl ? textOf($, labelEl).replace(/\*$/, "").trim() : "";
    if (!label || label.length > 80) return;
    const input = $group.find("input:not([type=hidden]):not([type=submit]), select, textarea").first();
    let value = "";
    if (input.length) {
      const tag = input.get(0)!.tagName;
      if (tag === "select") {
        value = input.find("option:selected").text().trim();
      } else if (tag === "input" && input.attr("type") === "radio") {
        value = $group.find("input:checked").parent().text().replace(/\s+/g, " ").trim();
      } else if (tag === "input" && input.attr("type") === "checkbox") {
        value = input.is(":checked") ? "Yes" : "No";
      } else {
        value = String(input.val() ?? input.attr("value") ?? "").trim();
      }
    }
    if (label && value && !kv[label]) kv[label] = value;
  });

  $("table").each((_i, table) => {
    const $table = $(table);
    const rows = $table.find("tbody tr, > tr");
    let isKv = rows.length > 0;
    rows.each((_j, row) => {
      const first = $(row).find("th, td").first();
      if (!first.is("th") && !first.text().trim().endsWith(":")) isKv = false;
    });
    if (!isKv) return;
    rows.each((_j, row) => {
      const cells = $(row).find("th, td");
      if (cells.length >= 2) {
        const key = textOf($, cells.get(0) as Element).replace(/:$/, "");
        const value = textOf($, cells.get(1) as Element);
        if (key && value && !kv[key]) kv[key] = value;
      }
    });
  });

  return kv;
}

function extractLists($: CheerioAPI): HtmlList[] {
  const result: HtmlList[] = [];
  $("ul.list-unstyled, ul.list-group, ol.list-group, .flex-item-list").each(
    (_i, listEl) => {
      const $list = $(listEl);
      const prev = $list
        .prevAll("h1, h2, h3, h4, .panel-heading, legend")
        .first();
      const label = prev.length
        ? textOf($, prev.get(0) as Element) || undefined
        : undefined;
      const items: string[] = [];
      $list.find("> li, > a.group, > .flex-item").each((_j, li) => {
        const text = textOf($, li as Element);
        if (text) items.push(text);
      });
      if (items.length > 0) result.push({ label, items });
    },
  );
  return result;
}

function extractSections($: CheerioAPI): HtmlSection[] {
  const result: HtmlSection[] = [];
  $("h1, h2, h3").each((_i, headingEl) => {
    const $heading = $(headingEl);
    if ($heading.closest(".panel-heading").length) return;
    const level = Number(headingEl.tagName.replace("h", ""));
    const heading = textOf($, headingEl as Element);
    if (!heading || heading.length > 120) return;
    const content: string[] = [];
    let next = $heading.next();
    while (next.length && !next.is("h1, h2, h3, table, ul, ol")) {
      if (next.is("p, .text-muted, .description, .help-block")) {
        const text = textOf($, next.get(0) as Element);
        if (text) content.push(text);
      }
      next = next.next();
    }
    result.push({ level, heading, content });
  });
  return result;
}

function extractItems($: CheerioAPI): HtmlItem[] {
  const items: HtmlItem[] = [];

  // News rows
  $(".row.news").each((_i, el) => {
    const $el = $(el);
    const titleEl = $el.find(".news-title a, h3 a, h3").first();
    const title = textOf($, titleEl.get(0) as Element | undefined);
    if (!title) return;
    const href = titleEl.is("a")
      ? titleEl.attr("href")
      : $el.find("a").first().attr("href");
    const metaText = $el
      .find(".news-meta, .text-muted, small")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const body = $el
      .find(".news-content, .news-body, p")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
    items.push({
      title,
      ...(href ? { href } : {}),
      ...(metaText ? { subtitle: metaText } : {}),
      ...(body && body !== title ? { body } : {}),
    });
  });

  // Group cards
  if (items.length === 0) {
    $("a.group, .flex-item.group, .media").each((_i, el) => {
      const $el = $(el);
      const title =
        textOf($, $el.find("h4, .media-heading, .item-label").first().get(0) as Element | undefined) ||
        textOf($, el as Element);
      if (!title || title.length > 80) return;
      const href = $el.is("a") ? $el.attr("href") : $el.find("a").first().attr("href");
      items.push({ title, ...(href ? { href } : {}) });
    });
  }

  // Generic panel body list links (latest etc already stripped)
  if (items.length === 0) {
    $(".panel-body ul li a, .list-group-item").each((_i, el) => {
      const $el = $(el);
      const title = textOf($, el as Element);
      if (!title || title.length > 120) return;
      const href = $el.is("a") ? $el.attr("href") : $el.find("a").attr("href");
      items.push({ title, ...(href ? { href } : {}) });
    });
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
}

export function isHtmlResponse(
  value: unknown,
  contentType?: string,
): value is string {
  if (typeof value !== "string") return false;
  if (contentType?.toLowerCase().includes("text/html")) return true;
  return /^\s*<!doctype html|^\s*<html[\s>]/i.test(value);
}
