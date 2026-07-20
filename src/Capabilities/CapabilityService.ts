import * as cheerio from "cheerio";
import type { IServSession } from "../Core/IServSession.js";
import { type RouteSideEffect, routeCatalog } from "../Routes/RouteCatalog.js";

export type ModuleAccess = "available" | "experimental" | "not-installed" | "unknown";

export interface ModuleCapability {
  module: string;
  access: ModuleAccess;
  catalogued: Record<RouteSideEffect, number>;
  verifiedReadRoutes: number;
}

const NAVIGATION_SLUGS: Record<string, string[]> = {
  account: ["account"],
  users: ["addressbook"],
  notifications: ["notification"],
  calendar: ["calendar"],
  files: ["file", "fs"],
  mail: ["mail"],
  messenger: ["messenger"],
  conference: ["videoconference"],
  exercise: ["exercise"],
  timetable: ["timetable"],
  poll: ["poll"],
  forums: ["forums"],
  news: ["news"],
  "course-selection": ["courseselection"],
  "mailing-lists": ["mailinglist"],
  print: ["print"],
  pinboard: ["dsa-pinboard"],
  app: ["app"],
  etherpad: ["etherpad"],
  excalidraw: ["excalidraw"],
  groupview: ["groupview"],
  help: ["help"],
  office: ["office"],
  education: ["eduplacesconnector"],
};

const emptyCounts = (): Record<RouteSideEffect, number> => ({
  read: 0,
  write: 0,
  communicative: 0,
  destructive: 0,
});

export class CapabilityService {
  constructor(private readonly session: IServSession) {}

  static unknown(): ModuleCapability[] {
    return CapabilityService.fromInstalledSlugs(new Set());
  }

  async list(): Promise<ModuleCapability[]> {
    const response = await this.session.http.get(`${this.session.baseUrl()}/iserv/`);
    const $ = cheerio.load(response.data as string);
    const installedSlugs = new Set<string>();
    $("a[href]").each((_index, element) => {
      const raw = $(element).attr("href");
      if (!raw) return;
      const target = new URL(raw, this.session.baseUrl());
      if (target.origin !== this.session.baseUrl()) return;
      const match = target.pathname.match(/^\/iserv\/([^/]+)/);
      if (match?.[1]) installedSlugs.add(match[1]);
    });

    return CapabilityService.fromInstalledSlugs(installedSlugs);
  }

  private static fromInstalledSlugs(installedSlugs: Set<string>): ModuleCapability[] {
    return routeCatalog
      .modules()
      .filter((module) => module !== "auth")
      .map((module) => {
        const routes = routeCatalog.tree()[module] ?? [];
        const catalogued = emptyCounts();
        for (const route of routes.filter((candidate) => candidate.status === "supported")) {
          catalogued[route.sideEffect] += 1;
        }
        const slugs = NAVIGATION_SLUGS[module] ?? [];
        const installed = slugs.some((slug) => installedSlugs.has(slug));
        const access: ModuleAccess =
          installedSlugs.size === 0
            ? "unknown"
            : installed
              ? routes.some((route) => route.status === "supported")
                ? "available"
                : "experimental"
              : slugs.length > 0
                ? "not-installed"
                : "unknown";
        return {
          module,
          access,
          catalogued,
          verifiedReadRoutes: routes.filter(
            (route) =>
              route.method === "GET" &&
              route.sideEffect === "read" &&
              route.status === "supported" &&
              Boolean(route.lastVerified),
          ).length,
        };
      });
  }
}
