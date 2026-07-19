import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbiddenFiles = /(^|\/)(\.env(?:\..+)?|[^/]+\.har)$/i;
const secretPatterns = [
  /IServSAT(?:Id)?\s*[=:]\s*[^\s"']+/i,
  /IServSession\s*[=:]\s*[^\s"']+/i,
  /(?:password|passwd|_password)\s*[=:]\s*["'](?!test-|example-|<)[^"'${}]{12,}["']/i,
  /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{12,}/i,
];
const allowedHosts = new Set([
  "iserv.example",
  "example.invalid",
  "your-school.iserv.de",
  "github.com",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
  "doku.iserv.de",
  "modelcontextprotocol.io",
  "matrix.to",
]);
const instanceHostPattern = /(?:ISERV_URL\s*=|--url\s+|connect\s*\(\s*["']|instance(?:Url|Host)?\s*[:=]\s*["'])(?:https?:\/\/)?([a-z0-9.-]+)/gi;
const violations = [];

for (const file of files) {
  if (forbiddenFiles.test(file)) {
    violations.push(`${file}: forbidden tracked capture/config file`);
    continue;
  }
  if (/package-lock\.json$/.test(file) || /\.(?:png|jpg|jpeg|gif|woff2?)$/i.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) violations.push(`${file}: possible credential or session material`);
  }
  for (const match of text.matchAll(instanceHostPattern)) {
    const host = match[1]?.toLowerCase();
    if (host && !allowedHosts.has(host)) {
      violations.push(`${file}: non-allowlisted literal host ${host}`);
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Sensitive-data check passed for ${files.length} tracked files.`);
