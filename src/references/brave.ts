import axios from "axios";

const BRAVE_IMAGE_SEARCH =
  "https://api.search.brave.com/res/v1/images/search";
const MAX_DOMAINS = 5;
const MAX_RESULTS = 10;

export interface BraveImageResult {
  imageUrl: string;
  sourcePageUrl: string;
  title: string;
}

export interface BraveSearchDependencies {
  searchImages: (
    query: string,
    count: number
  ) => Promise<BraveImageResult[]>;
}

export class BraveConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BraveConfigurationError";
  }
}

function normalizedDomain(value: string): string | null {
  const candidate = value.trim().toLocaleLowerCase().replace(/^www\./, "");
  if (!candidate || candidate.includes("/") || candidate.includes(":")) {
    return null;
  }
  try {
    return new URL(`https://${candidate}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function belongsToDomain(urlValue: string, domain: string): boolean {
  try {
    const hostname = new URL(urlValue).hostname.toLocaleLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

async function defaultSearchImages(
  query: string,
  count: number
): Promise<BraveImageResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    throw new BraveConfigurationError("BRAVE_SEARCH_API_KEY is required");
  }
  const response = await axios.get<{
    results?: Array<{
      title?: string;
      url?: string;
      source?: string;
      properties?: { url?: string };
      thumbnail?: { src?: string };
    }>;
  }>(BRAVE_IMAGE_SEARCH, {
    params: {
      q: query,
      count,
      safesearch: "strict",
      spellcheck: false,
    },
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
    timeout: 10_000,
  });
  return (response.data.results ?? []).flatMap((result) => {
    const imageUrl = result.properties?.url ?? result.thumbnail?.src;
    const sourcePageUrl = result.url ?? result.source;
    if (!imageUrl || !sourcePageUrl) return [];
    return [
      {
        imageUrl,
        sourcePageUrl,
        title: result.title ?? "",
      },
    ];
  });
}

export async function searchOfficialPlayerImages(
  input: {
    canonicalName: string;
    officialDomains: string[];
  },
  dependencies: Partial<BraveSearchDependencies> = {}
): Promise<BraveImageResult[]> {
  const searchImages = dependencies.searchImages ?? defaultSearchImages;
  const domains = input.officialDomains
    .map(normalizedDomain)
    .filter((domain): domain is string => Boolean(domain))
    .filter((domain, index, values) => values.indexOf(domain) === index)
    .slice(0, MAX_DOMAINS);
  const results: BraveImageResult[] = [];
  const seen = new Set<string>();

  for (const domain of domains) {
    if (results.length >= MAX_RESULTS) break;
    const query = `"${input.canonicalName}" site:${domain}`;
    const found = await searchImages(query, MAX_RESULTS - results.length);
    for (const result of found) {
      if (results.length >= MAX_RESULTS) break;
      const imageUrl = normalizedHttpUrl(result.imageUrl);
      const sourcePageUrl = normalizedHttpUrl(result.sourcePageUrl);
      if (
        !imageUrl ||
        !sourcePageUrl ||
        !belongsToDomain(sourcePageUrl, domain)
      ) {
        continue;
      }
      const key = `${imageUrl}\n${sourcePageUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        imageUrl,
        sourcePageUrl,
        title: result.title,
      });
    }
  }

  return results;
}
