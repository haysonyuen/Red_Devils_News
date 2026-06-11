import { StorySelection, StoryStatus } from "../contracts";
import { PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { mapToSuppliedUrl } from "../../validation/url";

const STORY_STATUSES: StoryStatus[] = [
  "CONFIRMED",
  "ADVANCED",
  "INTEREST",
  "SPECULATION",
];

const SCOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "primaryStory",
    "supportingSourceUrls",
    "mainCharacters",
    "storyStatus",
    "visualPotential",
    "selectionReason",
    "confidence",
  ],
  properties: {
    decision: { type: "string", enum: ["SELECT", "NO_STORY"] },
    primaryStory: { type: ["string", "null"] },
    supportingSourceUrls: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
    },
    mainCharacters: {
      type: "array",
      items: { type: "string" },
    },
    storyStatus: {
      type: ["string", "null"],
      enum: [...STORY_STATUSES, null],
    },
    visualPotential: { type: "number", minimum: 0, maximum: 100 },
    selectionReason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const STORY_SELECTION_KEYS = [
  "decision",
  "primaryStory",
  "supportingSourceUrls",
  "mainCharacters",
  "storyStatus",
  "visualPotential",
  "selectionReason",
  "confidence",
].sort();

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === expected.join("\0");
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`Scout output has invalid ${fieldName}`);
  }
  return value.map((item) => item.trim());
}

export function parseStorySelection(value: unknown): StorySelection {
  if (typeof value !== "object" || value === null) {
    throw new Error("Scout output is not an object");
  }

  const selection = value as Record<string, unknown>;
  if (!hasExactKeys(selection, STORY_SELECTION_KEYS)) {
    throw new Error("Scout output has unexpected or missing fields");
  }

  if (
    selection.decision !== "SELECT" &&
    selection.decision !== "NO_STORY"
  ) {
    throw new Error("Scout output has an invalid decision");
  }
  if (
    typeof selection.visualPotential !== "number" ||
    !Number.isFinite(selection.visualPotential) ||
    selection.visualPotential < 0 ||
    selection.visualPotential > 100 ||
    typeof selection.confidence !== "number" ||
    !Number.isFinite(selection.confidence) ||
    selection.confidence < 0 ||
    selection.confidence > 1 ||
    typeof selection.selectionReason !== "string" ||
    selection.selectionReason.trim().length === 0
  ) {
    throw new Error("Scout output has invalid scores or selection reason");
  }

  const supportingSourceUrls = parseStringArray(
    selection.supportingSourceUrls,
    "supportingSourceUrls"
  );
  const mainCharacters = parseStringArray(
    selection.mainCharacters,
    "mainCharacters"
  );
  const storyStatus =
    selection.storyStatus === null ||
    STORY_STATUSES.includes(selection.storyStatus as StoryStatus)
      ? (selection.storyStatus as StoryStatus | null)
      : undefined;

  if (storyStatus === undefined) {
    throw new Error("Scout output has an invalid storyStatus");
  }

  if (selection.decision === "SELECT") {
    if (
      typeof selection.primaryStory !== "string" ||
      selection.primaryStory.trim().length === 0 ||
      supportingSourceUrls.length < 1 ||
      supportingSourceUrls.length > 3 ||
      mainCharacters.length === 0 ||
      storyStatus === null
    ) {
      throw new Error("Scout SELECT output is incomplete");
    }
  } else if (
    selection.primaryStory !== null ||
    supportingSourceUrls.length !== 0 ||
    storyStatus !== null
  ) {
    throw new Error("Scout NO_STORY output is contradictory");
  }

  return {
    decision: selection.decision,
    primaryStory:
      typeof selection.primaryStory === "string"
        ? selection.primaryStory.trim()
        : null,
    supportingSourceUrls,
    mainCharacters,
    storyStatus,
    visualPotential: selection.visualPotential,
    selectionReason: selection.selectionReason.trim(),
    confidence: selection.confidence,
  };
}

export function validateStorySelectionUrls(
  selection: StorySelection,
  suppliedUrls: string[],
  rejectedStoryUrls: string[]
): StorySelection {
  if (selection.decision === "NO_STORY") return selection;

  const supportingSourceUrls = selection.supportingSourceUrls.map((url) => {
    const suppliedUrl = mapToSuppliedUrl(url, suppliedUrls);
    if (!suppliedUrl) {
      throw new Error("Scout selected a URL that was not supplied");
    }
    if (mapToSuppliedUrl(suppliedUrl, rejectedStoryUrls)) {
      throw new Error("Scout selected a previously rejected URL");
    }
    return suppliedUrl;
  });

  if (new Set(supportingSourceUrls).size !== supportingSourceUrls.length) {
    throw new Error("Scout selected a duplicate supporting URL");
  }

  return { ...selection, supportingSourceUrls };
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
      loadPrompt("scout.v2.md"),
      JSON.stringify({
        candidates,
        rejectedStoryUrls: state.rejectedStoryUrls,
      }),
      {
        model: process.env.LLM_SCOUT_MODEL,
        schemaName: "story_selection",
        schema: SCOUT_SCHEMA,
      }
    );

    const storySelection = validateStorySelectionUrls(
      parseStorySelection(response),
      candidates.map((candidate) => candidate.url),
      state.rejectedStoryUrls
    );

    console.log(`[scout] Decision=${storySelection.decision}`);
    return {
      storySelection,
      scoutBrief:
        storySelection.decision === "SELECT"
          ? {
              selectedArticleUrls: storySelection.supportingSourceUrls,
              selectionReason: storySelection.selectionReason,
              confidence: storySelection.confidence,
            }
          : null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scout] Failed: ${msg}`);
    return {
      storySelection: null,
      scoutBrief: null,
      errorLog: [`[scout] ${msg}`],
    };
  }
}
