import { PipelineState, ScoutBrief } from "../state";
import { callLlmJson } from "../../llm/client";
import { mapToSuppliedUrl } from "../../validation/url";

const SCOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["selectedArticleUrls", "selectionReason", "confidence"],
  properties: {
    selectedArticleUrls: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" },
    },
    selectionReason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

export function parseScoutBrief(value: unknown): ScoutBrief {
  if (typeof value !== "object" || value === null) {
    throw new Error("Scout output is not an object");
  }

  const brief = value as Record<string, unknown>;
  if (
    !Array.isArray(brief.selectedArticleUrls) ||
    typeof brief.selectionReason !== "string" ||
    typeof brief.confidence !== "number"
  ) {
    throw new Error("Scout output is missing required fields");
  }

  const selectedArticleUrls = brief.selectedArticleUrls.filter(
    (url): url is string => typeof url === "string"
  );
  if (
    selectedArticleUrls.length === 0 ||
    selectedArticleUrls.length > 3 ||
    brief.confidence < 0 ||
    brief.confidence > 1
  ) {
    throw new Error("Scout selection or confidence is invalid");
  }

  return {
    selectedArticleUrls,
    selectionReason: brief.selectionReason.trim(),
    confidence: brief.confidence,
  };
}

export async function scoutNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  console.log(`[scout] Ranking ${state.filteredArticles.length} article(s)`);

  const candidates = state.filteredArticles.map((article) => ({
    title: article.title,
    source: article.source,
    url: article.url,
    excerpt: article.bodyText.slice(0, 1_500),
  }));

  try {
    const response = await callLlmJson(
      [
        "You are the News Scout for a premium Manchester United Instagram publication.",
        "Choose one current, consequential story and up to three supplied articles that support it.",
        "Prefer concrete club news over nostalgia, generic features, or weak speculation.",
        "Return only JSON with exactly these keys:",
        '{"selectedArticleUrls":["string"],"selectionReason":"string","confidence":0.0}.',
        "Use only URLs supplied in the candidates.",
      ].join(" "),
      JSON.stringify({ candidates }),
      {
        model: process.env.LLM_SCOUT_MODEL,
        schemaName: "scout_brief",
        schema: SCOUT_SCHEMA,
      }
    );

    const scoutBrief = parseScoutBrief(response);
    const suppliedUrls = candidates.map((candidate) => candidate.url);
    const selectedArticleUrls = scoutBrief.selectedArticleUrls.map((url) =>
      mapToSuppliedUrl(url, suppliedUrls)
    );
    if (selectedArticleUrls.some((url) => url === null)) {
      throw new Error("Scout selected a URL that was not supplied");
    }

    console.log(
      `[scout] Selected ${scoutBrief.selectedArticleUrls.length} article(s), confidence=${scoutBrief.confidence}`
    );
    return {
      scoutBrief: {
        ...scoutBrief,
        selectedArticleUrls: selectedArticleUrls as string[],
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scout] Failed: ${msg}`);
    return {
      scoutBrief: null,
      errorLog: [`[scout] ${msg}`],
    };
  }
}
