import {
  FactCheckOutput,
  ProducerOutput,
  StorySelection,
} from "./contracts";
import { PipelineStateAnnotation } from "./state";

const sourceUrl =
  "https://www.bbc.com/sport/football/articles/example";

const scout: StorySelection = {
  decision: "SELECT",
  primaryStory: "United are considering a move",
  supportingSourceUrls: [sourceUrl],
  mainCharacters: ["Marcus Rashford"],
  storyStatus: "INTEREST",
  visualPotential: 90,
  selectionReason: "Current, consequential, and visually clear",
  confidence: 0.95,
};

const producer: ProducerOutput = {
  decision: "ACCEPT",
  decisionReason: "The story has a clear United supporter angle",
  angle: "United need clarity before pre-season",
  facts: [
    {
      claim: "A decision is pending",
      sourceUrl: scout.supportingSourceUrls[0],
    },
  ],
  supporterOpinion: "We should avoid another unresolved summer",
  caption: "We need clarity before pre-season...",
  headlineOptions: ["DECISION TIME", "NO MORE DRIFTING"],
};

const factCheck: FactCheckOutput = {
  status: "PASS",
  storyStatus: "INTEREST",
  claimChecks: [
    {
      claim: "A decision is pending",
      verdict: "SUPPORTED",
      evidence: "The article says a decision is pending.",
      sourceUrl: scout.supportingSourceUrls[0],
    },
  ],
  visualImplicationsAllowed: [
    "Current or neutral clothing",
    "Symbolic destination colors",
  ],
  visualImplicationsForbidden: ["Completed signing", "Destination kit"],
  issues: [],
  revisionFeedback: null,
};

if (
  scout.decision !== "SELECT" ||
  producer.decision !== "ACCEPT" ||
  factCheck.status !== "PASS"
) {
  throw new Error("Representative editorial contracts should be valid");
}

const expectedDefaults = {
  producerDecision: null,
  producerRejectionCount: 0,
  rejectedStoryUrls: [],
  visualBrief: null,
  referenceRequests: [],
  generatedCandidates: [],
  selectedCandidate: null,
  visualRegenerationCount: 0,
  approvalStatus: "PENDING",
};

for (const [field, expected] of Object.entries(expectedDefaults)) {
  const channel =
    PipelineStateAnnotation.spec[
      field as keyof typeof PipelineStateAnnotation.spec
    ];
  const actual = channel.get();

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${field} default ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

console.log("Four-agent editorial contract tests passed");
