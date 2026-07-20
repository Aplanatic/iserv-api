/**
 * Project raw API payloads into clean, table-friendly shapes for human CLI output.
 * JSON mode should receive the original redacted value; human mode uses this.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  // Collapse accidental doubled cell text: "datePM" + "datePM"
  if (text.length >= 8 && text.length % 2 === 0) {
    const half = text.length / 2;
    if (text.slice(0, half) === text.slice(half)) text = text.slice(0, half);
  }
  if (!text || /^none$/i.test(text)) return "—";
  return text;
}

function addrLabel(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (!isRecord(value)) return "—";
  const personal = value.personal;
  const bare = value.bare_address ?? value.contact;
  if (typeof personal === "string" && personal.trim()) return cleanText(personal);
  if (typeof bare === "string" && bare.trim()) return cleanText(bare);
  if (typeof value.mailbox === "string" && typeof value.host === "string") {
    return `${value.mailbox}@${value.host}`;
  }
  return "—";
}

function formatAddrs(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "—";
  return (
    value
      .map(addrLabel)
      .filter((v) => v !== "—")
      .join(", ") || "—"
  );
}

function shortDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return cleanText(value);
}

function formatBytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function presentEmailList(value: Record<string, unknown>): unknown {
  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length === 0) {
    return { title: "Inbox", empty: true, message: "No messages in this mailbox.", items: [] };
  }
  return {
    title: "Inbox",
    items: items.map((item) => {
      if (!isRecord(item)) return { value: String(item) };
      const id = isRecord(item.id) ? item.id.uid : undefined;
      return {
        date: shortDate(item.date),
        from: formatAddrs(item.from),
        to: formatAddrs(item.to),
        subject: cleanText(String(item.subject ?? "—")),
        size: formatBytes(item.size),
        read: item.read ? "yes" : "no",
        ...(id !== undefined ? { uid: String(id) } : {}),
        attachments:
          typeof item.attachmentCount === "number" && item.attachmentCount > 0
            ? String(item.attachmentCount)
            : "—",
      };
    }),
  };
}

function presentContacts(value: unknown[]): unknown {
  if (value.length === 0) {
    return {
      title: "Messenger contacts",
      empty: true,
      message: "No direct-message contacts.",
      items: [],
    };
  }
  return {
    title: "Messenger contacts",
    items: value.map((entry) => {
      if (!isRecord(entry)) return { value: String(entry) };
      const name = cleanText(String(entry.name ?? "???"));
      const shortId = cleanText(String(entry.shortId ?? entry.userId ?? "—"));
      const note =
        typeof entry.note === "string" && entry.note.trim() ? cleanText(entry.note) : undefined;
      return {
        contact: note ? `${name} (${shortId}) – ${note}` : `${name} (${shortId})`,
      };
    }),
  };
}

function presentRooms(value: unknown[]): unknown {
  if (value.length === 0) {
    return { title: "Rooms", empty: true, message: "No joined rooms.", items: [] };
  }
  return {
    title: "Rooms",
    items: value.map((room) => {
      if (!isRecord(room)) return { value: String(room) };
      const last = isRecord(room.lastMessage) ? room.lastMessage : null;
      const preview =
        last && typeof last.body === "string" ? cleanText(last.body).slice(0, 60) : "—";
      const when =
        last && typeof last.timestamp === "number"
          ? shortDate(new Date(last.timestamp).toISOString())
          : "—";
      return {
        name: cleanText(String(room.name ?? room.id ?? "—")),
        unread: String(room.unreadCount ?? 0),
        direct: room.isDirect ? "yes" : "no",
        last: preview,
        when,
      };
    }),
  };
}

function presentNotifications(value: Record<string, unknown>): unknown {
  const list = Array.isArray(value.notifications) ? value.notifications : [];
  if (list.length === 0) {
    return {
      title: "Notifications",
      empty: true,
      message: "You have no notifications.",
      items: [],
    };
  }
  return {
    title: "Notifications",
    items: list.map((item) => {
      if (!isRecord(item)) return { value: String(item) };
      return {
        title: cleanText(String(item.title ?? item.message ?? "—")),
        when: shortDate(item.date ?? item.publishAt ?? item.trigger),
        type: cleanText(String(item.type ?? "—")),
      };
    }),
  };
}

function presentBadges(value: Record<string, unknown>): unknown {
  const items = Object.entries(value)
    .filter(([key, count]) => key !== "fetchedAt" && typeof count === "number" && count > 0)
    .map(([module, count]) => ({ module, count: String(count) }));
  if (items.length === 0) {
    return {
      title: "Badges",
      empty: true,
      message: "No unread badges.",
      items: [],
      ...(typeof value.fetchedAt === "string" ? { fetchedAt: value.fetchedAt } : {}),
    };
  }
  return {
    title: "Badges",
    items,
    ...(typeof value.fetchedAt === "string" ? { message: `Fetched ${value.fetchedAt}` } : {}),
  };
}

function presentHolidays(value: Record<string, unknown>): unknown {
  const seasons = Array.isArray(value.seasons) ? value.seasons : [];
  const next = Array.isArray(value.next) ? value.next : [];
  const movable = Array.isArray(value.movable) ? value.movable : [];
  const mode = value.mode === "next" ? "next" : "seasons";
  const source = mode === "next" ? next : seasons;
  const items = source.map((entry) => {
    if (!isRecord(entry)) return { value: String(entry) };
    const start = String(entry.startLabel ?? "—");
    const end = String(entry.endLabel ?? "—");
    const range = start === "—" && end === "—" ? "—" : start === end ? start : `${start} – ${end}`;
    return {
      name: cleanText(String(entry.name ?? "—")),
      range,
      countdown: cleanText(String(entry.countdown ?? "—")),
      ...(mode === "next" && typeof entry.kind === "string" ? { kind: entry.kind } : {}),
    };
  });
  const title =
    mode === "next"
      ? `Nächste freie Tage · Stand ${String(value.asOfLabel ?? "")}`.trim()
      : `Ferien · Stand ${String(value.asOfLabel ?? "")}`.trim();
  const extra =
    mode === "seasons" && movable.length > 0
      ? {
          message: `${movable.length} bewegliche Ferientage voraus — iserv calendar holidays --next`,
        }
      : {};
  return {
    title,
    empty: items.length === 0,
    ...(items.length === 0 ? { message: "Keine Ferien-/Feiertagsdaten gefunden." } : {}),
    items,
    ...extra,
  };
}

function presentUpcoming(value: Record<string, unknown>): unknown {
  const events = Array.isArray(value.events) ? value.events : [];
  if (events.length === 0) {
    return {
      title: "Upcoming events",
      empty: true,
      message: "No upcoming events.",
      items: [],
    };
  }
  return {
    title: "Upcoming events",
    items: events.map((event) => {
      if (!isRecord(event)) return { value: String(event) };
      return {
        title: cleanText(String(event.title ?? event.summary ?? event.subject ?? "Event")),
        start: shortDate(event.start ?? event.begin ?? event.dtstart),
        end: shortDate(event.end ?? event.dtend),
        calendar: cleanText(String(event.calendar ?? event.source ?? "—")),
      };
    }),
  };
}

function presentUserInfo(value: Record<string, unknown>): unknown {
  const roles = Array.isArray(value.Roles)
    ? value.Roles.map(String)
    : Array.isArray(value.roles)
      ? value.roles.map(String)
      : [];
  const rights = Array.isArray(value.Rights)
    ? value.Rights.map(String)
    : Array.isArray(value.rights)
      ? value.rights.map(String)
      : [];
  const groupsRaw = isRecord(value.Groups)
    ? value.Groups
    : isRecord(value.groups)
      ? value.groups
      : {};
  const groups = Object.keys(groupsRaw);
  const publicInfo = isRecord(value.PublicInfo)
    ? value.PublicInfo
    : isRecord(value.publicInfo)
      ? value.publicInfo
      : {};

  const profile: Record<string, string> = {};
  for (const [key, entry] of Object.entries(publicInfo)) {
    if (entry === null || entry === undefined || entry === "" || entry === false) {
      continue;
    }
    if (typeof entry === "boolean") profile[key] = entry ? "Yes" : "No";
    else profile[key] = cleanText(String(entry));
  }

  return {
    name: cleanText(String(value.name ?? "—")),
    email: cleanText(String(value.email ?? "—")),
    roles: roles.length ? roles.join(", ") : "—",
    rights: rights.length ? rights.join(", ") : "—",
    groups: groups.length ? groups.join(", ") : "—",
    ...(Object.keys(profile).length ? { profile } : {}),
  };
}

function presentModuleRows(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return { value: String(item) };
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(item)) {
      if (key === "href" || key === "Href") continue;
      if (entry === null || entry === undefined) continue;
      let text = cleanText(String(entry));
      if (key.toLowerCase().includes("deadline") || key.toLowerCase().includes("date")) {
        // Prefer first datetime if concatenated
        const m = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) text = m[1]!;
      }
      if (text && text !== "—") out[key] = text;
      else if (/^(exercise|title|name|subject)$/i.test(key)) out[key] = "—";
    }
    return out;
  });
}

function presentDiskSpace(value: unknown[]): unknown {
  return {
    title: "Storage",
    items: value.map((entry) => {
      if (!isRecord(entry)) return { value: String(entry) };
      const name = entry.label ?? entry.Label ?? entry.name ?? entry.path;
      const human = entry.sizeHuman ?? entry["Size Human"];
      const raw = entry.size ?? entry.Size ?? entry.used ?? entry.usage;
      return {
        name: cleanText(String(name ?? "—")),
        size: typeof human === "string" && human.trim() ? cleanText(human) : formatBytes(raw),
      };
    }),
  };
}

/**
 * Convert any command result into a cleaner display value for human output.
 */
export function presentForDisplay(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    // Messenger contacts (m.direct resolved)
    if (isRecord(value[0]) && "userId" in value[0] && "shortId" in value[0] && "name" in value[0]) {
      return presentContacts(value);
    }
    // Messenger rooms
    if (isRecord(value[0]) && "unreadCount" in value[0] && "isDirect" in value[0]) {
      return presentRooms(value);
    }
    // Disk space entries
    if (
      isRecord(value[0]) &&
      ("quota" in value[0] ||
        "used" in value[0] ||
        "usage" in value[0] ||
        "label" in value[0] ||
        "Label" in value[0] ||
        "sizeHuman" in value[0] ||
        "Size Human" in value[0])
    ) {
      return presentDiskSpace(value);
    }
    // Autocomplete users
    if (isRecord(value[0]) && "label" in value[0] && "value" in value[0]) {
      return {
        title: "Users",
        items: value.map((item) => {
          if (!isRecord(item)) return { value: String(item) };
          return {
            name: cleanText(String(item.label ?? item.text ?? "—")),
            id: cleanText(String(item.value ?? "—")),
            type: cleanText(String(item.source ?? "—")),
          };
        }),
      };
    }
    // Generic array of records — flatten one level of nested objects for tables
    if (value.every(isRecord)) {
      return value.map((row) => flattenRow(row));
    }
    return value;
  }

  if (!isRecord(value)) return value;

  // Already structured module/timetable payloads
  if (Array.isArray(value.rows) && Array.isArray(value.days) && Array.isArray(value.periods)) {
    return value;
  }
  if (
    typeof value.date === "string" &&
    typeof value.dayName === "string" &&
    Array.isArray(value.rows) &&
    Array.isArray(value.lessons)
  ) {
    return value;
  }
  if (typeof value.title === "string" && Array.isArray(value.items)) {
    return {
      ...value,
      items: presentModuleRows(value.items as unknown[]),
    };
  }

  // Email list envelope
  if (Array.isArray(value.items) && ("total" in value || "offset" in value || "all" in value)) {
    const first = (value.items as unknown[])[0];
    if (isRecord(first) && ("subject" in first || "mailboxInfo" in first)) {
      return presentEmailList(value);
    }
  }

  // Notifications
  if ("notifications" in value && ("count" in value || "lastEventId" in value)) {
    return presentNotifications(value);
  }

  // Badges (flat number map, optional fetchedAt)
  const badgeValues = Object.entries(value).filter(([key]) => key !== "fetchedAt");
  if (
    badgeValues.length > 0 &&
    badgeValues.every(([, v]) => typeof v === "number") &&
    !("name" in value) &&
    !("email" in value)
  ) {
    return presentBadges(value);
  }

  // Holiday / Ferien countdown
  if (Array.isArray(value.seasons) && Array.isArray(value.next) && "asOf" in value) {
    return presentHolidays(value);
  }

  // Upcoming events
  if ("events" in value && Array.isArray(value.events)) {
    return presentUpcoming(value);
  }

  // User account info
  if (
    ("name" in value || "Name" in value) &&
    ("email" in value || "Email" in value) &&
    ("PublicInfo" in value || "Groups" in value || "Roles" in value)
  ) {
    return presentUserInfo(value);
  }

  // Email message detail
  if (isRecord(value.envelope) && isRecord(value.content)) {
    const env = value.envelope;
    const plain = isRecord(value.content)
      ? Array.isArray(value.content.plain)
        ? value.content.plain
        : []
      : [];
    const body =
      plain
        .map((part) => (isRecord(part) ? String(part.content ?? "") : ""))
        .join("\n")
        .trim()
        .slice(0, 2000) || "—";
    return {
      subject: cleanText(String(env.subject ?? "—")),
      from: formatAddrs(env.from),
      to: formatAddrs(env.to),
      date: shortDate(env.date),
      body,
    };
  }

  // Leave unrecognized records intact so nested CLI/MCP formatting still works
  return value;
}

function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(row)) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === "string") {
      const text = cleanText(entry);
      if (text !== "—") out[key] = text;
      continue;
    }
    if (typeof entry === "number" || typeof entry === "boolean") {
      out[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      if (entry.length === 0) continue;
      if (entry.every((item) => typeof item === "string" || typeof item === "number")) {
        out[key] = entry.map(String).join(", ");
      } else if (entry.every(isRecord) && entry[0] && "bare_address" in entry[0]) {
        out[key] = formatAddrs(entry);
      } else if (entry.every(isRecord) && entry[0] && "personal" in entry[0]) {
        out[key] = formatAddrs(entry);
      } else {
        out[key] = `${entry.length}`;
      }
      continue;
    }
    if (isRecord(entry)) {
      // Prefer common nested labels
      if (typeof entry.name === "string") out[key] = cleanText(entry.name);
      else if (typeof entry.label === "string") out[key] = cleanText(entry.label);
      else if (typeof entry.uid === "number" || typeof entry.uid === "string") {
        out[key] = String(entry.uid);
      } else if (typeof entry.body === "string") {
        out[key] = cleanText(entry.body).slice(0, 60);
      } else {
      }
    }
  }
  return out;
}
