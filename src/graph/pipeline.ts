import { StateGraph, END, START } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { PipelineStateAnnotation } from "./state";
import { ingestNode } from "./nodes/ingest";
import { scoutNode } from "./nodes/scout";
import { producerNode } from "./nodes/producer";
import { factCheckerNode } from "./nodes/factChecker";
import { imageGenNode } from "./nodes/imageGen";
import { slackGatewayNode } from "./nodes/slackGateway";
import { publishNode } from "./nodes/publish";

function routeAfterIngest(
  state: typeof PipelineStateAnnotation.State
): "scout" | "__end__" {
  return state.filteredArticles.length > 0 ? "scout" : "__end__";
}

function routeAfterScout(
  state: typeof PipelineStateAnnotation.State
): "producer" | "__end__" {
  return state.scoutBrief ? "producer" : "__end__";
}

export function routeAfterProducer(
  state: typeof PipelineStateAnnotation.State
): "producer" | "factChecker" | "__end__" {
  if (!state.editorialBrief || !state.draftCaption || !state.imagePrompt) {
    return "__end__";
  }
  if (state.producerValidationIssues.length > 0) {
    return state.revisionCount < 1 ? "producer" : "__end__";
  }
  return "factChecker";
}

export function routeAfterFactCheck(
  state: typeof PipelineStateAnnotation.State
): "producer" | "imageGen" | "__end__" {
  if (state.factCheckStatus === "PASS") return "imageGen";
  if (state.factCheckStatus === "REVISE" && state.revisionCount < 1) {
    return "producer";
  }
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
      producer: "producer",
      factChecker: "factChecker",
      __end__: END,
    })
    .addConditionalEdges("factChecker", routeAfterFactCheck, {
      producer: "producer",
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
