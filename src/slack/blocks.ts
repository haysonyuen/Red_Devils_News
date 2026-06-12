import { KnownBlock } from "@slack/web-api";
import {
  GeneratedCandidate,
  ReferenceRequest,
  VisualBrief,
} from "../graph/contracts";
import { PipelineState } from "../graph/state";

function actionValue(
  threadId: string,
  stage: string,
  entityId: string,
  action: string
): string {
  return JSON.stringify({
    thread_id: threadId,
    stage,
    entity_id: entityId,
    action,
  });
}

export function buildReferenceRequestBlocks(
  runId: string,
  brief: VisualBrief,
  requests: ReferenceRequest[]
): KnownBlock[] {
  const cast = requests
    .map(
      (request) =>
        `• *${request.person}* (${request.role.toLowerCase()}) — reply with the person's name, one image, and its source-page URL`
    )
    .join("\n");
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Reference approval required" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Run:* \`${runId}\`\n*Visual hook:* ${brief.storyHook}\n${cast}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Upload alone never approves a reference. Each upload receives separate approval buttons.",
        },
      ],
    },
  ];
}

export function buildReferenceDecisionBlocks(
  runId: string,
  request: ReferenceRequest
): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Reference received for *${request.person}*\nSource: <${request.sourcePageUrl}|open source page>`,
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
            request.id,
            "APPROVED"
          ),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject reference" },
          style: "danger",
          action_id: "reference_reject",
          value: actionValue(
            runId,
            "REFERENCE_DECISION",
            request.id,
            "REJECTED"
          ),
        },
      ],
    },
  ];
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
