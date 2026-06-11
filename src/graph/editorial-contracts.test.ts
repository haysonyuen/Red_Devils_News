import {
  FactCheckOutput,
  ProducerOutput,
  StorySelection,
} from "./contracts";
import {
  parseStorySelection,
  validateStorySelectionUrls,
} from "./nodes/scout";
import {
  buildAcceptedProducerUpdate,
  buildProducerRejectionUpdate,
  parseProducerOutput,
} from "./nodes/producer";
import { prepareFactCheckerHandoff } from "./nodes/factChecker";
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

const selectedArticle = {
  url: sourceUrl,
  title: "United transfer update",
  source: "BBC Sport",
  bodyText: "A decision is pending.",
};
const factCheckerHandoff = prepareFactCheckerHandoff(
  state({
    storySelection: scout,
    producerDecision: producer,
    draftCaption: producer.caption,
    editorialBrief: null,
    filteredArticles: [
      selectedArticle,
      {
        ...selectedArticle,
        url: alternateSourceUrl,
        title: "Unselected story",
      },
    ],
  })
);
if (!factCheckerHandoff) {
  throw new Error(
    "An accepted ProducerOutput should be a valid Fact Checker handoff without editorialBrief"
  );
}
if (
  factCheckerHandoff.producerDecision !== producer ||
  factCheckerHandoff.caption !== producer.caption ||
  factCheckerHandoff.evidence.length !== 1 ||
  factCheckerHandoff.evidence[0].url !== sourceUrl
) {
  throw new Error(
    "Fact Checker handoff should contain the accepted ProducerOutput, caption, and selected evidence"
  );
}

const revisionUpdate = buildAcceptedProducerUpdate(
  state({
    revisionFeedback: "Clarify the transfer status.",
    revisionCount: 4,
  }),
  producer,
  []
);
if (revisionUpdate.revisionCount !== 5) {
  throw new Error("A Producer revision should increment revisionCount once");
}
const initialProducerUpdate = buildAcceptedProducerUpdate(
  state({
    revisionFeedback: null,
    revisionCount: 0,
  }),
  producer,
  []
);
if (initialProducerUpdate.revisionCount !== 0) {
  throw new Error("An initial Producer pass should not increment revisionCount");
}

const rescoutDecision: ProducerOutput = {
  decision: "REJECT_AND_RESCOUT",
  decisionReason: "The selected story is too thin",
  angle: null,
  facts: [],
  supporterOpinion: null,
  caption: null,
  headlineOptions: [],
};
const rescoutUpdate = buildProducerRejectionUpdate(
  state({
    storySelection: scout,
    producerRejectionCount: 0,
    rejectedStoryUrls: [alternateSourceUrl],
    revisionFeedback: "Old revision feedback",
    factCheck: factCheck,
    factCheckStatus: "PASS",
    factCheckIssues: ["Old issue"],
    factCheckClaims: factCheck.claimChecks,
    revisionCount: 1,
    draftCaption: "Old caption",
    producerValidationIssues: ["Old validation issue"],
    editorialBrief: {
      narrative: "Old narrative",
      facts: producer.facts,
      context: "Old context",
    },
    imagePrompt: "Old image prompt",
    generatedImageUrl: "https://example.com/old-image.jpg",
    visualBrief: {
      storyHook: "Old hook",
      emotionalGoal: "Old goal",
      primaryCharacter: "Old player",
      secondaryCharacters: [],
      compositionMode: "PRIMARY_WITH_BACKGROUND",
      requiredSignals: ["Old signal"],
      forbiddenImplications: [],
      referenceRequirements: [],
      searchInstructions: [],
      generationPromptTemplate: "Old template",
      conceptualFallbackPrompt: "Old fallback",
      referenceWarning: null,
    },
    referenceRequests: [{} as never],
    referenceApprovals: [{} as never],
    generationRequest: {} as never,
    generatedCandidates: [{} as never],
    selectedCandidate: {} as never,
    visualEvaluation: {} as never,
    visualRegenerationCount: 1,
    approvalStatus: "APPROVED",
    publishStatus: "SUCCESS",
  }),
  rescoutDecision
);
const expectedRescoutReset = {
  revisionFeedback: null,
  factCheck: null,
  factCheckStatus: "PENDING",
  factCheckIssues: [],
  factCheckClaims: [],
  revisionCount: 0,
  draftCaption: null,
  producerValidationIssues: [],
  editorialBrief: null,
  imagePrompt: null,
  generatedImageUrl: null,
  visualBrief: null,
  referenceRequests: [],
  referenceApprovals: [],
  generationRequest: null,
  generatedCandidates: [],
  selectedCandidate: null,
  visualEvaluation: null,
  visualRegenerationCount: 0,
  approvalStatus: "PENDING",
  publishStatus: "UNPUBLISHED",
};
for (const [field, expected] of Object.entries(expectedRescoutReset)) {
  const actual = rescoutUpdate[field as keyof typeof rescoutUpdate];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected rescout ${field} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}
if (
  rescoutUpdate.producerDecision !== rescoutDecision ||
  rescoutUpdate.producerRejectionCount !== 1 ||
  JSON.stringify(rescoutUpdate.rejectedStoryUrls) !==
    JSON.stringify([alternateSourceUrl, sourceUrl])
) {
  throw new Error(
    "Rescout should preserve its decision, incremented rejection count, and rejected story URLs"
  );
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
