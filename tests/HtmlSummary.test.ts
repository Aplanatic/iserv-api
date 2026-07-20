import { describe, expect, test } from "vitest";
import { isHtmlResponse, summarizeHtml } from "../src/Core/HtmlSummary.js";

describe("HTML structure summaries", () => {
  test("reports structure without retaining authenticated content", () => {
    const html = `<!doctype html><html><body>
      <h1>Private Example News</h1>
      <a href="https://iserv.example/iserv/news/show/42">Private author</a>
      <table><tbody><tr><td>Private assignment</td></tr></tbody></table>
      <form method="post"><input name="token" value="secret"></form>
      <form><input name="search"></form>
    </body></html>`;

    const summary = summarizeHtml(html);
    expect(summary).toMatchObject({
      kind: "html-structure",
      links: 1,
      headings: 1,
      tables: 1,
      tableRows: 1,
      forms: { GET: 1, POST: 1 },
    });
    expect(JSON.stringify(summary)).not.toMatch(/Private|author|assignment|secret|token/);
  });

  test("detects HTML from either content type or document markup", () => {
    expect(isHtmlResponse("plain", "text/html; charset=UTF-8")).toBe(true);
    expect(isHtmlResponse("<html></html>")).toBe(true);
    expect(isHtmlResponse('{"ok":true}', "application/json")).toBe(false);
  });
});
