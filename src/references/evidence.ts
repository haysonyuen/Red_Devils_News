import * as cheerio from "cheerio";
import { normalizePersonName } from "./identity";

export type EvidenceKind =
  | "PAGE_TITLE"
  | "IMAGE_ALT"
  | "FIGCAPTION"
  | "JSON_LD_NAME"
  | "JSON_LD_CAPTION";

export interface ImageEvidence {
  imageUrl: string;
  sourcePageUrl: string;
  signals: Array<{
    kind: EvidenceKind;
    value: string;
  }>;
}

export interface EvidenceDecision {
  accepted: boolean;
  independentSignalCount: number;
  reason: string;
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function imageUrlFromJson(value: unknown, baseUrl: string): string | null {
  if (typeof value === "string") return normalizeHttpUrl(value, baseUrl);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const raw = stringValue(record.url) ?? stringValue(record.contentUrl);
  return raw ? normalizeHttpUrl(raw, baseUrl) : null;
}

function containsExactName(value: string, requestedName: string): boolean {
  const normalizedValue = ` ${normalizePersonName(value)} `;
  const normalizedName = normalizePersonName(requestedName);
  return normalizedName.split(" ").length >= 2 &&
    normalizedValue.includes(` ${normalizedName} `);
}

export function extractCandidateEvidence(
  sourcePageUrl: string,
  html: string,
  preferredImageUrl?: string
): ImageEvidence[] {
  const $ = cheerio.load(html);
  const records = new Map<string, ImageEvidence>();

  const addSignal = (
    imageUrl: string,
    kind: EvidenceKind,
    value: string | null
  ) => {
    if (!value) return;
    const normalizedImage = normalizeHttpUrl(imageUrl, sourcePageUrl);
    if (!normalizedImage) return;
    const record = records.get(normalizedImage) ?? {
      imageUrl: normalizedImage,
      sourcePageUrl,
      signals: [],
    };
    if (
      !record.signals.some(
        (signal) =>
          signal.kind === kind &&
          normalizePersonName(signal.value) === normalizePersonName(value)
      )
    ) {
      record.signals.push({ kind, value });
    }
    records.set(normalizedImage, record);
  };

  const pageTitles = [
    $("title").first().text().trim(),
    $("meta[property='og:title']").attr("content")?.trim() ?? "",
    $("meta[name='twitter:title']").attr("content")?.trim() ?? "",
  ].filter(Boolean);

  const metadataImages = [
    {
      image: $("meta[property='og:image']").attr("content"),
      alt: $("meta[property='og:image:alt']").attr("content"),
    },
    {
      image: $("meta[property='og:image:secure_url']").attr("content"),
      alt: $("meta[property='og:image:alt']").attr("content"),
    },
    {
      image: $("meta[name='twitter:image']").attr("content"),
      alt: $("meta[name='twitter:image:alt']").attr("content"),
    },
    {
      image: $("meta[name='twitter:image:src']").attr("content"),
      alt: $("meta[name='twitter:image:alt']").attr("content"),
    },
  ];
  for (const metadata of metadataImages) {
    if (!metadata.image) continue;
    const imageUrl = normalizeHttpUrl(metadata.image, sourcePageUrl);
    if (!imageUrl) continue;
    pageTitles.forEach((title) => addSignal(imageUrl, "PAGE_TITLE", title));
    addSignal(imageUrl, "IMAGE_ALT", metadata.alt?.trim() ?? null);
    if (!records.has(imageUrl)) {
      records.set(imageUrl, {
        imageUrl,
        sourcePageUrl,
        signals: [],
      });
    }
  }

  $("img[src]").each((_index, element) => {
    const rawUrl = $(element).attr("src");
    if (!rawUrl) return;
    const imageUrl = normalizeHttpUrl(rawUrl, sourcePageUrl);
    if (!imageUrl) return;
    pageTitles.forEach((title) => addSignal(imageUrl, "PAGE_TITLE", title));
    addSignal(imageUrl, "IMAGE_ALT", $(element).attr("alt")?.trim() ?? null);
    const caption = $(element).closest("figure").find("figcaption").first().text();
    addSignal(imageUrl, "FIGCAPTION", caption.trim() || null);
    if (!records.has(imageUrl)) {
      records.set(imageUrl, { imageUrl, sourcePageUrl, signals: [] });
    }
  });

  $("script[type='application/ld+json']").each((_index, element) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(element).text());
    } catch {
      return;
    }
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const imageUrl = imageUrlFromJson(record.image, sourcePageUrl);
      if (imageUrl) {
        pageTitles.forEach((title) =>
          addSignal(imageUrl, "PAGE_TITLE", title)
        );
        addSignal(imageUrl, "JSON_LD_NAME", stringValue(record.name));
        if (record.image && typeof record.image === "object") {
          const image = record.image as Record<string, unknown>;
          addSignal(
            imageUrl,
            "JSON_LD_CAPTION",
            stringValue(image.caption) ?? stringValue(image.description)
          );
        }
        addSignal(
          imageUrl,
          "JSON_LD_CAPTION",
          stringValue(record.caption)
        );
        if (!records.has(imageUrl)) {
          records.set(imageUrl, { imageUrl, sourcePageUrl, signals: [] });
        }
      }
      Object.values(record).forEach(visit);
    };
    visit(parsed);
  });

  const preferred = preferredImageUrl
    ? normalizeHttpUrl(preferredImageUrl, sourcePageUrl)
    : null;
  const evidence = [...records.values()];
  return preferred
    ? evidence.filter((record) => record.imageUrl === preferred)
    : evidence;
}

export function validateCandidateEvidence(
  requestedName: string,
  evidence: ImageEvidence
): EvidenceDecision {
  const matchingKinds = new Set(
    evidence.signals
      .filter((signal) => containsExactName(signal.value, requestedName))
      .map((signal) => signal.kind)
  );
  const independentSignalCount = matchingKinds.size;
  return {
    accepted: independentSignalCount >= 2,
    independentSignalCount,
    reason:
      independentSignalCount >= 2
        ? "VERIFIED_NAME_EVIDENCE"
        : "INSUFFICIENT_NAME_EVIDENCE",
  };
}
