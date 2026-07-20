import { load } from "cheerio";
import type { Element, Text } from "domhandler";

export interface HtmlExtractedData {
  kind: "html-extracted";
  title?: string;
  tables: HtmlTable[];
  keyValues: Record<string, string>;
  lists: HtmlList[];
  sections: HtmlSection[];
  links: HtmlLink[];
  metadata: Record<string, string>;
  forms: HtmlForm[];
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

export interface HtmlLink {
  text: string;
  href: string;
}

export interface HtmlForm {
  action: string;
  method: string;
  fields: string[];
}

function collectText(node: Element | undefined, $: cheerio.CheerioAPI): string {
  if (!node) return "";
  let text = "";
  for (const child of node.childNodes) {
    if (child.type === "text") {
      text += (child as Text).data;
    } else if (child.type === "tag" || child.type === "script") {
      const el = child as Element;
      if (el.tagName === "br") {
        text += " ";
      } else if (!["script", "style"].includes(el.tagName)) {
        text += collectText(el, $);
      }
    }
  }
  return text;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Extracts structured data from an HTML page using Cheerio.
 * Produces tables, key-value pairs, lists, sections, links, forms, and metadata
 * that CLI and MCP consumers can render meaningfully.
 */
export function summarizeHtml(value: string): HtmlExtractedData {
  const $ = load(value);

  // Remove non-content elements that carry no user-visible meaning
  $("script, style, noscript, svg, path, defs, use").remove();
  $("[hidden], .hidden, .d-none, [aria-hidden='true']").remove();

  const title = $("title").first().text().trim() || undefined;
  const bytes = Buffer.byteLength(value);

  const tables = extractTables($);
  const keyValues = extractKeyValues($);
  const lists = extractLists($);
  const sections = extractSections($);
  const links = extractLinks($);
  const forms = extractForms($);
  const metadata = extractMetadata($);

  return {
    kind: "html-extracted",
    title,
    tables,
    keyValues,
    lists,
    sections,
    links,
    forms,
    metadata,
    bytes,
  };
}

function extractTables($: cheerio.CheerioAPI): HtmlTable[] {
  const result: HtmlTable[] = [];
  $("table").each((_i, tableEl) => {
    const $table = $(tableEl);
    const caption = $table.find("caption").first().text().trim() || undefined;

    // Collect headers from thead th/th in first tr
    const headers: string[] = [];
    $table.find("thead tr, > tr:first-child").first().find("th, td").each((_j, cell) => {
      const text = cleanText(collectText(cell as Element, $));
      if (text) headers.push(text);
    });

    // If no thead, try first tr as header heuristic (if all th)
    if (headers.length === 0) {
      $table.find("> tbody > tr:first-child, > tr").first().find("th").each((_j, cell) => {
        headers.push(cleanText(collectText(cell as Element, $)));
      });
    }

    // Build header labels or fallback to Col 1, Col 2, ...
    const colCount = (() => {
      if (headers.length > 0) return headers.length;
      const firstBodyRow = $table.find("tbody tr, > tr").first();
      if (!firstBodyRow.length) return 0;
      return firstBodyRow.get(0)!.childNodes.filter(
        (n): n is Element => n.type === "tag" && n.tagName === "td",
      ).length;
    })();

    const finalHeaders: string[] =
      headers.length > 0
        ? headers
        : colCount > 0
          ? Array.from({ length: colCount }, (_, i) => `Col ${i + 1}`)
          : [];

    // Parse body rows
    const rows: Record<string, string>[] = [];
    $table.find("tbody tr").each((_j, row) => {
      const cells: string[] = [];
      $(row).find("td, th").each((_k, cell) => {
        cells.push(cleanText(collectText(cell as Element, $)));
      });

      if (cells.length === 0) return;
      const rowData: Record<string, string> = {};
      for (let k = 0; k < cells.length; k++) {
        const header = finalHeaders[k] ?? `Col ${k + 1}`;
        rowData[header] = cells[k]!;
      }
      rows.push(rowData);
    });

    if (rows.length > 0 || headers.length > 0) {
      result.push({ caption, headers: finalHeaders, rows });
    }
  });

  return result;
}

function extractKeyValues($: cheerio.CheerioAPI): Record<string, string> {
  const kv: Record<string, string> = {};

  // DL/DT/DD pairs
  $("dl").each((_i, dl) => {
    const $dl = $(dl);
    $dl.find("dt").each((_j, dt) => {
      const key = cleanText(collectText(dt as Element, $));
      const $dd = $(dt).next("dd");
      if (key && $dd.length) {
        kv[key] = cleanText(collectText($dd.get(0) as Element, $));
      }
    });
  });

  // Label + input/value patterns
  $(
    ".form-group, .field, .mb-3, [class*='field'], li.field",
  ).each((_i, group) => {
    const $group = $(group);
    const labelEl = $group
      .find("label, .label, .form-label")
      .get(0) as Element | undefined;
    const label = labelEl ? cleanText(collectText(labelEl, $)) : "";
    if (!label) return;
    const valueEl = $group
      .find(
        "input, select, textarea, .form-control-static, .form-text, .value, span.value, .field-value",
      )
      .first();
    let value = "";
    if (valueEl.length) {
      const tag = valueEl.get(0)!.tagName;
      if (tag === "input") {
        value = (valueEl.val() as string) ?? valueEl.attr("value") ?? "";
      } else if (tag === "select") {
        value = valueEl.find("option:selected").text().trim();
      } else {
        value = cleanText(
          collectText(valueEl.get(0) as Element, $),
        );
      }
    } else {
      value = cleanText(collectText($group.get(0) as Element, $));
      value = value.replace(new RegExp(`^${escapeRegex(label)}`), "").trim();
    }
    if (label && value && !kv[label]) kv[label] = value;
  });

  // th/td pairs in tables that look like key-value
  $("table").each((_i, table) => {
    const $table = $(table);
    const rows = $table.find("tbody tr, > tr");
    if (rows.length === 0) return;
    let isKv = true;
    rows.each((_j, row) => {
      const first = $(row).find("th, td").first();
      if (!first.is("th") && !first.text().trim().endsWith(":")) isKv = false;
    });
    if (!isKv) return;

    rows.each((_j, row) => {
      const cells = $(row).find("th, td");
      if (cells.length >= 2) {
        const key = cleanText(
          collectText(cells.get(0) as Element, $),
        ).replace(/:$/, "");
        const value = cleanText(
          collectText(cells.get(1) as Element, $),
        );
        if (key && value && !kv[key]) kv[key] = value;
      }
    });
  });

  // Table cells with data-label attributes
  $("td[data-label]").each((_i, cell) => {
    const $cell = $(cell);
    const label = $cell.attr("data-label")?.trim();
    const value = cleanText(collectText(cell as Element, $));
    if (label && value && !kv[label]) kv[label] = value;
  });

  return kv;
}

function extractLists($: cheerio.CheerioAPI): HtmlList[] {
  const result: HtmlList[] = [];

  $("ul.list-group, ol.list-group, ul.list, ol.list, > ul, > ol").each(
    (_i, listEl) => {
      const $list = $(listEl);
      let label: string | undefined;
      const prev = $list
        .prevAll("h1, h2, h3, h4, h5, h6, label, .list-title, legend")
        .first();
      if (prev.length) {
        label = cleanText(collectText(prev.get(0) as Element, $)) || undefined;
      }

      const items: string[] = [];
      $list.find("> li").each((_j, li) => {
        const text = cleanText(collectText(li as Element, $));
        if (text) items.push(text);
      });

      if (items.length > 0) {
        result.push({ label, items });
      }
    },
  );

  $(
    ".card-body, .container, .content, main, [role='main']",
  ).each((_i, container) => {
    const $container = $(container);
    $container.find("> ul, > ol").each((_j, listEl) => {
      const $list = $(listEl);
      const prev = $list
        .prevAll("h1, h2, h3, h4, h5, h6, label, .list-title, legend")
        .first();
      const label = prev.length
        ? cleanText(collectText(prev.get(0) as Element, $)) || undefined
        : undefined;

      const items: string[] = [];
      $list.find("> li").each((_k, li) => {
        const text = cleanText(collectText(li as Element, $));
        if (text) items.push(text);
      });

      if (items.length > 0) {
        const exists = result.some(
          (r) => JSON.stringify(r.items) === JSON.stringify(items),
        );
        if (!exists) {
          result.push({ label, items });
        }
      }
    });
  });

  return result;
}

function extractSections($: cheerio.CheerioAPI): HtmlSection[] {
  const result: HtmlSection[] = [];

  $(".accordion-item, .card, .section, fieldset").each((_i, sectionEl) => {
    const $section = $(sectionEl);
    const headerEl = $section
      .find(
        ".accordion-header, .accordion-button, .card-header, .section-title, h1, h2, h3, h4, h5, h6, legend",
      )
      .first();
    if (!headerEl.length) return;

    const level = headerEl.is("legend")
      ? 3
      : Number(headerEl.get(0)!.tagName.replace("h", ""));
    const heading = cleanText(collectText(headerEl.get(0) as Element, $));
    if (!heading) return;

    const body = $section.find(
      ".accordion-body, .card-body, .section-body, .panel-body, .content",
    );
    const content: string[] = [];
    if (body.length) {
      body
        .find("p:not(:empty), .text-muted, .description, .help-text, .info")
        .each((_j, p) => {
          const text = cleanText(collectText(p as Element, $));
          if (text) content.push(text);
        });
      if (content.length === 0) {
        const text = cleanText(collectText(body.get(0) as Element, $));
        if (text) content.push(text);
      }
    }

    result.push({ level, heading, content });
  });

  $("h1, h2, h3, h4, h5, h6").each((_i, headingEl) => {
    const $heading = $(headingEl);
    if ($heading.closest(".accordion-item, .card, .section").length) return;

    const level = Number(headingEl.tagName.replace("h", ""));
    const heading = cleanText(collectText(headingEl as Element, $));
    if (!heading) return;

    const content: string[] = [];
    let next = $heading.next();
    while (next.length && !next.is("h1, h2, h3, h4, h5, h6")) {
      if (next.is("p, div.text-muted, .description, .help-text")) {
        const text = cleanText(collectText(next.get(0) as Element, $));
        if (text) content.push(text);
      }
      if (next.is("hr, nav, footer")) break;
      next = next.next();
    }

    result.push({ level, heading, content });
  });

  return result;
}

function extractLinks($: cheerio.CheerioAPI): HtmlLink[] {
  const result: HtmlLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_i, a) => {
    const $a = $(a);
    const href = $a.attr("href") ?? "";
    const text = cleanText(collectText(a as Element, $));
    if (!text || !href || href === "#" || href.startsWith("javascript:")) return;

    const key = `${href}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    result.push({ text, href });
  });

  return result;
}

function extractForms($: cheerio.CheerioAPI): HtmlForm[] {
  const result: HtmlForm[] = [];

  $("form").each((_i, formEl) => {
    const $form = $(formEl);
    const action = $form.attr("action") ?? "";
    const method = ($form.attr("method") ?? "GET").toUpperCase();

    const fields: string[] = [];
    $form.find("input, select, textarea").each((_j, input) => {
      const $input = $(input);
      const name = $input.attr("name");
      const type = $input.attr("type");
      if (name && type !== "hidden" && type !== "submit") {
        fields.push(name);
      }
    });

    result.push({ action, method, fields });
  });

  return result;
}

function extractMetadata($: cheerio.CheerioAPI): Record<string, string> {
  const meta: Record<string, string> = {};

  $(
    "[name='_token'], [name='csrf_token'], [name='csrf-token'], [name*='csrf'], [name*='token']",
  ).each((_i, el) => {
    const $el = $(el);
    const value = ($el.val() as string) ?? $el.attr("content") ?? "";
    if (value && value.length > 5) {
      meta["_csrf_present"] = "yes";
    }
  });

  $("meta").each((_i, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? $el.attr("property") ?? "";
    const content = $el.attr("content") ?? "";
    if (name && content) {
      meta[name] = content;
    }
  });

  const navItems = $("nav a, .nav-link, .navbar-nav .nav-item").length;
  if (navItems > 0) meta["_nav_items"] = String(navItems);

  $("nav .active, .nav-item.active, .nav-link.active").each((_i, el) => {
    const text = cleanText(collectText(el as Element, $));
    if (text) meta["_active_nav"] = text;
  });

  $(
    ".user-info, .user-name, .account-name, .navbar-text, .user-menu, .dropdown-user",
  ).each((_i, el) => {
    const text = cleanText(collectText(el as Element, $));
    if (text && text.length > 1 && text.length < 100) {
      meta["_user"] = text;
    }
  });

  return meta;
}

export function isHtmlResponse(
  value: unknown,
  contentType?: string,
): value is string {
  if (typeof value !== "string") return false;
  if (contentType?.toLowerCase().includes("text/html")) return true;
  return /^\s*<!doctype html|^\s*<html[\s>]/i.test(value);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
