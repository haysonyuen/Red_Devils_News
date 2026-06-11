/**
 * Inline verification for allowlist / blocklist logic.
 * Run with: npx ts-node src/mcp/server.test.ts
 */

import { isAllowlisted, isBlocklisted } from "./server";

interface TestCase {
  url: string;
  source?: string;
  expectAllowed: boolean;
  label: string;
}

const cases: TestCase[] = [
  // ── Should PASS ─────────────────────────────────────────────────────────
  { url: "https://www.theathletic.com/5432543/2026/05/26/man-utd-transfer-news/", expectAllowed: true, label: "The Athletic" },
  { url: "https://www.bbc.co.uk/sport/football/manchester-united", expectAllowed: true, label: "BBC Sport (co.uk)" },
  { url: "https://www.bbc.com/sport/football/manchester-united", expectAllowed: true, label: "BBC Sport (.com)" },
  { url: "https://theathletic.com/news/ornstein-man-utd/", source: "David Ornstein", expectAllowed: true, label: "David Ornstein via Athletic" },
  { url: "https://some-site.com/fabrizio-romano-man-utd/", expectAllowed: true, label: "Fabrizio Romano URL slug" },

  // ── Should FAIL (blocklist) ──────────────────────────────────────────────
  { url: "https://www.thesun.co.uk/sport/football/man-utd-transfer/", expectAllowed: false, label: "The Sun" },
  { url: "https://www.dailymail.co.uk/sport/football/man-utd.html", expectAllowed: false, label: "Daily Mail" },
  { url: "https://www.mirror.co.uk/sport/football/", expectAllowed: false, label: "Mirror" },
  { url: "https://www.bild.de/sport/fussball/manchester-united.html", expectAllowed: false, label: "BILD" },

  // ── Should FAIL (not allowlisted) ────────────────────────────────────────
  { url: "https://www.skysports.com/football/news/11095/man-utd", expectAllowed: false, label: "Sky Sports (not allowlisted)" },
  { url: "https://www.espn.com/soccer/manchester-united/", expectAllowed: false, label: "ESPN (not allowlisted)" },
];

let passed = 0;
let failed = 0;

for (const tc of cases) {
  const result = isAllowlisted(tc.url, tc.source);
  const ok = result === tc.expectAllowed;
  const icon = ok ? "✔" : "✖";
  const expected = tc.expectAllowed ? "ALLOW" : "BLOCK";
  const got = result ? "ALLOW" : "BLOCK";

  console.log(`${icon} [${expected}] ${tc.label}`);
  if (!ok) {
    console.log(`       URL: ${tc.url}`);
    console.log(`       Expected: ${expected}  Got: ${got}`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
