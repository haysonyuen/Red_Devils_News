import {
  FactCheckOutput,
  ProducerOutput,
  StorySelection,
} from "./contracts";
import {
  parseStorySelection,
  validateStorySelectionUrls,
} from "./nodes/scout";
import { parseProducerOutput } from "./nodes/producer";
import { routeAfterProducer, routeAfterScout } from "./pipeline";
import { PipelineStateAnnotation } from "./state";

const sourceUrl =
  "https://www.bbc.com/sport/football/articles/example";
const alternateSourceUrl =
  "https://www.theguardian.com/football/example";

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

function expectThrows(label: string, action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw`);
}

function state(
  value: Partial<typeof PipelineStateAnnotation.State>
): typeof PipelineStateAnnotation.State {
  return value as typeof PipelineStateAnnotation.State;
}

parseStorySelection(scout);
parseStorySelection({
  decision: "NO_STORY",
  primaryStory: null,
  supportingSourceUrls: [],
  mainCharacters: [],
  storyStatus: null,
  visualPotential: 0,
  selectionReason: "No supplied story meets the editorial threshold",
  confidence: 0.8,
});

expectThrows("non-object Scout output", () => parseStorySelection(null));
expectThrows("unknown Scout status", () =>
  parseStorySelection({ ...scout, storyStatus: "RUMOUR" })
);
expectThrows("invalid Scout score", () =>
  parseStorySelection({ ...scout, visualPotential: 101 })
);
expectThrows("SELECT without supporting URLs", () =>
  parseStorySelection({ ...scout, supportingSourceUrls: [] })
);
expectThrows("contradictory NO_STORY", () =>
  parseStorySelection({
    ...scout,
    decision: "NO_STORY",
    storyStatus: null,
  })
);

parseProducerOutput(producer);
parseProducerOutput({
  decision: "REJECT_AND_RESCOUT",
  decisionReason: "The available reporting is too thin for a useful post",
  angle: null,
  facts: [],
  supporterOpinion: null,
  caption: null,
  headlineOptions: [],
});

expectThrows("ACCEPT without caption", () =>
  parseProducerOutput({ ...producer, caption: null })
);
expectThrows("ACCEPT without facts", () =>
  parseProducerOutput({ ...producer, facts: [] })
);
expectThrows("rejection with caption", () =>
  parseProducerOutput({
    ...producer,
    decision: "REJECT_AND_END",
    angle: null,
    facts: [],
    supporterOpinion: null,
    headlineOptions: [],
  })
);
expectThrows("rejection with facts", () =>
  parseProducerOutput({
    ...producer,
    decision: "REJECT_AND_END",
    angle: null,
    supporterOpinion: null,
    caption: null,
    headlineOptions: [],
  })
);
expectThrows("invalid Producer decision", () =>
  parseProducerOutput({ ...producer, decision: "REVISE" })
);

if (
  routeAfterScout(state({ storySelection: { ...scout, decision: "NO_STORY" } })) !==
  "__end__"
) {
  throw new Error("NO_STORY should end after Scout");
}
if (routeAfterScout(state({ storySelection: scout })) !== "producer") {
  throw new Error("SELECT should route to Producer");
}
if (
  routeAfterProducer(
    state({
      producerDecision: {
        ...producer,
        decision: "REJECT_AND_RESCOUT",
        angle: null,
        facts: [],
        supporterOpinion: null,
        caption: null,
        headlineOptions: [],
      },
      producerRejectionCount: 1,
    })
  ) !== "scout"
) {
  throw new Error("First Producer rescout rejection should route to Scout");
}
if (
  routeAfterProducer(
    state({
      producerDecision: {
        ...producer,
        decision: "REJECT_AND_RESCOUT",
        angle: null,
        facts: [],
        supporterOpinion: null,
        caption: null,
        headlineOptions: [],
      },
      producerRejectionCount: 2,
    })
  ) !== "__end__"
) {
  throw new Error("Second Producer rejection should end");
}
if (
  routeAfterProducer(
    state({
      producerDecision: {
        ...producer,
        decision: "REJECT_AND_END",
        angle: null,
        facts: [],
        supporterOpinion: null,
        caption: null,
        headlineOptions: [],
      },
      producerRejectionCount: 1,
    })
  ) !== "__end__"
) {
  throw new Error("REJECT_AND_END should end");
}
if (
  routeAfterProducer(
    state({
      producerDecision: producer,
      draftCaption: producer.caption,
      producerValidationIssues: [],
    })
  ) !== "factChecker"
) {
  throw new Error("A valid accepted Producer output should route to Fact Checker");
}

const canonicalSelection = validateStorySelectionUrls(
  { ...scout, supportingSourceUrls: [`${sourceUrl}?at_medium=RSS`] },
  [sourceUrl, alternateSourceUrl],
  []
);
if (canonicalSelection.supportingSourceUrls[0] !== sourceUrl) {
  throw new Error("Scout URLs should map back to supplied URLs");
}
expectThrows("previously rejected Scout URL", () =>
  validateStorySelectionUrls(scout, [sourceUrl, alternateSourceUrl], [sourceUrl])
);

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
