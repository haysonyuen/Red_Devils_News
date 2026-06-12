import {
  routeAfterFactCheck,
  routeAfterImage,
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
  routeAfterImage({
    generatedCandidates: [{}],
  } as unknown as typeof PipelineStateAnnotation.State) !== "visualEvaluation"
) {
  throw new Error("Generated candidates should route to visual evaluation");
}
if (
  routeAfterImage({
    generatedCandidates: [],
  } as unknown as typeof PipelineStateAnnotation.State) !== "__end__"
) {
  throw new Error("A failed image should end before visual evaluation");
}

console.log("Three-agent contract tests passed");
