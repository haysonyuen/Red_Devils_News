import { WebClient } from "@slack/web-api";
import { interrupt } from "@langchain/langgraph";
import { PipelineState } from "../state";
import {
  buildCandidateSelectionBlocks,
  buildFinalApprovalBlocks,
} from "../../slack/blocks";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "";

interface SlackNodeDependencies {
  postMessage: (message: Record<string, unknown>) => Promise<void>;
}

type CandidateDecision = {
  stage: "CANDIDATE_SELECTION";
  entity_id: string;
  action: "SELECT" | "REGENERATE" | "REJECT";
};

const defaultDependencies: SlackNodeDependencies = {
  postMessage: async (message) => {
    if (!process.env.SLACK_BOT_TOKEN) {
      console.warn(
        "[slackGateway] SLACK_BOT_TOKEN not set — skipping Slack post (dev mode)"
      );
      return;
    }
    await slack.chat.postMessage(message as never);
  },
};

export async function postCandidateSelectionNode(
  state: PipelineState,
  dependencies: SlackNodeDependencies = defaultDependencies
): Promise<Partial<PipelineState>> {
  const qualified = state.generatedCandidates.filter(
    (candidate) => candidate.qualified
  );
  if (qualified.length === 0) {
    return { errorLog: ["[candidateSelection] No qualified candidates"] };
  }
  await dependencies.postMessage({
    channel: CHANNEL_ID,
    text: "Select an Instagram image candidate",
    blocks: buildCandidateSelectionBlocks(state.runId, qualified),
  });
  return {};
}

export function applyCandidateDecision(
  state: PipelineState,
  decision: CandidateDecision
): Partial<PipelineState> {
  const qualified = state.generatedCandidates.filter(
    (candidate) => candidate.qualified
  );
  if (decision.action === "SELECT") {
    const selectedCandidate = qualified.find(
      (candidate) => candidate.id === decision.entity_id
    );
    if (!selectedCandidate) {
      return { errorLog: ["[candidateSelection] Unknown candidate selected"] };
    }
    return { selectedCandidate };
  }
  if (decision.action === "REGENERATE") {
    const visualRegenerationCount = state.visualRegenerationCount + 1;
    const visualBrief = state.visualBrief;
    if (
      visualRegenerationCount >= 2 &&
      visualBrief &&
      visualBrief.compositionMode !== "CONCEPTUAL"
    ) {
      return {
        selectedCandidate: null,
        visualRegenerationCount,
        visualBrief: {
          ...visualBrief,
          primaryCharacter: null,
          secondaryCharacters: [],
          compositionMode: "CONCEPTUAL",
          referenceRequirements: [],
        },
        imagePrompt: visualBrief.conceptualFallbackPrompt,
      };
    }
    return { selectedCandidate: null, visualRegenerationCount };
  }
  return { selectedCandidate: null, approvalStatus: "REJECTED" };
}

export function waitForCandidateSelectionNode(
  state: PipelineState
): Partial<PipelineState> {
  const decision = interrupt({
    stage: "CANDIDATE_SELECTION",
    runId: state.runId,
  }) as CandidateDecision;
  return applyCandidateDecision(state, decision);
}

export async function postFinalApprovalNode(
  state: PipelineState,
  dependencies: SlackNodeDependencies = defaultDependencies
): Promise<Partial<PipelineState>> {
  if (!state.selectedCandidate) {
    return { errorLog: ["[finalApproval] No selected candidate"] };
  }
  try {
    await dependencies.postMessage({
      channel: CHANNEL_ID,
      blocks: buildFinalApprovalBlocks(
        state.runId,
        state.selectedCandidate,
        state
      ),
      text: "Man Utd pipeline approval needed",
    });
    console.log(`[slackGateway] ✔ Approval card posted to Slack channel`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[slackGateway] ✖ Slack post failed: ${msg}`);
      return { errorLog: [`[slackGateway] Slack post failed: ${msg}`] };
  }
  return {};
}

export function applyFinalApprovalDecision(
  decision: "APPROVED" | "REJECTED"
): Partial<PipelineState> {
  return { approvalStatus: decision };
}

export function waitForFinalApprovalNode(): Partial<PipelineState> {
  const decision = interrupt("Waiting for Slack approval") as "APPROVED" | "REJECTED";
  console.log(`[slackGateway] ✔ Resumed with decision: ${decision}`);
  return applyFinalApprovalDecision(decision);
}
