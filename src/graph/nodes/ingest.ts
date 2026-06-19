import axios from "axios";
import * as cheerio from "cheerio";
import { PipelineState, SearchResult, ArticleContent } from "../state";
import { isAllowlisted, isBlocklisted } from "../../mcp/server";
import { fetchManUtdNews } from "../../ingestion/bbcRss";

interface IngestDependencies {
  fetchNews: () => Promise<SearchResult[]>;
  fetchHtml: (url: string) => Promise<string>;
  fixtureArticleUrl: string | null;
}

function fixtureHit(url: string): SearchResult {
  return {
    url,
    title: "Dev fixture article",
    source: "BBC Sport",
    publishedAt: new Date().toISOString(),
  };
}

async function defaultFetchHtml(url: string): Promise<string> {
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0)",
    },
    timeout: 15_000,
  });
  return html;
}

// ── Scrape article with Cheerio ───────────────────────────────────────────────

async function scrapeArticle(
  hit: SearchResult,
  fetchHtml: (url: string) => Promise<string>
): Promise<ArticleContent | null> {
  if (isBlocklisted(hit.url)) {
    console.warn(`[ingest] BLOCKED: ${hit.url}`);
    return null;
  }
  if (!isAllowlisted(hit.url, hit.source)) {
    console.warn(`[ingest] NOT ALLOWLISTED: ${hit.url} (source: ${hit.source})`);
    return null;
  }

  try {
    const html = await fetchHtml(hit.url);

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
  state: PipelineState,
  dependencies: Partial<IngestDependencies> = {}
): Promise<Partial<PipelineState>> {
  const fetchNews = dependencies.fetchNews ?? fetchManUtdNews;
  const fetchHtml = dependencies.fetchHtml ?? defaultFetchHtml;
  const fixtureArticleUrl =
    dependencies.fixtureArticleUrl ?? process.env.DEV_FIXTURE_ARTICLE_URL ?? null;
  console.log(
    fixtureArticleUrl
      ? `[ingest] Using dev fixture article…`
      : `[ingest] Searching for Man Utd news…`
  );

  let rawSearchHits: SearchResult[] = [];
  const errorLog: string[] = [];

  try {
    rawSearchHits = fixtureArticleUrl
      ? [fixtureHit(fixtureArticleUrl)]
      : await fetchNews();
    console.log(`[ingest] ${rawSearchHits.length} raw hit(s) returned`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorLog.push(`[ingest] Search failed: ${msg}`);
    console.error(`[ingest] Search error: ${msg}`);
    return { rawSearchHits: [], filteredArticles: [], errorLog };
  }

  // Scrape all hits concurrently; filter nulls
  const scraped = await Promise.all(
    rawSearchHits.map((hit) => scrapeArticle(hit, fetchHtml))
  );
  const filteredArticles: ArticleContent[] = scraped.filter(
    (a): a is ArticleContent => a !== null
  );

  console.log(
    `[ingest] ${filteredArticles.length}/${rawSearchHits.length} articles passed allow/blocklist`
  );

  return { rawSearchHits, filteredArticles, errorLog };
}
