import { StateGraph, END, START } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { PipelineStateAnnotation } from "./state";
import { ingestNode } from "./nodes/ingest";
import { scoutNode } from "./nodes/scout";
import { producerNode } from "./nodes/producer";
import { factCheckerNode } from "./nodes/factChecker";
import { visualBriefNode } from "./nodes/visualProducer";
import { imageGenNode } from "./nodes/imageGen";
import { slackGatewayNode } from "./nodes/slackGateway";
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
): "producer" | "visualBrief" | "imageGen" | "__end__" {
  if (state.factCheck?.status === "PASS") return "visualBrief";
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
): "imageGen" | "__end__" {
  if (state.visualBrief?.compositionMode === "CONCEPTUAL") {
    return "imageGen";
  }
  // Task 6 replaces this end with the reference request stage.
  return "__end__";
}

export function routeAfterImage(
  state: typeof PipelineStateAnnotation.State
): "slackGateway" | "__end__" {
  return state.generatedImageUrl ? "slackGateway" : "__end__";
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
    .addNode("ingest", ingestNode)
    .addNode("scout", scoutNode)
    .addNode("producer", producerNode)
    .addNode("factChecker", factCheckerNode)
    .addNode("visualBrief", visualBriefNode)
    .addNode("imageGen", imageGenNode)
    .addNode("slackGateway", slackGatewayNode)
    .addNode("publish", publishNode)

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
      visualBrief: "visualBrief",
      imageGen: "imageGen",
      __end__: END,
    })
    .addConditionalEdges("visualBrief", routeAfterVisualBrief, {
      imageGen: "imageGen",
      __end__: END,
    })
    .addConditionalEdges("imageGen", routeAfterImage, {
      slackGateway: "slackGateway",
      __end__: END,
    })
    .addConditionalEdges("slackGateway", routeAfterApproval, {
      publish: "publish",
      __end__: END,
    })
    .addEdge("publish", END);

  return graph.compile({ checkpointer, interruptBefore: [] });
}
