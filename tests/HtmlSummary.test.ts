import { describe, expect, test } from "vitest";
import { isHtmlResponse, summarizeHtml } from "../src/Core/HtmlSummary.js";

describe("HTML extracted data", () => {
  test("extracts content tables and ignores navigation chrome", () => {
    const html = `<!doctype html><html><head><title>My Account - IServ</title></head><body>
      <nav><a href="/iserv/">Home</a><a href="/iserv/mail">Mail</a></nav>
      <div id="content">
        <h1>My Account</h1>
        <table>
          <caption>Personal Info</caption>
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Name</td><td>Alice Example</td></tr>
            <tr><td>Class</td><td>12A</td></tr>
          </tbody>
        </table>
      </div>
      <footer><a href="/legal">Legal</a></footer>
    </body></html>`;

    const extracted = summarizeHtml(html);
    expect(extracted.kind).toBe("html-extracted");
    expect(extracted.title).toBe("My Account");
    expect(extracted.tables.length).toBe(1);
    expect(extracted.tables[0]!.rows).toHaveLength(2);
    expect(extracted.tables[0]!.rows[0]).toMatchObject({
      Field: "Name",
      Value: "Alice Example",
    });
    // Nav links must not appear as content items
    expect(JSON.stringify(extracted)).not.toMatch(/\/iserv\/mail/);
  });

  test("extracts news items from content region", () => {
    const html = `<!doctype html><html><body>
      <div id="content">
        <div class="panel"><div class="panel-heading">All news</div>
        <div class="panel-body">
          <div class="row news">
            <h3 class="news-title"><a href="/iserv/news/show/1">Holiday greetings</a></h3>
            <p class="text-muted">1/1/2026 | Admin | News</p>
            <p>Have a nice break.</p>
          </div>
        </div></div>
      </div>
    </body></html>`;
    const extracted = summarizeHtml(html);
    expect(extracted.items.length).toBeGreaterThanOrEqual(1);
    expect(extracted.items[0]?.title).toBe("Holiday greetings");
  });

  test("detects HTML from content type or markup", () => {
    expect(isHtmlResponse("plain", "text/html; charset=UTF-8")).toBe(true);
    expect(isHtmlResponse("<html></html>")).toBe(true);
    expect(isHtmlResponse('{"ok":true}', "application/json")).toBe(false);
  });
});
