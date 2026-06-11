import axios from "axios";
import * as cheerio from "cheerio";
import type { SearchResult } from "../graph/state";

const BBC_FOOTBALL_RSS =
  "https://feeds.bbci.co.uk/sport/football/rss.xml";
const MAN_UTD_PATTERN = /\b(man(?:chester)? united|man utd|old trafford)\b/i;
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

export function parseBbcFootballRss(
  xml: string,
  now = new Date()
): SearchResult[] {
  const $ = cheerio.load(xml, { xmlMode: true });

  const hits = $("item")
    .toArray()
    .map((item) => {
      const node = $(item);
      const title = node.find("title").first().text().trim();
      const description = node.find("description").first().text().trim();
      const url = node.find("link").first().text().trim();
      const publishedAt = node.find("pubDate").first().text().trim();

      const publishedDate = new Date(publishedAt);
      if (
        !url ||
        !MAN_UTD_PATTERN.test(`${title} ${description}`) ||
        Number.isNaN(publishedDate.getTime()) ||
        now.getTime() - publishedDate.getTime() > MAX_ARTICLE_AGE_MS
      ) {
        return null;
      }

      return {
        url,
        title,
        source: "BBC Sport",
        publishedAt: publishedDate.toISOString(),
      };
    })
    .filter((hit): hit is SearchResult => hit !== null);

  const uniqueHits = new Map(hits.map((hit) => [hit.url, hit]));
  return [...uniqueHits.values()]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .slice(0, 5);
}

export async function fetchManUtdNews(): Promise<SearchResult[]> {
  const response = await axios.get<string>(BBC_FOOTBALL_RSS, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0)",
    },
    timeout: 15_000,
    responseType: "text",
  });

  return parseBbcFootballRss(response.data);
}
