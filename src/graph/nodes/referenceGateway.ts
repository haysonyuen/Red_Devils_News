import { interrupt } from "@langchain/langgraph";
import { WebClient } from "@slack/web-api";
import { PipelineState } from "../state";
import { ReferenceResolution } from "../../references/coordinator";
import { getReferenceCoordinator } from "../../references/runtime";
import { buildReferenceRequestBlocks } from "../../slack/blocks";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function postReferenceRequestNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  if (!state.visualBrief || state.visualBrief.compositionMode === "CONCEPTUAL") {
    return { errorLog: ["[referenceGateway] People-based visual brief required"] };
  }

  const coordinator = getReferenceCoordinator();
  let requests = coordinator.requestsForRun(state.runId);
  if (requests.length === 0) {
    requests = coordinator.createRequests(
      state.runId,
      state.runId,
      state.visualBrief
    );
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
      const response = await slack.chat.postMessage({
        channel: process.env.SLACK_CHANNEL_ID,
        text: "Reference approval required",
        blocks: buildReferenceRequestBlocks(
          state.runId,
          state.visualBrief,
          requests
        ),
      });
      if (!response.ts) {
        throw new Error("Slack returned no reference thread timestamp");
      }
      coordinator.updateThread(state.runId, response.ts);
      requests = coordinator.requestsForRun(state.runId);
    }
  }

  return { referenceRequests: requests };
}

export function waitForReferencesNode(
  state: PipelineState
): Partial<PipelineState> {
  if (!state.visualBrief || state.visualBrief.compositionMode === "CONCEPTUAL") {
    return { errorLog: ["[referenceGateway] People-based visual brief required"] };
  }

  const coordinator = getReferenceCoordinator();
  const resumed = interrupt({
    stage: "REFERENCE_APPROVAL",
    runId: state.runId,
  }) as {
    stage: "REFERENCE_RESOLUTION" | "REFERENCE_TIMEOUT";
    resolution: ReferenceResolution;
  };
  const resolution = resumed.resolution;

  if (resolution.fallbackToConceptual) {
    return {
      referenceRequests: coordinator.requestsForRun(state.runId),
      visualBrief: {
        ...state.visualBrief,
        primaryCharacter: null,
        secondaryCharacters: [],
        compositionMode: "CONCEPTUAL",
        referenceRequirements: [],
      },
      imagePrompt: state.visualBrief.conceptualFallbackPrompt,
    };
  }

  return {
    referenceRequests: coordinator.requestsForRun(state.runId),
  };
}
