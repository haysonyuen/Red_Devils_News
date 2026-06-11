import { ProducerDecision, ProducerOutput } from "../contracts";
import { PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { validateCaption } from "../../validation/caption";
import { mapToSuppliedUrl } from "../../validation/url";

const PRODUCER_DECISIONS: ProducerDecision[] = [
  "ACCEPT",
  "REJECT_AND_RESCOUT",
  "REJECT_AND_END",
];

const PRODUCER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "decisionReason",
    "angle",
    "facts",
    "supporterOpinion",
    "caption",
    "headlineOptions",
  ],
  properties: {
    decision: { type: "string", enum: PRODUCER_DECISIONS },
    decisionReason: { type: "string" },
    angle: { type: ["string", "null"] },
    facts: {
      type: "array",
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
    supporterOpinion: { type: ["string", "null"] },
    caption: { type: ["string", "null"] },
    headlineOptions: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
    },
  },
};

const PRODUCER_OUTPUT_KEYS = [
  "decision",
  "decisionReason",
  "angle",
  "facts",
  "supporterOpinion",
  "caption",
  "headlineOptions",
].sort();

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === expected.join("\0");
}

function parseNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Producer output has invalid ${fieldName}`);
  }
  return value.trim();
}

export function parseProducerOutput(value: unknown): ProducerOutput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Producer output is not an object");
  }

  const output = value as Record<string, unknown>;
  if (!hasExactKeys(output, PRODUCER_OUTPUT_KEYS)) {
    throw new Error("Producer output has unexpected or missing fields");
  }
  if (!PRODUCER_DECISIONS.includes(output.decision as ProducerDecision)) {
    throw new Error("Producer output has an invalid decision");
  }
  if (
    typeof output.decisionReason !== "string" ||
    output.decisionReason.trim().length === 0
  ) {
    throw new Error("Producer output requires a concrete decisionReason");
  }
  if (!Array.isArray(output.facts)) {
    throw new Error("Producer output has invalid facts");
  }

  const facts = output.facts.map((fact) => {
    if (
      typeof fact !== "object" ||
      fact === null ||
      !hasExactKeys(fact as Record<string, unknown>, ["claim", "sourceUrl"]) ||
      typeof (fact as Record<string, unknown>).claim !== "string" ||
      (fact as Record<string, string>).claim.trim().length === 0 ||
      typeof (fact as Record<string, unknown>).sourceUrl !== "string" ||
      (fact as Record<string, string>).sourceUrl.trim().length === 0
    ) {
      throw new Error("Producer output contains an invalid fact");
    }
    return {
      claim: (fact as Record<string, string>).claim.trim(),
      sourceUrl: (fact as Record<string, string>).sourceUrl.trim(),
    };
  });

  if (
    !Array.isArray(output.headlineOptions) ||
    output.headlineOptions.some(
      (headline) => typeof headline !== "string" || headline.trim().length === 0
    )
  ) {
    throw new Error("Producer output has invalid headlineOptions");
  }

  const decision = output.decision as ProducerDecision;
  const angle = parseNullableString(output.angle, "angle");
  const supporterOpinion = parseNullableString(
    output.supporterOpinion,
    "supporterOpinion"
  );
  const caption = parseNullableString(output.caption, "caption");
  const headlineOptions = output.headlineOptions.map((headline) =>
    (headline as string).trim()
  );

  if (decision === "ACCEPT") {
    if (
      angle === null ||
      supporterOpinion === null ||
      caption === null ||
      facts.length === 0 ||
      headlineOptions.length < 1 ||
      headlineOptions.length > 3
    ) {
      throw new Error("Producer ACCEPT output is incomplete");
    }
  } else if (
    angle !== null ||
    supporterOpinion !== null ||
    caption !== null ||
    facts.length !== 0 ||
    headlineOptions.length !== 0
  ) {
    throw new Error("Producer rejection output is contradictory");
  }

  return {
    decision,
    decisionReason: output.decisionReason.trim(),
    angle,
    facts,
    supporterOpinion,
    caption,
    headlineOptions,
  };
}

export function buildAcceptedProducerUpdate(
  state: PipelineState,
  producerDecision: ProducerOutput,
  producerValidationIssues: string[]
): Partial<PipelineState> {
  const isRevision = state.revisionFeedback !== null;

  return {
    producerDecision,
    draftCaption: producerDecision.caption,
    producerValidationIssues,
    factCheckStatus: "PENDING",
    factCheckIssues: [],
    factCheckClaims: [],
    revisionFeedback:
      producerValidationIssues.length > 0
        ? producerValidationIssues.join(" ")
        : null,
    revisionCount: isRevision
      ? state.revisionCount + 1
      : state.revisionCount,
  };
}

export function buildProducerRejectionUpdate(
  state: PipelineState,
  producerDecision: ProducerOutput
): Partial<PipelineState> {
  const update: Partial<PipelineState> = {
    producerDecision,
    producerRejectionCount: state.producerRejectionCount + 1,
    rejectedStoryUrls: [
      ...new Set([
        ...state.rejectedStoryUrls,
        ...(state.storySelection?.supportingSourceUrls ?? []),
      ]),
    ],
    draftCaption: null,
    producerValidationIssues: [],
  };

  if (producerDecision.decision !== "REJECT_AND_RESCOUT") {
    return update;
  }

  return {
    ...update,
    storySelection: null,
    scoutBrief: null,
    factCheck: null,
    visualBrief: null,
    referenceRequests: [],
    referenceApprovals: [],
    generationRequest: null,
    generatedCandidates: [],
    selectedCandidate: null,
    visualEvaluation: null,
    visualRegenerationCount: 0,
    editorialBrief: null,
    imagePrompt: null,
    factCheckStatus: "PENDING",
    factCheckIssues: [],
    factCheckClaims: [],
    revisionFeedback: null,
    revisionCount: 0,
    generatedImageUrl: null,
    approvalStatus: "PENDING",
    publishStatus: "UNPUBLISHED",
  };
}

export async function producerNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  if (!state.storySelection || state.storySelection.decision !== "SELECT") {
    return {
      producerDecision: null,
      draftCaption: null,
      producerValidationIssues: [],
      errorLog: ["[producer] No selected story was available"],
    };
  }

  const selectedUrls = state.storySelection.supportingSourceUrls;
  const articles = state.filteredArticles
    .filter((article) => mapToSuppliedUrl(article.url, selectedUrls) !== null)
    .map((article) => ({
      title: article.title,
      source: article.source,
      url: article.url,
      bodyText: article.bodyText.slice(0, 8_000),
    }));

  console.log(`[producer] Reviewing ${articles.length} selected article(s)`);

  try {
    const response = await callLlmJson(
      loadPrompt("producer.v2.md"),
      JSON.stringify({
        storySelection: state.storySelection,
        articles,
        revisionFeedback: state.revisionFeedback,
      }),
      {
        model: process.env.LLM_PRODUCER_MODEL,
        schemaName: "producer_output",
        schema: PRODUCER_SCHEMA,
      }
    );

    const parsed = parseProducerOutput(response);
    const facts = parsed.facts.map((fact) => {
      const sourceUrl = mapToSuppliedUrl(fact.sourceUrl, selectedUrls);
      if (!sourceUrl) {
        throw new Error("Producer cited a URL that the Scout did not select");
      }
      return { ...fact, sourceUrl };
    });
    const producerDecision = { ...parsed, facts };

    if (producerDecision.decision !== "ACCEPT") {
      return buildProducerRejectionUpdate(state, producerDecision);
    }

    const producerValidationIssues = validateCaption(
      producerDecision.caption as string,
      articles.map((article) => article.bodyText)
    );

    return buildAcceptedProducerUpdate(
      state,
      producerDecision,
      producerValidationIssues
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[producer] Failed: ${msg}`);
    return {
      producerDecision: null,
      draftCaption: null,
      producerValidationIssues: [],
      errorLog: [`[producer] ${msg}`],
    };
  }
}
