import { EditorialBrief, PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { validateCaption } from "../../validation/caption";
import { mapToSuppliedUrl } from "../../validation/url";
import { validateImagePrompt } from "../../validation/imagePrompt";

interface ProducerDraft extends EditorialBrief {
  caption: string;
  image_prompt: string;
}

const PRODUCER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative", "facts", "context", "caption", "image_prompt"],
  properties: {
    narrative: { type: "string" },
    facts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "sourceUrl"],
        properties: {
          claim: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
    context: { type: "string" },
    caption: { type: "string" },
    image_prompt: { type: "string" },
  },
};

export function parseProducerDraft(value: unknown): ProducerDraft {
  if (typeof value !== "object" || value === null) {
    throw new Error("Producer output is not an object");
  }

  const draft = value as Record<string, unknown>;
  if (
    typeof draft.narrative !== "string" ||
    typeof draft.context !== "string" ||
    typeof draft.caption !== "string" ||
    typeof draft.image_prompt !== "string" ||
    !Array.isArray(draft.facts) ||
    draft.facts.length === 0
  ) {
    throw new Error("Producer output is missing required fields");
  }

  const facts = draft.facts.map((fact) => {
    if (
      typeof fact !== "object" ||
      fact === null ||
      typeof (fact as Record<string, unknown>).claim !== "string" ||
      typeof (fact as Record<string, unknown>).sourceUrl !== "string"
    ) {
      throw new Error("Producer output contains an invalid fact");
    }
    return fact as { claim: string; sourceUrl: string };
  });

  return {
    narrative: draft.narrative.trim(),
    context: draft.context.trim(),
    facts,
    caption: draft.caption.trim(),
    image_prompt: draft.image_prompt.trim(),
  };
}

export async function producerNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  if (!state.scoutBrief) {
    return { errorLog: ["[producer] No scout brief was available"] };
  }

  const selectedUrls = new Set(state.scoutBrief.selectedArticleUrls);
  const articles = state.filteredArticles
    .filter((article) => selectedUrls.has(article.url))
    .map((article) => ({
      title: article.title,
      source: article.source,
      url: article.url,
      bodyText: article.bodyText.slice(0, 8_000),
    }));
  const isRevision = Boolean(state.revisionFeedback);

  console.log(
    `[producer] ${isRevision ? "Revising" : "Creating"} post from ${articles.length} article(s)`
  );

  try {
    const response = await callLlmJson(
      loadPrompt("producer.v1.md"),
      JSON.stringify({
        scoutBrief: state.scoutBrief,
        articles,
        revisionFeedback: state.revisionFeedback,
      }),
      {
        model: process.env.LLM_PRODUCER_MODEL,
        schemaName: "producer_draft",
        schema: PRODUCER_SCHEMA,
      }
    );

    const draft = parseProducerDraft(response);
    const suppliedUrls = [...selectedUrls];
    const facts = draft.facts.map((fact) => ({
      ...fact,
      sourceUrl: mapToSuppliedUrl(fact.sourceUrl, suppliedUrls),
    }));
    if (facts.some((fact) => fact.sourceUrl === null)) {
      throw new Error("Producer cited a URL that the Scout did not select");
    }

    const producerValidationIssues = [
      ...validateCaption(
        draft.caption,
        articles.map((article) => article.bodyText)
      ),
      ...validateImagePrompt(draft.image_prompt),
    ];
    const nextRevisionCount = isRevision
      ? state.revisionCount + 1
      : state.revisionCount;

    console.log(`[producer] Drafted caption (${draft.caption.length} chars)`);
    if (producerValidationIssues.length > 0) {
      console.warn(
        `[producer] ${producerValidationIssues.length} deterministic validation issue(s)`
      );
    }

    return {
      editorialBrief: {
        narrative: draft.narrative,
        facts: facts as Array<{ claim: string; sourceUrl: string }>,
        context: draft.context,
      },
      draftCaption: draft.caption,
      imagePrompt: draft.image_prompt,
      producerValidationIssues,
      factCheckStatus: "PENDING",
      factCheckIssues: [],
      factCheckClaims: [],
      revisionFeedback:
        producerValidationIssues.length > 0
          ? producerValidationIssues.join(" ")
          : null,
      revisionCount: nextRevisionCount,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[producer] Failed: ${msg}`);
    return {
      editorialBrief: null,
      draftCaption: null,
      imagePrompt: null,
      producerValidationIssues: [],
      errorLog: [`[producer] ${msg}`],
    };
  }
}
