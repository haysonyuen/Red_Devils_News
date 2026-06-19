import { StateGraph, END, START } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { PipelineStateAnnotation } from "./state";
import { ingestNode } from "./nodes/ingest";
import { scoutNode } from "./nodes/scout";
import { producerNode } from "./nodes/producer";
import { factCheckerNode } from "./nodes/factChecker";
import {
  visualBriefNode,
  visualEvaluationNode,
} from "./nodes/visualProducer";
import {
  postReferenceRequestNode,
  waitForReferencesNode,
} from "./nodes/referenceGateway";
import { imageGenNode } from "./nodes/imageGen";
import {
  postCandidateSelectionNode,
  postFinalApprovalNode,
  waitForCandidateSelectionNode,
  waitForFinalApprovalNode,
} from "./nodes/slackGateway";
import { publishNode } from "./nodes/publish";

function routeAfterIngest(
  state: typeof PipelineStateAnnotation.State
): "scout" | "__end__" {
  return state.filteredArticles.length > 0 ? "scout" : "__end__";
}

export function routeAfterScout(
  state: typeof PipelineStateAnnotation.State
): "producer" | "__end__" {
  return state.storySelection?.decision === "SELECT" ? "producer" : "__end__";
}

export function routeAfterProducer(
  state: typeof PipelineStateAnnotation.State
): "scout" | "factChecker" | "__end__" {
  const decision = state.producerDecision;
  if (!decision) return "__end__";

  if (decision.decision === "REJECT_AND_RESCOUT") {
    return state.producerRejectionCount === 1 ? "scout" : "__end__";
  }
  if (decision.decision === "REJECT_AND_END") {
    return "__end__";
  }
  return state.draftCaption &&
    decision.facts.length > 0 &&
    state.producerValidationIssues.length === 0
    ? "factChecker"
    : "__end__";
}

export function routeAfterFactCheck(
  state: typeof PipelineStateAnnotation.State
): "producer" | "createVisualBrief" | "imageGen" | "__end__" {
  if (state.factCheck?.status === "PASS") return "createVisualBrief";
  const status = state.factCheck?.status ?? state.factCheckStatus;
  // Preserve the legacy status-only path while grouped fact checks migrate.
  if (!state.factCheck && status === "PASS") return "imageGen";
  if (status === "REVISE" && state.revisionCount < 1) {
    return "producer";
  }
  return "__end__";
}

export function routeAfterVisualBrief(
  state: typeof PipelineStateAnnotation.State
): "imageGen" | "referenceGateway" | "__end__" {
  if (state.visualBrief?.compositionMode === "CONCEPTUAL") {
    return "imageGen";
  }
  return state.visualBrief ? "referenceGateway" : "__end__";
}

export function routeAfterReferences(
  state: typeof PipelineStateAnnotation.State
): "imageGen" | "__end__" {
  if (state.visualBrief?.compositionMode === "CONCEPTUAL") return "imageGen";
  const pending = state.referenceRequests.some((request) =>
    ["AWAITING_CANDIDATE", "AWAITING_DECISION"].includes(request.status)
  );
  const primaryApproved = state.referenceRequests.some(
    (request) => request.role === "PRIMARY" && request.status === "APPROVED"
  );
  return !pending && primaryApproved ? "imageGen" : "__end__";
}

export function routeAfterImage(
  state: typeof PipelineStateAnnotation.State
): "evaluateVisuals" | "__end__" {
  return state.generatedCandidates.length > 0 ? "evaluateVisuals" : "__end__";
}

export function routeAfterVisualEvaluation(
  state: typeof PipelineStateAnnotation.State
): "candidateSelection" | "imageGen" | "__end__" {
  if (state.generatedCandidates.some((candidate) => candidate.qualified)) {
    return "candidateSelection";
  }
  return state.visualRegenerationCount < 3 ? "imageGen" : "__end__";
}

export function routeAfterCandidateSelection(
  state: typeof PipelineStateAnnotation.State
): "postFinalApproval" | "imageGen" | "__end__" {
  if (state.selectedCandidate) return "postFinalApproval";
  if (state.approvalStatus === "REJECTED") return "__end__";
  return state.visualRegenerationCount > 0 ? "imageGen" : "__end__";
}

// ── Route after Slack gateway ─────────────────────────────────────────────────
function routeAfterApproval(
  state: typeof PipelineStateAnnotation.State
): "publish" | "__end__" {
  if (state.approvalStatus === "APPROVED") return "publish";
  return "__end__";
}

// ── Build and export the compiled graph ──────────────────────────────────────
export function buildPipeline(checkpointer: SqliteSaver) {
  const graph = new StateGraph(PipelineStateAnnotation)
    .addNode("ingest", (state) => ingestNode(state))
    .addNode("scout", scoutNode)
    .addNode("producer", producerNode)
    .addNode("factChecker", factCheckerNode)
    .addNode("createVisualBrief", visualBriefNode)
    .addNode("postReferenceRequest", (state) =>
      postReferenceRequestNode(state)
    )
    .addNode("waitForReferences", waitForReferencesNode)
    .addNode("imageGen", imageGenNode)
    .addNode("evaluateVisuals", visualEvaluationNode)
    .addNode("postCandidates", (state) => postCandidateSelectionNode(state))
    .addNode("waitForCandidateSelection", waitForCandidateSelectionNode)
    .addNode("postFinalApproval", (state) => postFinalApprovalNode(state))
    .addNode("waitForFinalApproval", waitForFinalApprovalNode)
    .addNode("publish", (state) => publishNode(state))

    .addEdge(START, "ingest")
    .addConditionalEdges("ingest", routeAfterIngest, {
      scout: "scout",
      __end__: END,
    })
    .addConditionalEdges("scout", routeAfterScout, {
      producer: "producer",
      __end__: END,
    })
    .addConditionalEdges("producer", routeAfterProducer, {
      scout: "scout",
      factChecker: "factChecker",
      __end__: END,
    })
    .addConditionalEdges("factChecker", routeAfterFactCheck, {
      producer: "producer",
      createVisualBrief: "createVisualBrief",
      imageGen: "imageGen",
      __end__: END,
    })
    .addConditionalEdges("createVisualBrief", routeAfterVisualBrief, {
      imageGen: "imageGen",
      referenceGateway: "postReferenceRequest",
      __end__: END,
    })
    .addEdge("postReferenceRequest", "waitForReferences")
    .addConditionalEdges("waitForReferences", routeAfterReferences, {
      imageGen: "imageGen",
      __end__: END,
    })
    .addConditionalEdges("imageGen", routeAfterImage, {
      evaluateVisuals: "evaluateVisuals",
      __end__: END,
    })
    .addConditionalEdges("evaluateVisuals", routeAfterVisualEvaluation, {
      candidateSelection: "postCandidates",
      imageGen: "imageGen",
      __end__: END,
    })
    .addEdge("postCandidates", "waitForCandidateSelection")
    .addConditionalEdges("waitForCandidateSelection", routeAfterCandidateSelection, {
      postFinalApproval: "postFinalApproval",
      imageGen: "imageGen",
      __end__: END,
    })
    .addEdge("postFinalApproval", "waitForFinalApproval")
    .addConditionalEdges("waitForFinalApproval", routeAfterApproval, {
      publish: "publish",
      __end__: END,
    })
    .addEdge("publish", END);

  return graph.compile({ checkpointer, interruptBefore: [] });
}
