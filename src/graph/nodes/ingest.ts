import axios from "axios";
import * as cheerio from "cheerio";
import { PipelineState, SearchResult, ArticleContent } from "../state";
import { isAllowlisted, isBlocklisted } from "../../mcp/server";
import { fetchManUtdNews } from "../../ingestion/bbcRss";

// ── Scrape article with Cheerio ───────────────────────────────────────────────

async function scrapeArticle(hit: SearchResult): Promise<ArticleContent | null> {
  if (isBlocklisted(hit.url)) {
    console.warn(`[ingest] BLOCKED: ${hit.url}`);
    return null;
  }
  if (!isAllowlisted(hit.url, hit.source)) {
    console.warn(`[ingest] NOT ALLOWLISTED: ${hit.url} (source: ${hit.source})`);
    return null;
  }

  try {
    const { data: html } = await axios.get(hit.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0)",
      },
      timeout: 15_000,
    });

    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, aside, .ad, .advertisement").remove();

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text().trim() ||
      hit.title;

    const source =
      $("meta[property='og:site_name']").attr("content") || hit.source;

    const bodyEl = $("article").length
      ? $("article")
      : $("main").length
      ? $("main")
      : $("body");

    const bodyText = bodyEl.text().replace(/\s+/g, " ").trim();

    console.log(`[ingest] ✔ Scraped: "${title}" (${source})`);
    return { url: hit.url, title, source, bodyText };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingest] ✖ Failed to scrape ${hit.url}: ${msg}`);
    return null;
  }
}

// ── Node ──────────────────────────────────────────────────────────────────────

export async function ingestNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  console.log(`[ingest] Searching for Man Utd news…`);

  let rawSearchHits: SearchResult[] = [];
  const errorLog: string[] = [];

  try {
    rawSearchHits = await fetchManUtdNews();
    console.log(`[ingest] ${rawSearchHits.length} raw hit(s) returned`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorLog.push(`[ingest] Search failed: ${msg}`);
    console.error(`[ingest] Search error: ${msg}`);
    return { rawSearchHits: [], filteredArticles: [], errorLog };
  }

  // Scrape all hits concurrently; filter nulls
  const scraped = await Promise.all(rawSearchHits.map(scrapeArticle));
  const filteredArticles: ArticleContent[] = scraped.filter(
    (a): a is ArticleContent => a !== null
  );

  console.log(
    `[ingest] ${filteredArticles.length}/${rawSearchHits.length} articles passed allow/blocklist`
  );

  return { rawSearchHits, filteredArticles, errorLog };
}
