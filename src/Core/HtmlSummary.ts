import { load } from "cheerio";

export interface HtmlStructureSummary {
  kind: "html-structure";
  bytes: number;
  links: number;
  headings: number;
  tables: number;
  tableRows: number;
  forms: Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", number>>;
}

type FormMethod = keyof HtmlStructureSummary["forms"];
const FORM_METHODS = new Set<FormMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function isFormMethod(candidate: string): candidate is FormMethod {
  return FORM_METHODS.has(candidate as FormMethod);
}

/**
 * Reduces an authenticated HTML page to non-content-bearing DOM counts.
 * No text, URLs, attributes, identifiers, or field values leave this boundary.
 */
export function summarizeHtml(value: string): HtmlStructureSummary {
  const $ = load(value);
  const forms: HtmlStructureSummary["forms"] = {};
  $("form").each((_index, element) => {
    const candidate = ($(element).attr("method") ?? "GET").toUpperCase();
    const method = isFormMethod(candidate) ? candidate : "GET";
    forms[method] = (forms[method] ?? 0) + 1;
  });

  return {
    kind: "html-structure",
    bytes: Buffer.byteLength(value),
    links: $("a[href]").length,
    headings: $("h1, h2, h3, h4, h5, h6").length,
    tables: $("table").length,
    tableRows: $("table tbody tr").length,
    forms,
  };
}

export function isHtmlResponse(value: unknown, contentType?: string): value is string {
  if (typeof value !== "string") return false;
  if (contentType?.toLowerCase().includes("text/html")) return true;
  return /^\s*<!doctype html|^\s*<html[\s>]/i.test(value);
}
