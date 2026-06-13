import { randomUUID } from "node:crypto";
import axios from "axios";
import * as cheerio from "cheerio";
import { ReferenceCandidate } from "../graph/contracts";

const OFFICIAL_HOSTS = [
  "manutd.com",
  "premierleague.com",
  "thefa.com",
  "uefa.com",
  "fifa.com",
];
const MAX_OFFICIAL_PAGE_FETCHES = 2;
const MAX_CANDIDATES = 3;

export interface DiscoveryInput {
  requestId: string;
  person: string;
  selectedArticleUrls: string[];
  fetchHtml?: (url: string) => Promise<string>;
  now?: Date;
}

export interface PageMetadata {
  imageUrls: string[];
  officialLinks: string[];
}

function normalizeHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function isApprovedOfficialHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    return OFFICIAL_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

export function extractPageMetadata(
  pageUrl: string,
  html: string
): PageMetadata {
  const $ = cheerio.load(html);
  const imageUrls: string[] = [];
  const officialLinks: string[] = [];
  const seenImages = new Set<string>();
  const seenLinks = new Set<string>();
  const imageSelectors = [
    "meta[property='og:image']",
    "meta[property='og:image:secure_url']",
    "meta[name='twitter:image']",
    "meta[name='twitter:image:src']",
  ];

  for (const selector of imageSelectors) {
    $(selector).each((_index, element) => {
      const content = $(element).attr("content");
      if (!content) return;
      const normalized = normalizeHttpUrl(content, pageUrl);
      if (normalized && !seenImages.has(normalized)) {
        seenImages.add(normalized);
        imageUrls.push(normalized);
      }
    });
  }

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const normalized = normalizeHttpUrl(href, pageUrl);
    if (
      normalized &&
      isApprovedOfficialHost(normalized) &&
      !seenLinks.has(normalized)
    ) {
      seenLinks.add(normalized);
      officialLinks.push(normalized);
    }
  });

  return { imageUrls, officialLinks };
}

async function defaultFetchHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0; +https://github.com/haysonyuen/Red_Devils_News)",
    },
    timeout: 15_000,
    responseType: "text",
  });
  return response.data;
}

export async function discoverReferenceCandidates({
  requestId,
  person,
  selectedArticleUrls,
  fetchHtml = defaultFetchHtml,
  now = new Date(),
}: DiscoveryInput): Promise<ReferenceCandidate[]> {
  const discoveredAt = now.toISOString();
  const candidates: ReferenceCandidate[] = [];
  const seenImages = new Set<string>();
  const officialLinks: string[] = [];
  const seenOfficialLinks = new Set<string>();

  const addCandidate = (
    imageUrl: string,
    sourcePageUrl: string,
    origin: ReferenceCandidate["origin"]
  ) => {
    if (candidates.length >= MAX_CANDIDATES || seenImages.has(imageUrl)) return;
    seenImages.add(imageUrl);
    candidates.push({
      id: randomUUID(),
      requestId,
      person,
      imageUrl,
      sourcePageUrl,
      origin,
      rank: candidates.length + 1,
      status: "AVAILABLE",
      discoveredAt,
    });
  };

  for (const articleUrl of selectedArticleUrls) {
    if (candidates.length >= MAX_CANDIDATES) break;
    try {
      const metadata = extractPageMetadata(
        articleUrl,
        await fetchHtml(articleUrl)
      );
      metadata.imageUrls.forEach((imageUrl) =>
        addCandidate(imageUrl, articleUrl, "SELECTED_ARTICLE")
      );
      for (const link of metadata.officialLinks) {
        if (!seenOfficialLinks.has(link)) {
          seenOfficialLinks.add(link);
          officialLinks.push(link);
        }
      }
    } catch {
      continue;
    }
  }

  for (const officialUrl of officialLinks.slice(0, MAX_OFFICIAL_PAGE_FETCHES)) {
    if (candidates.length >= MAX_CANDIDATES) break;
    try {
      const metadata = extractPageMetadata(
        officialUrl,
        await fetchHtml(officialUrl)
      );
      metadata.imageUrls.forEach((imageUrl) =>
        addCandidate(imageUrl, officialUrl, "OFFICIAL_LINK")
      );
    } catch {
      continue;
    }
  }

  return candidates;
}
