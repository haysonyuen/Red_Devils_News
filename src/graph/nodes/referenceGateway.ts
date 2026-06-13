import { interrupt } from "@langchain/langgraph";
import { WebClient } from "@slack/web-api";
import { PipelineState } from "../state";
import { ReferenceResolution } from "../../references/coordinator";
import { getReferenceCoordinator } from "../../references/runtime";
import { buildReferenceRequestBlocks } from "../../slack/blocks";
import {
  DiscoveryInput,
  discoverReferenceCandidates,
} from "../../references/discovery";
import { ReferenceCoordinator } from "../../references/coordinator";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

interface ReferenceGatewayDependencies {
  coordinator: ReferenceCoordinator;
  discover: (input: DiscoveryInput) => ReturnType<
    typeof discoverReferenceCandidates
  >;
  postMessage: (
    message: Record<string, unknown>
  ) => Promise<{ ts?: string }>;
}

export async function postReferenceRequestNode(
  state: PipelineState,
  dependencies: Partial<ReferenceGatewayDependencies> = {}
): Promise<Partial<PipelineState>> {
  if (!state.visualBrief || state.visualBrief.compositionMode === "CONCEPTUAL") {
    return { errorLog: ["[referenceGateway] People-based visual brief required"] };
  }

  const coordinator =
    dependencies.coordinator ?? getReferenceCoordinator();
  const discover =
    dependencies.discover ?? discoverReferenceCandidates;
  const postMessage: ReferenceGatewayDependencies["postMessage"] =
    dependencies.postMessage ??
    (async (message: Record<string, unknown>) => {
      if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID) {
        return {};
      }
      const response = await slack.chat.postMessage(message as never);
      return { ts: response.ts };
    });
  let requests = coordinator.requestsForRun(state.runId);
  if (requests.length === 0) {
    requests = coordinator.createRequests(
      state.runId,
      state.runId,
      state.visualBrief
    );
  }
  const shouldPost = requests.every(
    (request) => request.threadTs === state.runId
  );

  for (const request of requests) {
    if (coordinator.candidatesForRun(state.runId).some(
      (candidate) => candidate.requestId === request.id
    )) {
      continue;
    }
    const candidates = await discover({
      requestId: request.id,
      person: request.person,
      selectedArticleUrls: state.scoutBrief?.selectedArticleUrls ?? [],
    });
    coordinator.attachCandidates(request.id, candidates);
  }

  requests = coordinator.requestsForRun(state.runId);
  const candidates = coordinator.candidatesForRun(state.runId);
  if (shouldPost) {
    const response = await postMessage({
      channel: process.env.SLACK_CHANNEL_ID ?? "",
      text: "Reference approval required",
      blocks: buildReferenceRequestBlocks(state, requests, candidates),
    });
    if (response.ts) {
      coordinator.updateThread(state.runId, response.ts);
      requests = coordinator.requestsForRun(state.runId);
    }
  }

  return {
    referenceRequests: requests,
    referenceCandidates: candidates,
  };
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
      referenceCandidates: coordinator.candidatesForRun(state.runId),
      visualBrief: {
        ...state.visualBrief,
        primaryCharacter: null,
        secondaryCharacters: [],
        compositionMode: "CONCEPTUAL",
        referenceRequirements: [],
      },
    };
  }

  return {
    referenceRequests: coordinator.requestsForRun(state.runId),
    referenceCandidates: coordinator.candidatesForRun(state.runId),
  };
}
