import { describe, expect, test } from "vitest";
import { UserService } from "../src/User/UserService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

const ACCOUNT_HTML = `
  <div id="user-account">
    <h2>Alice Example</h2>
    <a href="mailto:alice@iserv.example">alice@iserv.example</a>
    <span class="badge account-badge">Schüler</span>
  </div>
  <div id="userGroups">
    <div class="accordion-item">
      <button class="accordion-button">SuS</button>
      <div data-content-loader-url-value="/iserv/account/group_details/group-1"></div>
    </div>
    <div class="accordion-item">
      <button class="accordion-button">sus.8-10</button>
      <div data-content-loader-url-value="/iserv/account/group_details/group-2"></div>
    </div>
  </div>
  <div id="userPrivileges">
    <div class="accordion-item"><button class="accordion-button">Benutzerprofil</button></div>
    <div class="accordion-item"><button class="accordion-button">E-Mail</button></div>
  </div>
`;

const PUBLIC_EDIT_HTML = `
  <input id="publiccontact_title" value="Dr.">
  <input id="publiccontact_company" value="Example School">
  <input id="publiccontact_birthday" value="2000-01-01">
  <input id="publiccontact_nickname" value="Ali">
  <input id="publiccontact_class" value="10a">
  <input id="publiccontact_street" value="Example Street 1">
  <input id="publiccontact_zipcode" value="12345">
  <input id="publiccontact_city" value="Example City">
  <input id="publiccontact_country" value="Example Country">
  <textarea id="publiccontact_note">Public note</textarea>
  <input id="publiccontact_phone" value="+49 1">
  <input id="publiccontact_mobilePhone" value="+49 2">
  <input id="publiccontact_fax" value="+49 3">
  <input id="publiccontact_mail" value="alice@example.test">
  <input id="publiccontact_homepage" value="https://example.test">
`;

describe("UserService.getOwnInfo", () => {
  test("loads account and public profile edit pages exactly like IServ exposes them", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/account/my",
          response: { data: ACCOUNT_HTML },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/profile/public/edit",
          response: { data: PUBLIC_EDIT_HTML },
        },
      ],
    });

    const info = await new UserService(session).getOwnInfo();

    expect(info.name).toBe("Alice Example");
    expect(info.email).toBe("alice@iserv.example");
    expect(info.Groups).toEqual({
      SuS: "/iserv/account/group_details/group-1",
      "sus.8-10": "/iserv/account/group_details/group-2",
    });
    expect(info.Roles).toEqual(["Schüler"]);
    expect(info.Rights).toEqual(["Benutzerprofil", "E-Mail"]);
    expect(info.PublicInfo).toMatchObject({
      title: "Dr.",
      company: "Example School",
      nickname: "Ali",
      mail: "alice@example.test",
      note: "Public note",
    });
    expectAllRoutesCalled();
  });
});

describe("UserService.getProfilePictureBuffer validation", () => {
  test("throws when width is 0", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(new UserService(session).getProfilePictureBuffer("alice", 0)).rejects.toThrow(
      "width must be a positive integer <= 4096",
    );
  });

  test("throws when width is negative", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(new UserService(session).getProfilePictureBuffer("alice", -1)).rejects.toThrow(
      "width must be a positive integer <= 4096",
    );
  });

  test("throws when width is a float", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(new UserService(session).getProfilePictureBuffer("alice", 1.5)).rejects.toThrow(
      "width must be a positive integer <= 4096",
    );
  });

  test("throws when width > 4096", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(new UserService(session).getProfilePictureBuffer("alice", 4097)).rejects.toThrow(
      "width must be a positive integer <= 4096",
    );
  });

  test("throws when height is 0", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(new UserService(session).getProfilePictureBuffer("alice", 100, 0)).rejects.toThrow(
      "height must be a positive integer <= 4096",
    );
  });

  test("throws when height is negative", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(
      new UserService(session).getProfilePictureBuffer("alice", 100, -1),
    ).rejects.toThrow("height must be a positive integer <= 4096");
  });

  test("throws when height is a float", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(
      new UserService(session).getProfilePictureBuffer("alice", 100, 1.5),
    ).rejects.toThrow("height must be a positive integer <= 4096");
  });

  test("throws when height > 4096", async () => {
    const { session } = createMockIServSession({ routes: [] });
    await expect(
      new UserService(session).getProfilePictureBuffer("alice", 100, 4097),
    ).rejects.toThrow("height must be a positive integer <= 4096");
  });

  test("does NOT throw when width=1 height=1", async () => {
    const { session } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/addressbook/public/image/alice/photo/1/1",
          responseType: "arraybuffer",
          response: {
            data: Buffer.from("RIFF....WEBP"),
            headers: { "content-type": "image/webp" },
          },
        },
      ],
    });
    await expect(
      new UserService(session).getProfilePictureBuffer("alice", 1, 1),
    ).resolves.toBeInstanceOf(Buffer);
  });

  test("does NOT throw when width=4096 height=4096", async () => {
    const { session } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/addressbook/public/image/alice/photo/4096/4096",
          responseType: "arraybuffer",
          response: {
            data: Buffer.from("RIFF....WEBP"),
            headers: { "content-type": "image/webp" },
          },
        },
      ],
    });
    await expect(
      new UserService(session).getProfilePictureBuffer("alice", 4096, 4096),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

describe("UserService address book APIs", () => {
  test("getInfo parses IServ public address book tables", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/addressbook/public/show/example.user",
          response: {
            data: `
              <table>
                <tr><td>Name</td><td>Example User</td></tr>
                <tr><td>E-Mail</td><td>example.user@iserv.example</td></tr>
              </table>
            `,
          },
        },
      ],
    });

    await expect(new UserService(session).getInfo("example.user")).resolves.toEqual({
      Name: "Example User",
      "E-Mail": "example.user@iserv.example",
    });
    expectAllRoutesCalled();
  });

  test("search parses IServ address book result rows and keeps their URLs", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/addressbook/public?filter%5Bsearch%5D=Example%20User",
          response: {
            data: `
              <table>
                <tbody>
                  <tr><td><a href="/iserv/addressbook/public/show/example.user">Example User</a></td></tr>
                </tbody>
              </table>
            `,
          },
        },
      ],
    });

    await expect(new UserService(session).search("Example User")).resolves.toEqual([
      { name: "Example User", userUrl: "/iserv/addressbook/public/show/example.user" },
    ]);
    expectAllRoutesCalled();
  });

  test("searchAutocomplete sends IServ's list,mail type and requested limit", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/core/autocomplete/api",
          params: { type: "list,mail", query: "example", limit: 5 },
          response: {
            data: JSON.stringify([
              {
                label: "Example User <example.user@iserv.example>",
                text: "Example User <example.user@iserv.example>",
                value: "user:Example User <example.user@iserv.example>",
                source: "user",
                avatar: null,
                avatarHtml: "<picture></picture>",
                extra: "Schüler",
                certainty: 9,
                fuzzy: false,
              },
            ]),
          },
        },
      ],
    });

    const results = await new UserService(session).searchAutocomplete("example", 5);

    expect(results[0]?.source).toBe("user");
    expect(results[0]?.certainty).toBe(9);
    expectAllRoutesCalled();
  });

  test("getProfilePictureBuffer requests binary avatar data and rejects SVG placeholders", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/core/avatar/user/example.user",
          responseType: "arraybuffer",
          response: {
            data: Buffer.from("RIFF-webp"),
            headers: { "content-type": "image/webp" },
          },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/core/avatar/user/example.user",
          responseType: "arraybuffer",
          response: {
            data: Buffer.from("<svg></svg>"),
            headers: { "content-type": "image/svg+xml" },
          },
        },
      ],
    });
    const service = new UserService(session);

    await expect(service.getProfilePictureBuffer("example.user")).resolves.toEqual(
      Buffer.from("RIFF-webp"),
    );
    await expect(service.getProfilePictureBuffer("example.user")).rejects.toThrow(
      "SVG profile pictures",
    );
    expectAllRoutesCalled();
  });
});
