/**
 * Local MCP Server — Man Utd News Pipeline
 *
 * Exposes two tools:
 *   search_news   — reads BBC Sport RSS for recent Man Utd articles
 *   scrape_article — fetches + parses an article URL (Axios + Cheerio)
 *
 * Allowlist/Blocklist are enforced here so bad data never enters the graph.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import type { ArticleContent } from "../graph/state";
import { fetchManUtdNews } from "../ingestion/bbcRss";

// ── Source lists ──────────────────────────────────────────────────────────────

const ALLOWLIST_PATTERNS = [
  /davidornstein/i,
  /theathletic\.com/i,
  /bbc\.co\.uk\/sport/i,
  /bbc\.com\/sport/i,
  /fabrizioromano/i,
  /fabrizio-romano/i,
  /simonstonenews/i,
  /simon-stone/i,
  // Whitelisted authors can appear on various domains; match by query return
];

const BLOCKLIST_PATTERNS = [
  /thesun\.co\.uk/i,
  /thesun\.com/i,
  /dailymail\.co\.uk/i,
  /dailymail\.com/i,
  /mirror\.co\.uk/i,
  /mirror\.com/i,
  /bild\.de/i,
];

export function isAllowlisted(url: string, source?: string): boolean {
  const target = `${url} ${source ?? ""}`;
  if (BLOCKLIST_PATTERNS.some((p) => p.test(target))) return false;
  return ALLOWLIST_PATTERNS.some((p) => p.test(target));
}

export function isBlocklisted(url: string): boolean {
  return BLOCKLIST_PATTERNS.some((p) => p.test(url));
}

// ── Cheerio scraper ───────────────────────────────────────────────────────────

async function scrapeArticle(url: string): Promise<ArticleContent> {
  if (isBlocklisted(url)) {
    throw new Error(`BLOCKED_SOURCE: ${url} matches the blocklist`);
  }
  if (!isAllowlisted(url)) {
    throw new Error(`NOT_ALLOWLISTED: ${url} is not in the allowlist`);
  }

  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0; +https://github.com/red-devils-news)",
    },
    timeout: 15_000,
  });

  const $ = cheerio.load(html);

  // Remove noise elements
  $("script, style, nav, header, footer, aside, .ad, .advertisement, .cookie-banner").remove();

  // Title
  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text().trim() ||
    "Untitled";

  // Source
  const source =
    $("meta[property='og:site_name']").attr("content") ||
    new URL(url).hostname;

  // Body — prefer article tag, fall back to main, then body
  const bodyEl = $("article").length ? $("article") : $("main").length ? $("main") : $("body");
  const bodyText = bodyEl.text().replace(/\s+/g, " ").trim();

  return { url, title, source, bodyText };
}

// ── MCP Server setup ──────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "man-utd-news-mcp",
    version: "1.0.0",
  });

  server.tool(
    "search_news",
    "Find recent Manchester United news in the BBC Sport football RSS feed.",
    { query: z.string().describe("Search query, e.g. 'Manchester United transfer news'") },
    async () => {
      const results = await fetchManUtdNews();
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "scrape_article",
    "Scrape full article text from an allowlisted URL. Throws BLOCKED_SOURCE for blocklisted URLs.",
    { url: z.string().url().describe("Full URL of the article to scrape") },
    async ({ url }) => {
      const article = await scrapeArticle(url);
      return {
        content: [{ type: "text", text: JSON.stringify(article, null, 2) }],
      };
    }
  );

  return server;
}

// ── Standalone entry (for running the MCP server as a subprocess) ─────────────
if (require.main === module) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("[mcp] Man Utd News MCP server running on stdio");
  });
}
