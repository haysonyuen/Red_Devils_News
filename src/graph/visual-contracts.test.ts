import { FactCheckOutput, VisualBrief } from "./contracts";
import {
  normalizeFactCheckOutput,
  parseFactCheckOutput,
} from "./nodes/factChecker";
import {
  routeAfterFactCheck,
  routeAfterVisualBrief,
} from "./pipeline";
import {
  parseVisualBrief,
  prepareVisualBriefInput,
  visualBriefNode,
} from "./nodes/visualProducer";
import { PipelineStateAnnotation } from "./state";
import { assertVisualRequestAllowed } from "../visual/certainty";

const suppliedUrl =
  "https://www.bbc.com/sport/football/articles/example?at_medium=RSS";

const validOutput: FactCheckOutput = {
  status: "PASS",
  storyStatus: "INTEREST",
  claimChecks: [
    {
      claim: "United are interested in the player",
      verdict: "SUPPORTED",
      evidence: "The report says United retain an interest.",
      sourceUrl: suppliedUrl,
    },
  ],
  visualImplicationsAllowed: [
    "Current or neutral clothing",
    "Symbolic destination backdrop",
  ],
  visualImplicationsForbidden: ["Completed signing", "Destination kit"],
  issues: [],
  revisionFeedback: null,
};

function expectThrows(
  label: string,
  action: () => unknown,
  messageIncludes?: string
): void {
  try {
    action();
  } catch (error) {
    if (
      messageIncludes &&
      (!(error instanceof Error) || !error.message.includes(messageIncludes))
    ) {
      throw new Error(
        `Expected ${label} to name "${messageIncludes}", got ${String(error)}`
      );
    }
    return;
  }
  throw new Error(`Expected ${label} to throw`);
}

function state(
  value: Partial<typeof PipelineStateAnnotation.State>
): typeof PipelineStateAnnotation.State {
  return value as typeof PipelineStateAnnotation.State;
}

parseFactCheckOutput(validOutput);

expectThrows("missing Fact Checker key", () => {
  const { issues: _issues, ...missingKey } = validOutput;
  parseFactCheckOutput(missingKey);
});
expectThrows("extra Fact Checker key", () =>
  parseFactCheckOutput({ ...validOutput, caption: "Do not return this" })
);
expectThrows("invalid Fact Checker status", () =>
  parseFactCheckOutput({ ...validOutput, status: "PENDING" })
);
expectThrows("invalid story status", () =>
  parseFactCheckOutput({ ...validOutput, storyStatus: "RUMOUR" })
);
expectThrows("invalid claim verdict", () =>
  parseFactCheckOutput({
    ...validOutput,
    claimChecks: [{ ...validOutput.claimChecks[0], verdict: "PARTIAL" }],
  })
);
expectThrows("extra claim check key", () =>
  parseFactCheckOutput({
    ...validOutput,
    claimChecks: [
      { ...validOutput.claimChecks[0], confidence: 0.9 },
    ],
  })
);
expectThrows("empty allowed implications", () =>
  parseFactCheckOutput({ ...validOutput, visualImplicationsAllowed: [] })
);
expectThrows("empty forbidden implications", () =>
  parseFactCheckOutput({ ...validOutput, visualImplicationsForbidden: [] })
);
expectThrows("REVISE without actionable feedback", () =>
  parseFactCheckOutput({
    ...validOutput,
    status: "REVISE",
    issues: [],
    revisionFeedback: null,
  })
);
expectThrows("PASS with revision feedback", () =>
  parseFactCheckOutput({
    ...validOutput,
    revisionFeedback: "This contradicts PASS.",
  })
);

const unsupportedPass = parseFactCheckOutput({
  ...validOutput,
  claimChecks: [
    {
      claim: "The transfer is complete",
      verdict: "UNSUPPORTED",
      evidence: "No supplied report confirms completion.",
      sourceUrl: null,
    },
  ],
});
if (
  normalizeFactCheckOutput(unsupportedPass, [suppliedUrl], 0).status !== "REVISE"
) {
  throw new Error("PASS with an unsupported claim must become REVISE");
}
if (
  !normalizeFactCheckOutput(
    unsupportedPass,
    [suppliedUrl],
    0
  ).revisionFeedback
) {
  throw new Error("A downgraded PASS must include actionable revision feedback");
}
if (
  normalizeFactCheckOutput(unsupportedPass, [suppliedUrl], 1).status !==
  "REJECT"
) {
  throw new Error("A second requested revision must become REJECT");
}

expectThrows("unknown supported source URL", () =>
  normalizeFactCheckOutput(
    {
      ...validOutput,
      claimChecks: [
        {
          ...validOutput.claimChecks[0],
          sourceUrl: "https://example.com/not-selected",
        },
      ],
    },
    [suppliedUrl],
    0
  )
);
const canonicalized = normalizeFactCheckOutput(
  {
    ...validOutput,
    claimChecks: [
      {
        ...validOutput.claimChecks[0],
        sourceUrl:
          "https://www.bbc.com/sport/football/articles/example",
      },
    ],
  },
  [suppliedUrl],
  0
);
if (canonicalized.claimChecks[0].sourceUrl !== suppliedUrl) {
  throw new Error("Supported URLs must map back to the supplied evidence URL");
}

assertVisualRequestAllowed("CONFIRMED", "Player in destination kit");
expectThrows(
  "ADVANCED destination kit",
  () => assertVisualRequestAllowed("ADVANCED", "Player in destination kit"),
  "destination kit"
);
expectThrows(
  "INTEREST completed signing",
  () =>
    assertVisualRequestAllowed(
      "INTEREST",
      "A completed signing photo at Old Trafford"
    ),
  "completed signing"
);
assertVisualRequestAllowed(
  "SPECULATION",
  "Player in current clothing with a symbolic backdrop"
);
assertVisualRequestAllowed(
  "INTEREST",
  "Do not show a destination kit; keep the player in current clothing"
);
expectThrows(
  "unrelated negation must not hide destination kit",
  () =>
    assertVisualRequestAllowed(
      "INTEREST",
      "No logos; show the player in a destination kit"
    ),
  "destination kit"
);
expectThrows(
  "one negated concept must not hide another",
  () =>
    assertVisualRequestAllowed(
      "INTEREST",
      "No destination kit; create a completed signing photo"
    ),
  "completed signing"
);
expectThrows(
  "negated occurrence must not hide later literal occurrence",
  () =>
    assertVisualRequestAllowed(
      "INTEREST",
      "Avoid destination kit and include destination kit"
    ),
  "destination kit"
);
assertVisualRequestAllowed(
  "INTEREST",
  "A biomedical update beside a destination kitchen"
);
expectThrows(
  "explicit CONFIRMED restriction",
  () =>
    assertVisualRequestAllowed(
      "CONFIRMED",
      "Player holding a trophy",
      ["holding a trophy"]
    ),
  "holding a trophy"
);

if (
  routeAfterFactCheck(
    state({ factCheck: validOutput, factCheckStatus: "REJECT", revisionCount: 0 })
  ) !== "visualBrief"
) {
  throw new Error("Grouped PASS should route to Visual Producer");
}
if (
  routeAfterFactCheck(
    state({
      factCheck: { ...validOutput, status: "REVISE" },
      revisionCount: 0,
    })
  ) !== "producer"
) {
  throw new Error("First grouped REVISE should route to Producer");
}
if (
  routeAfterFactCheck(
    state({
      factCheck: { ...validOutput, status: "REVISE" },
      revisionCount: 1,
    })
  ) !== "__end__"
) {
  throw new Error("Second grouped REVISE should end");
}
if (
  routeAfterFactCheck(
    state({
      factCheck: { ...validOutput, status: "REJECT" },
      revisionCount: 0,
    })
  ) !== "__end__"
) {
  throw new Error("Grouped REJECT should end");
}

const singlePlayerBrief: VisualBrief = {
  storyHook: "United retain an interest in Player One",
  emotionalGoal: "Measured anticipation",
  primaryCharacter: "Player One",
  secondaryCharacters: [],
  compositionMode: "PRIMARY_WITH_BACKGROUND",
  requiredSignals: ["Current club clothing", "Symbolic Manchester backdrop"],
  forbiddenImplications: [...validOutput.visualImplicationsForbidden],
  referenceRequirements: [
    { person: "Player One", role: "PRIMARY", required: true },
  ],
  searchInstructions: [
    "Search the current club official site first for a recent portrait",
  ],
  generationPromptTemplate:
    "Portrait of Player One in current club clothing with a symbolic Manchester backdrop; no text or logos",
  conceptualFallbackPrompt:
    "A floodlit Manchester football scene suggesting measured anticipation; no text or logos",
  referenceWarning: null,
};

const parsedSingle = parseVisualBrief(singlePlayerBrief);
if (
  parsedSingle.compositionMode !== "PRIMARY_WITH_BACKGROUND" ||
  parsedSingle.primaryCharacter !== "Player One"
) {
  throw new Error("A single-player brief should parse with a primary");
}
if (
  JSON.stringify(parsedSingle.forbiddenImplications) !==
  JSON.stringify(validOutput.visualImplicationsForbidden)
) {
  throw new Error("Forbidden implications should be preserved exactly");
}

const twoPersonBrief: VisualBrief = {
  ...singlePlayerBrief,
  primaryCharacter: "Player One",
  secondaryCharacters: ["Player Two"],
  compositionMode: "PRIMARY_WITH_SECONDARIES",
  referenceRequirements: [
    { person: "Player One", role: "PRIMARY", required: true },
    { person: "Player Two", role: "SECONDARY", required: true },
  ],
  generationPromptTemplate:
    "Mobile-first composition with Player One dominant and Player Two clearly secondary; no text or logos",
};
parseVisualBrief(twoPersonBrief);

const conceptualBrief: VisualBrief = {
  ...singlePlayerBrief,
  primaryCharacter: null,
  secondaryCharacters: [],
  compositionMode: "CONCEPTUAL",
  referenceRequirements: [],
  generationPromptTemplate:
    "A symbolic Manchester football scene expressing measured anticipation; no text or logos",
};
parseVisualBrief(conceptualBrief);

expectThrows("missing separate secondary reference", () =>
  parseVisualBrief({
    ...twoPersonBrief,
    referenceRequirements: [twoPersonBrief.referenceRequirements[0]],
  })
);
expectThrows("duplicate cast person", () =>
  parseVisualBrief({
    ...twoPersonBrief,
    secondaryCharacters: ["Player One"],
  })
);
expectThrows("duplicate reference person", () =>
  parseVisualBrief({
    ...twoPersonBrief,
    referenceRequirements: [
      ...twoPersonBrief.referenceRequirements,
      { person: "Player Two", role: "SECONDARY", required: true },
    ],
  })
);
expectThrows("URL in generation template", () =>
  parseVisualBrief({
    ...singlePlayerBrief,
    generationPromptTemplate:
      "Use https://example.com/player.jpg for Player One; no text or logos",
  })
);
expectThrows("mismatched primary role", () =>
  parseVisualBrief({
    ...singlePlayerBrief,
    referenceRequirements: [
      { person: "Player One", role: "SECONDARY", required: true },
    ],
  })
);
expectThrows("conceptual brief with references", () =>
  parseVisualBrief({
    ...conceptualBrief,
    referenceRequirements: [
      { person: "Player One", role: "PRIMARY", required: true },
    ],
  })
);
expectThrows("large cast without warning", () =>
  parseVisualBrief({
    ...twoPersonBrief,
    secondaryCharacters: ["Player Two", "Player Three", "Player Four"],
    referenceRequirements: [
      { person: "Player One", role: "PRIMARY", required: true },
      { person: "Player Two", role: "SECONDARY", required: true },
      { person: "Player Three", role: "SECONDARY", required: true },
      { person: "Player Four", role: "SECONDARY", required: true },
    ],
  })
);
parseVisualBrief({
  ...twoPersonBrief,
  secondaryCharacters: ["Player Two", "Player Three", "Player Four"],
  referenceRequirements: [
    { person: "Player One", role: "PRIMARY", required: true },
    { person: "Player Two", role: "SECONDARY", required: true },
    { person: "Player Three", role: "SECONDARY", required: true },
    { person: "Player Four", role: "SECONDARY", required: true },
  ],
  referenceWarning:
    "Four recognizable people require separate approved references.",
});

const acceptedProducer = {
  decision: "ACCEPT" as const,
  decisionReason: "The story is supported",
  angle: "Measured interest",
  facts: [{ claim: "United retain an interest", sourceUrl: suppliedUrl }],
  supporterOpinion: "Worth monitoring",
  caption: "United retain an interest in Player One.",
  headlineOptions: ["United retain interest"],
};
const selectedStory = {
  decision: "SELECT" as const,
  primaryStory: "United retain an interest in Player One",
  supportingSourceUrls: [suppliedUrl],
  mainCharacters: ["Player One"],
  storyStatus: "INTEREST" as const,
  visualPotential: 80,
  selectionReason: "Strong supporter interest",
  confidence: 0.9,
};
const visualInput = prepareVisualBriefInput(
  state({
    storySelection: selectedStory,
    producerDecision: acceptedProducer,
    draftCaption: acceptedProducer.caption,
    factCheck: validOutput,
  })
);
if (
  JSON.stringify(visualInput.forbiddenImplications) !==
  JSON.stringify(validOutput.visualImplicationsForbidden)
) {
  throw new Error("Visual Producer input should copy forbidden implications");
}

if (
  routeAfterVisualBrief(state({ visualBrief: conceptualBrief })) !== "imageGen"
) {
  throw new Error("Conceptual briefs should preserve the legacy image path");
}
if (
  routeAfterVisualBrief(state({ visualBrief: singlePlayerBrief })) !== "__end__"
) {
  throw new Error("People briefs should end until Task 6 adds references");
}

async function testVisualBriefNodePrecondition(): Promise<void> {
  const update = await visualBriefNode(
    state({
      storySelection: selectedStory,
      producerDecision: acceptedProducer,
      draftCaption: acceptedProducer.caption,
      factCheck: { ...validOutput, status: "REVISE" },
      errorLog: [],
    })
  );
  if (
    update.visualBrief !== null ||
    !update.errorLog?.some((entry) => entry.includes("[visualProducer]"))
  ) {
    throw new Error(
      "Visual Producer precondition errors should clear the brief and log the failure"
    );
  }
}

testVisualBriefNodePrecondition()
  .then(() => console.log("Visual contract tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
