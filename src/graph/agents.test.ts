import { parseScoutBrief } from "./nodes/scout";
import { parseProducerDraft } from "./nodes/producer";
import { parseFactCheckResult } from "./nodes/factChecker";
import {
  routeAfterFactCheck,
  routeAfterImage,
  routeAfterProducer,
} from "./pipeline";
import { PipelineStateAnnotation } from "./state";
import { canonicalizeUrl, mapToSuppliedUrl } from "../validation/url";

const url =
  "https://www.bbc.com/sport/football/articles/example?at_medium=RSS&at_campaign=rss";
const cleanUrl = "https://www.bbc.com/sport/football/articles/example";

if (canonicalizeUrl(url) !== canonicalizeUrl(cleanUrl)) {
  throw new Error("BBC RSS tracking parameters should not affect URL identity");
}
if (mapToSuppliedUrl(cleanUrl, [url]) !== url) {
  throw new Error("Canonical citation should map back to the supplied RSS URL");
}

parseScoutBrief({
  selectedArticleUrls: [url],
  selectionReason: "Current and consequential",
  confidence: 0.9,
});

parseProducerDraft({
  narrative: "A supported narrative",
  facts: [{ claim: "A supported claim", sourceUrl: url }],
  context: "Relevant context",
  caption: "A grounded caption",
  image_prompt: "A photorealistic football scene",
});

parseFactCheckResult({
  status: "PASS",
  claim_checks: [
    {
      claim: "A supported claim",
      verdict: "SUPPORTED",
      evidence: "The source states the claim.",
      sourceUrl: url,
    },
  ],
  issues: [],
  revision_feedback: null,
});

function route(
  factCheckStatus: "PASS" | "REVISE" | "REJECT",
  revisionCount: number
) {
  return routeAfterFactCheck({
    factCheckStatus,
    revisionCount,
  } as typeof PipelineStateAnnotation.State);
}

if (route("PASS", 0) !== "imageGen") {
  throw new Error("PASS should route to image generation");
}
if (route("REVISE", 0) !== "producer") {
  throw new Error("First REVISE should route back to the producer");
}
if (route("REVISE", 1) !== "__end__") {
  throw new Error("Second REVISE should end the run");
}
if (route("REJECT", 0) !== "__end__") {
  throw new Error("REJECT should end the run");
}
if (
  routeAfterProducer({
    editorialBrief: { narrative: "n", context: "c", facts: [] },
    draftCaption: "caption",
    imagePrompt: "prompt",
    producerValidationIssues: ["voice issue"],
    revisionCount: 0,
  } as unknown as typeof PipelineStateAnnotation.State) !== "producer"
) {
  throw new Error("First deterministic validation failure should revise");
}
if (
  routeAfterProducer({
    editorialBrief: { narrative: "n", context: "c", facts: [] },
    draftCaption: "caption",
    imagePrompt: "prompt",
    producerValidationIssues: ["voice issue"],
    revisionCount: 1,
  } as unknown as typeof PipelineStateAnnotation.State) !== "__end__"
) {
  throw new Error("Repeated deterministic validation failure should end");
}
if (
  routeAfterImage({
    generatedImageUrl: "https://example.com/image.jpg",
  } as typeof PipelineStateAnnotation.State) !== "slackGateway"
) {
  throw new Error("A buffered image should route to Slack");
}
if (
  routeAfterImage({
    generatedImageUrl: null,
  } as typeof PipelineStateAnnotation.State) !== "__end__"
) {
  throw new Error("A failed image should end before Slack");
}

console.log("Three-agent contract tests passed");
