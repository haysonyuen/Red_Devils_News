import { KnownBlock } from "@slack/web-api";
import {
  GeneratedCandidate,
  ReferenceCandidate,
  ReferenceRequest,
} from "../graph/contracts";
import { PipelineState } from "../graph/state";

function actionValue(
  threadId: string,
  stage: string,
  entityId: string,
  action: string,
  fields: Record<string, string> = {}
): string {
  return JSON.stringify({
    thread_id: threadId,
    stage,
    entity_id: entityId,
    action,
    ...fields,
  });
}

export function buildReferenceRequestBlocks(
  state: PipelineState,
  requests: ReferenceRequest[],
  candidates: ReferenceCandidate[]
): KnownBlock[] {
  const selectedUrls = new Set(state.scoutBrief?.selectedArticleUrls ?? []);
  const sources = state.filteredArticles
    .filter((article) => selectedUrls.has(article.url))
    .map((article) => `• <${article.url}|${article.title}>`)
    .join("\n");
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Reference approval required" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Run:* \`${state.runId}\`\n*Visual hook:* ${state.visualBrief?.storyHook ?? ""}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Caption:*\n${state.draftCaption ?? ""}\n\n*Sources:*\n${sources || "_None_"}`,
      },
    },
  ];
  for (const request of requests) {
    const candidate = candidates.find(
      (item) => item.id === request.activeCandidateId
    );
    if (candidate) {
      blocks.push(
        ...buildReferenceCandidateBlocks(state.runId, request, candidate)
      );
    }
  }
  blocks.push(buildConceptualReferenceBlock(state.runId));
  return blocks;
}

export function buildReferenceCandidateBlocks(
  runId: string,
  request: ReferenceRequest,
  candidate: ReferenceCandidate
): KnownBlock[] {
  return [
    {
      type: "image",
      image_url: candidate.imageUrl,
      alt_text: `Reference candidate for ${request.person}`,
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${request.person}* (${request.role.toLowerCase()}) · option ${request.attempt}\n<${candidate.sourcePageUrl}|Open provenance page>`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve reference" },
          style: "primary",
          action_id: "reference_approve",
          value: actionValue(
            runId,
            "REFERENCE_DECISION",
            candidate.id,
            "APPROVED",
            {
              request_id: request.id,
              candidate_id: candidate.id,
            }
          ),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject & try next" },
          style: "danger",
          action_id: "reference_reject",
          value: actionValue(
            runId,
            "REFERENCE_DECISION",
            candidate.id,
            "REJECTED",
            {
              request_id: request.id,
              candidate_id: candidate.id,
            }
          ),
        },
      ],
    },
  ];
}

export function buildConceptualReferenceBlock(runId: string): KnownBlock {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Use conceptual artwork" },
        action_id: "reference_conceptual",
        value: actionValue(
          runId,
          "REFERENCE_DECISION",
          "all",
          "USE_CONCEPTUAL"
        ),
      },
    ],
  };
}

export function buildCandidateSelectionBlocks(
  runId: string,
  candidates: GeneratedCandidate[]
): KnownBlock[] {
  const blocks = candidates.flatMap((candidate) => [
    {
      type: "image",
      image_url: candidate.publicUrl,
      alt_text: `Generated candidate ${candidate.id}`,
    } as KnownBlock,
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Select candidate" },
          action_id: "candidate_select",
          value: actionValue(
            runId,
            "CANDIDATE_SELECTION",
            candidate.id,
            "SELECT"
          ),
        },
      ],
    } as KnownBlock,
  ]);
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Regenerate" },
        action_id: "candidate_regenerate",
        value: actionValue(runId, "CANDIDATE_SELECTION", "all", "REGENERATE"),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Reject" },
        style: "danger",
        action_id: "candidate_reject",
        value: actionValue(runId, "CANDIDATE_SELECTION", "all", "REJECT"),
      },
    ],
  } as KnownBlock);
  return blocks;
}

export function buildFinalApprovalBlocks(
  runId: string,
  selectedCandidate: GeneratedCandidate,
  state: PipelineState
): KnownBlock[] {
  const selectedUrls = new Set(state.scoutBrief?.selectedArticleUrls ?? []);
  const sources = state.filteredArticles
    .filter((article) => selectedUrls.has(article.url))
    .map((article) => `• <${article.url}|${article.title}>`)
    .join("\n");
  const scores = selectedCandidate.evaluation?.scores;
  const scoreSummary = scores
    ? `Story ${scores.storyAlignment} · Feed ${scores.feedImpact} · Composition ${scores.composition} · Caption ${scores.captionComplement} · Facts ${scores.factualIntegrity}`
    : "No visual scores";
  const warnings =
    selectedCandidate.evaluation?.warnings.join("; ") || "None";
  const referenceAudit =
    state.referenceApprovals.length > 0
      ? state.referenceApprovals
          .map((reference) => `${reference.person} (${reference.role.toLowerCase()})`)
          .join(", ")
      : "Conceptual image; no identity references used";
  return [
    {
      type: "image",
      image_url: selectedCandidate.publicUrl,
      alt_text: "Selected Instagram image",
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Caption:*\n${state.draftCaption ?? ""}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Sources:*\n${sources || "_None_"}\n\n*Fact check:* ${state.factCheck?.status ?? state.factCheckStatus} · ${state.factCheck?.issues.length ?? state.factCheckIssues.length} issue(s)\n*Visual:* ${scoreSummary}\n*Warnings:* ${warnings}\n*References:* ${referenceAudit}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve & Publish" },
          style: "primary",
          action_id: "pipeline_approve",
          value: actionValue(
            runId,
            "FINAL_APPROVAL",
            selectedCandidate.id,
            "APPROVED"
          ),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: "pipeline_reject",
          value: actionValue(
            runId,
            "FINAL_APPROVAL",
            selectedCandidate.id,
            "REJECTED"
          ),
        },
      ],
    },
  ];
}
