import { ClaimCheck, PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { mapToSuppliedUrl } from "../../validation/url";

interface FactCheckResult {
  status: "PASS" | "REVISE" | "REJECT";
  claim_checks: ClaimCheck[];
  issues: string[];
  revision_feedback: string | null;
}

const FACT_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "claim_checks", "issues", "revision_feedback"],
  properties: {
    status: { type: "string", enum: ["PASS", "REVISE", "REJECT"] },
    claim_checks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "verdict", "evidence", "sourceUrl"],
        properties: {
          claim: { type: "string" },
          verdict: {
            type: "string",
            enum: ["SUPPORTED", "UNSUPPORTED", "OPINION"],
          },
          evidence: { type: "string" },
          sourceUrl: { type: ["string", "null"] },
        },
      },
    },
    issues: {
      type: "array",
      items: { type: "string" },
    },
    revision_feedback: { type: ["string", "null"] },
  },
};

export function parseFactCheckResult(value: unknown): FactCheckResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Fact checker output is not an object");
  }

  const result = value as Record<string, unknown>;
  if (
    !["PASS", "REVISE", "REJECT"].includes(String(result.status)) ||
    !Array.isArray(result.claim_checks) ||
    result.claim_checks.length === 0 ||
    !Array.isArray(result.issues) ||
    !result.issues.every((issue) => typeof issue === "string") ||
    !(
      typeof result.revision_feedback === "string" ||
      result.revision_feedback === null
    )
  ) {
    throw new Error("Fact checker output is invalid");
  }

  const claimChecks = result.claim_checks.map((check) => {
    if (
      typeof check !== "object" ||
      check === null ||
      typeof (check as Record<string, unknown>).claim !== "string" ||
      !["SUPPORTED", "UNSUPPORTED", "OPINION"].includes(
        String((check as Record<string, unknown>).verdict)
      ) ||
      typeof (check as Record<string, unknown>).evidence !== "string" ||
      !(
        typeof (check as Record<string, unknown>).sourceUrl === "string" ||
        (check as Record<string, unknown>).sourceUrl === null
      )
    ) {
      throw new Error("Fact checker output contains an invalid claim check");
    }
    return check as ClaimCheck;
  });

  return {
    status: result.status as FactCheckResult["status"],
    claim_checks: claimChecks,
    issues: result.issues as string[],
    revision_feedback: result.revision_feedback as string | null,
  };
}

export function prepareFactCheckerHandoff(state: PipelineState): {
  evidence: Array<{
    title: string;
    url: string;
    bodyText: string;
  }>;
  producerDecision: NonNullable<PipelineState["producerDecision"]>;
  caption: string;
} | null {
  if (
    state.storySelection?.decision !== "SELECT" ||
    state.producerDecision?.decision !== "ACCEPT" ||
    !state.draftCaption
  ) {
    return null;
  }

  const selectedUrls = state.storySelection.supportingSourceUrls;
  const evidence = state.filteredArticles
    .filter(
      (article) => mapToSuppliedUrl(article.url, selectedUrls) !== null
    )
    .map((article) => ({
      title: article.title,
      url: article.url,
      bodyText: article.bodyText.slice(0, 8_000),
    }));

  return {
    evidence,
    producerDecision: state.producerDecision,
    caption: state.draftCaption,
  };
}

export async function factCheckerNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const handoff = prepareFactCheckerHandoff(state);
  if (!handoff) {
    return {
      factCheckStatus: "REJECT",
      errorLog: ["[factChecker] Draft state was incomplete"],
    };
  }

  console.log(`[factChecker] Auditing draft, revision=${state.revisionCount}`);

  try {
    const response = await callLlmJson(
      loadPrompt("fact-checker.v1.md"),
      JSON.stringify({
        evidence: handoff.evidence,
        producerDecision: handoff.producerDecision,
        caption: handoff.caption,
      }),
      {
        model: process.env.LLM_FACT_CHECKER_MODEL,
        schemaName: "fact_check_result",
        schema: FACT_CHECK_SCHEMA,
      }
    );

    const result = parseFactCheckResult(response);
    const suppliedUrls = handoff.evidence.map((article) => article.url);
    const claimChecks = result.claim_checks.map((check) => ({
      ...check,
      sourceUrl:
        check.sourceUrl === null
          ? null
          : mapToSuppliedUrl(check.sourceUrl, suppliedUrls),
    }));
    if (claimChecks.some(
      (check) => check.verdict === "SUPPORTED" && !check.sourceUrl
    )) {
      throw new Error("Fact checker cited an unknown source URL");
    }

    const hasUnsupportedClaim = result.claim_checks.some(
      (check) => check.verdict === "UNSUPPORTED"
    );
    const requestedStatus =
      result.status === "PASS" && hasUnsupportedClaim ? "REVISE" : result.status;
    const status =
      requestedStatus === "REVISE" && state.revisionCount >= 1
        ? "REJECT"
        : requestedStatus;

    console.log(`[factChecker] Result: ${status}`);
    return {
      factCheckStatus: status,
      factCheckIssues: result.issues,
      factCheckClaims: claimChecks,
      revisionFeedback:
        status === "REVISE"
          ? result.revision_feedback || result.issues.join(" ")
          : null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[factChecker] Failed: ${msg}`);
    return {
      factCheckStatus: "REJECT",
      factCheckIssues: [msg],
      factCheckClaims: [],
      revisionFeedback: null,
      errorLog: [`[factChecker] ${msg}`],
    };
  }
}
