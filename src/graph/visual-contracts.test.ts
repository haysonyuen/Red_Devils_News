import { FactCheckOutput } from "./contracts";
import {
  normalizeFactCheckOutput,
  parseFactCheckOutput,
} from "./nodes/factChecker";
import { routeAfterFactCheck } from "./pipeline";
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
  ) !== "imageGen"
) {
  throw new Error("Grouped PASS should route to image generation");
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

console.log("Visual contract tests passed");
