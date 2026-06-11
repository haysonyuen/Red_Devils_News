import {
  ClaimCheck,
  FactCheckOutput,
  StoryStatus,
} from "../contracts";
import { PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { mapToSuppliedUrl } from "../../validation/url";

const FACT_CHECK_KEYS = [
  "status",
  "storyStatus",
  "claimChecks",
  "visualImplicationsAllowed",
  "visualImplicationsForbidden",
  "issues",
  "revisionFeedback",
] as const;
const CLAIM_CHECK_KEYS = [
  "claim",
  "verdict",
  "evidence",
  "sourceUrl",
] as const;
const STATUSES = ["PASS", "REVISE", "REJECT"] as const;
const STORY_STATUSES = [
  "CONFIRMED",
  "ADVANCED",
  "INTEREST",
  "SPECULATION",
] as const;
const VERDICTS = ["SUPPORTED", "UNSUPPORTED", "OPINION"] as const;

const FACT_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FACT_CHECK_KEYS],
  properties: {
    status: { type: "string", enum: [...STATUSES] },
    storyStatus: { type: "string", enum: [...STORY_STATUSES] },
    claimChecks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...CLAIM_CHECK_KEYS],
        properties: {
          claim: { type: "string", minLength: 1 },
          verdict: { type: "string", enum: [...VERDICTS] },
          evidence: { type: "string", minLength: 1 },
          sourceUrl: {
            anyOf: [
              { type: "string", minLength: 1 },
              { type: "null" },
            ],
          },
        },
      },
    },
    visualImplicationsAllowed: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    visualImplicationsForbidden: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    issues: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    revisionFeedback: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "null" },
      ],
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStringArray(
  value: unknown,
  field: string,
  allowEmpty: boolean
): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every(isNonEmptyString)
  ) {
    throw new Error(`Fact checker output has an invalid ${field}`);
  }
  return value;
}

function parseClaimCheck(value: unknown): ClaimCheck {
  if (!isRecord(value) || !hasExactKeys(value, CLAIM_CHECK_KEYS)) {
    throw new Error("Fact checker output contains an invalid claim check");
  }
  if (
    !isNonEmptyString(value.claim) ||
    !VERDICTS.includes(value.verdict as (typeof VERDICTS)[number]) ||
    !isNonEmptyString(value.evidence) ||
    !(
      value.sourceUrl === null ||
      isNonEmptyString(value.sourceUrl)
    )
  ) {
    throw new Error("Fact checker output contains an invalid claim check");
  }
  return {
    claim: value.claim,
    verdict: value.verdict as ClaimCheck["verdict"],
    evidence: value.evidence,
    sourceUrl: value.sourceUrl,
  };
}

export function parseFactCheckOutput(value: unknown): FactCheckOutput {
  if (!isRecord(value) || !hasExactKeys(value, FACT_CHECK_KEYS)) {
    throw new Error("Fact checker output must contain exactly the required keys");
  }
  if (
    !STATUSES.includes(value.status as (typeof STATUSES)[number]) ||
    !STORY_STATUSES.includes(
      value.storyStatus as (typeof STORY_STATUSES)[number]
    ) ||
    !Array.isArray(value.claimChecks) ||
    value.claimChecks.length === 0 ||
    !(
      value.revisionFeedback === null ||
      isNonEmptyString(value.revisionFeedback)
    )
  ) {
    throw new Error("Fact checker output is invalid");
  }

  return {
    status: value.status as FactCheckOutput["status"],
    storyStatus: value.storyStatus as StoryStatus,
    claimChecks: value.claimChecks.map(parseClaimCheck),
    visualImplicationsAllowed: parseStringArray(
      value.visualImplicationsAllowed,
      "visualImplicationsAllowed",
      false
    ),
    visualImplicationsForbidden: parseStringArray(
      value.visualImplicationsForbidden,
      "visualImplicationsForbidden",
      false
    ),
    issues: parseStringArray(value.issues, "issues", true),
    revisionFeedback: value.revisionFeedback,
  };
}

export function normalizeFactCheckOutput(
  output: FactCheckOutput,
  suppliedUrls: string[],
  revisionCount: number
): FactCheckOutput {
  const claimChecks = output.claimChecks.map((check) => {
    if (check.sourceUrl === null) {
      if (check.verdict === "SUPPORTED") {
        throw new Error("Supported claim is missing a selected evidence URL");
      }
      return check;
    }

    const sourceUrl = mapToSuppliedUrl(check.sourceUrl, suppliedUrls);
    if (!sourceUrl) {
      throw new Error("Fact checker cited an unknown source URL");
    }
    return { ...check, sourceUrl };
  });
  const requestedStatus =
    output.status === "PASS" &&
    claimChecks.some((check) => check.verdict === "UNSUPPORTED")
      ? "REVISE"
      : output.status;
  const status =
    requestedStatus === "REVISE" && revisionCount >= 1
      ? "REJECT"
      : requestedStatus;

  return { ...output, status, claimChecks };
}

export function prepareFactCheckerHandoff(state: PipelineState): {
  evidence: Array<{
    title: string;
    url: string;
    bodyText: string;
  }>;
  producerDecision: NonNullable<PipelineState["producerDecision"]>;
  caption: string;
  storyStatus: StoryStatus;
} | null {
  if (
    state.storySelection?.decision !== "SELECT" ||
    !state.storySelection.storyStatus ||
    state.producerDecision?.decision !== "ACCEPT" ||
    !state.draftCaption
  ) {
    return null;
  }

  const selectedUrls = state.storySelection.supportingSourceUrls;
  const evidence = state.filteredArticles
    .filter((article) => mapToSuppliedUrl(article.url, selectedUrls) !== null)
    .map((article) => ({
      title: article.title,
      url: article.url,
      bodyText: article.bodyText.slice(0, 8_000),
    }));

  return {
    evidence,
    producerDecision: state.producerDecision,
    caption: state.draftCaption,
    storyStatus: state.storySelection.storyStatus,
  };
}

function buildRejection(
  storyStatus: StoryStatus,
  message: string
): FactCheckOutput {
  return {
    status: "REJECT",
    storyStatus,
    claimChecks: [
      {
        claim: "The submitted story could not be fact checked",
        verdict: "UNSUPPORTED",
        evidence: message,
        sourceUrl: null,
      },
    ],
    visualImplicationsAllowed: ["No story-specific visual implication"],
    visualImplicationsForbidden: ["All unverified story implications"],
    issues: [message],
    revisionFeedback: null,
  };
}

function rejectionUpdate(
  storyStatus: StoryStatus | null,
  message: string
): Partial<PipelineState> {
  const factCheck = storyStatus ? buildRejection(storyStatus, message) : null;
  return {
    factCheck,
    factCheckStatus: "REJECT",
    factCheckIssues: [message],
    factCheckClaims: factCheck?.claimChecks ?? [],
    revisionFeedback: null,
    errorLog: [`[factChecker] ${message}`],
  };
}

export async function factCheckerNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const storyStatus = state.storySelection?.storyStatus ?? null;
  const handoff = prepareFactCheckerHandoff(state);
  if (!handoff) {
    return rejectionUpdate(storyStatus, "Draft state was incomplete");
  }

  console.log(`[factChecker] Auditing draft, revision=${state.revisionCount}`);

  try {
    const response = await callLlmJson(
      loadPrompt("fact-checker.v2.md"),
      JSON.stringify(handoff),
      {
        model: process.env.LLM_FACT_CHECKER_MODEL,
        schemaName: "fact_check_output",
        schema: FACT_CHECK_SCHEMA,
      }
    );
    const parsed = parseFactCheckOutput(response);
    const factCheck = normalizeFactCheckOutput(
      parsed,
      handoff.evidence.map((article) => article.url),
      state.revisionCount
    );

    console.log(`[factChecker] Result: ${factCheck.status}`);
    return {
      factCheck,
      factCheckStatus: factCheck.status,
      factCheckIssues: factCheck.issues,
      factCheckClaims: factCheck.claimChecks,
      revisionFeedback:
        factCheck.status === "REVISE"
          ? factCheck.revisionFeedback || factCheck.issues.join(" ")
          : null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[factChecker] Failed: ${message}`);
    return rejectionUpdate(storyStatus, message);
  }
}
