import { describe, expect, test } from "vitest";
import { isHtmlResponse, summarizeHtml } from "../src/Core/HtmlSummary.js";

describe("HTML extracted data", () => {
  test("extracts tables, headings, and metadata from IServ-like page", () => {
    const html = `<!doctype html><html><head><title>My Account - IServ</title></head><body>
      <h1>My Account</h1>
      <table>
        <caption>Personal Info</caption>
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Name</td><td>Alice Example</td></tr>
          <tr><td>Class</td><td>12A</td></tr>
        </tbody>
      </table>
      <form method="post" action="/iserv/profile/edit">
        <input type="hidden" name="_token" value="abc123">
        <input name="email" type="text">
      </form>
      <a href="/iserv/calendar">Calendar</a>
      <ul class="list-group">
        <li>Item one</li>
        <li>Item two</li>
      </ul>
    </body></html>`;

    const extracted = summarizeHtml(html);
    expect(extracted.kind).toBe("html-extracted");
    expect(extracted.title).toBe("My Account - IServ");
    expect(extracted.tables.length).toBeGreaterThanOrEqual(1);
    const table = extracted.tables[0];
    expect(table).toBeDefined();
    expect(table!.headers).toContain("Field");
    expect(table!.rows.length).toBe(2);
    expect(table!.rows[0]).toMatchObject({ Field: "Name", Value: "Alice Example" });
    expect(extracted.forms.length).toBeGreaterThanOrEqual(1);
    expect(extracted.forms[0]?.method).toBe("POST");
    expect(extracted.forms[0]?.fields).toContain("email");
    expect(extracted.metadata._csrf_present).toBe("yes");
  });

  test("extracts key-value patterns from DL and from kv tables", () => {
    const html = `<!doctype html><html><body>
      <h2>User Info</h2>
      <dl>
        <dt>Name</dt>
        <dd>Devin</dd>
        <dt>Email</dt>
        <dd>devin@iserv.example</dd>
      </dl>
      <table>
        <tbody>
          <tr><th>Status:</th><td>Active</td></tr>
          <tr><th>Role:</th><td>Student</td></tr>
        </tbody>
      </table>
    </body></html>`;

    const extracted = summarizeHtml(html);
    expect(extracted.keyValues).toMatchObject({
      Name: "Devin",
      Email: expect.stringContaining("devin"),
      Status: "Active",
      Role: "Student",
    });
  });

  test("detects HTML from content type or markup", () => {
    expect(isHtmlResponse("plain", "text/html; charset=UTF-8")).toBe(true);
    expect(isHtmlResponse("<html></html>")).toBe(true);
    expect(isHtmlResponse('{"ok":true}', "application/json")).toBe(false);
  });
});
