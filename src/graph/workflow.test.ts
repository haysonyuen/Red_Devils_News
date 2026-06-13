import { GeneratedCandidate } from "./contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { buildPipeline } from "./pipeline";
import { postReferenceRequestNode } from "./nodes/referenceGateway";
import {
  applyCandidateDecision,
  applyFinalApprovalDecision,
  postCandidateSelectionNode,
  postFinalApprovalNode,
} from "./nodes/slackGateway";
import { publishNode } from "./nodes/publish";
import { PipelineState } from "./state";
import { ReferenceCoordinator } from "../references/coordinator";
import { ReferenceStore } from "../references/store";

const evaluation = {
  candidateId: "candidate-1",
  scores: {
    identityFidelity: { "Marcus Rashford": 94 },
    storyAlignment: 91,
    feedImpact: 90,
    composition: 88,
    captionComplement: 86,
    factualIntegrity: 93,
  },
  hardFailures: [],
  warnings: ["Club crest intentionally omitted"],
  rationale: "Recognizable subject and clear transfer-decision story.",
  recommended: true,
};

const selectedCandidate: GeneratedCandidate = {
  id: "candidate-1",
  publicUrl: "https://cdn.example.com/candidate-1.jpg",
  providerRequestId: "fal-request-1",
  evaluation,
  qualified: true,
};

function state(
  overrides: Partial<PipelineState> = {}
): PipelineState {
  return {
    runId: "thread-123",
    triggerTime: "2026-06-12T12:00:00.000Z",
    rawSearchHits: [],
    filteredArticles: [
      {
        url: "https://www.bbc.com/sport/football/articles/example",
        title: "United transfer decision",
        source: "BBC Sport",
        bodyText: "A decision remains pending.",
      },
    ],
    storySelection: null,
    producerDecision: null,
    producerRejectionCount: 0,
    rejectedStoryUrls: [],
    factCheck: {
      status: "PASS",
      storyStatus: "INTEREST",
      claimChecks: [],
      visualImplicationsAllowed: ["Neutral clothing"],
      visualImplicationsForbidden: ["Completed transfer"],
      issues: [],
      revisionFeedback: null,
    },
    visualBrief: {
      storyHook: "United need a transfer decision",
      emotionalGoal: "Demand clarity",
      primaryCharacter: "Marcus Rashford",
      secondaryCharacters: [],
      compositionMode: "PRIMARY_WITH_BACKGROUND",
      requiredSignals: ["Decision pending"],
      forbiddenImplications: ["Completed transfer"],
      referenceRequirements: [
        {
          person: "Marcus Rashford",
          role: "PRIMARY",
          required: true,
        },
      ],
      searchInstructions: [],
      generationPromptTemplate: "Create an editorial portrait",
      conceptualFallbackPrompt: "A crossroads outside Old Trafford",
      referenceWarning: null,
    },
    referenceRequests: [],
    referenceCandidates: [],
    referenceApprovals: [
      {
        requestId: "reference-1",
        person: "Marcus Rashford",
        role: "PRIMARY",
        privateAssetId: "private/reference-1",
        sourcePageUrl: "https://example.com/source-page",
        sha256: "abc123",
      },
    ],
    generationRequest: null,
    generatedCandidates: [selectedCandidate],
    selectedCandidate,
    visualEvaluation: evaluation,
    visualRegenerationCount: 0,
    scoutBrief: {
      selectedArticleUrls: [
        "https://www.bbc.com/sport/football/articles/example",
      ],
      selectionReason: "Current United story",
      confidence: 0.95,
    },
    editorialBrief: null,
    draftCaption: "United need clarity before pre-season. #MUFC",
    producerValidationIssues: [],
    factCheckStatus: "PASS",
    factCheckIssues: [],
    factCheckClaims: [],
    revisionFeedback: null,
    revisionCount: 0,
    generatedImageUrl: "https://cdn.example.com/legacy.jpg",
    approvalStatus: "PENDING",
    publishStatus: "UNPUBLISHED",
    errorLog: [],
    ...overrides,
  };
}

async function testSeparatedSlackStages(): Promise<void> {
  const posts: Array<Record<string, unknown>> = [];
  const postMessage = async (message: Record<string, unknown>) => {
    posts.push(message);
  };

  await postCandidateSelectionNode(state(), { postMessage });
  if (posts.length !== 1) {
    throw new Error("Candidate posting should create exactly one Slack message");
  }

  const selected = applyCandidateDecision(state(), {
    stage: "CANDIDATE_SELECTION",
    entity_id: selectedCandidate.id,
    action: "SELECT",
  });
  if (selected.selectedCandidate?.id !== selectedCandidate.id) {
    throw new Error("Candidate selection should persist the selected candidate");
  }

  await postFinalApprovalNode(state(), { postMessage });
  if (Number(posts.length) !== 2) {
    throw new Error("Final approval should be a separate Slack message");
  }
  const finalPayload = JSON.stringify(posts[1]);
  if (
    !finalPayload.includes(selectedCandidate.publicUrl) ||
    finalPayload.includes("private/reference-1")
  ) {
    throw new Error("Final card must use the public candidate and hide private references");
  }
}

async function testFinalApprovalControlsMeta(): Promise<void> {
  const published: Array<{ imageUrl: string; caption: string }> = [];
  const meta = {
    publish: async (imageUrl: string, caption: string) => {
      published.push({ imageUrl, caption });
      return "media-1";
    },
  };

  const rejected = applyFinalApprovalDecision("REJECTED");
  await publishNode(state(rejected), meta);
  if (published.length !== 0) {
    throw new Error("Final rejection must never invoke Meta");
  }

  const approved = applyFinalApprovalDecision("APPROVED");
  const result = await publishNode(state(approved), meta);
  if (
    result.publishStatus !== "SUCCESS" ||
    published[0]?.imageUrl !== selectedCandidate.publicUrl
  ) {
    throw new Error("Final approval must publish selectedCandidate.publicUrl");
  }
}

async function testRegenerationFallback(): Promise<void> {
  const first = applyCandidateDecision(state(), {
    stage: "CANDIDATE_SELECTION",
    entity_id: "all",
    action: "REGENERATE",
  });
  if (first.visualRegenerationCount !== 1) {
    throw new Error("First regeneration should remain referenced");
  }

  const second = applyCandidateDecision(
    state({ visualRegenerationCount: 1 }),
    {
      stage: "CANDIDATE_SELECTION",
      entity_id: "all",
      action: "REGENERATE",
    }
  );
  if (
    second.visualRegenerationCount !== 2 ||
    second.visualBrief?.compositionMode !== "CONCEPTUAL"
  ) {
    throw new Error("Second regeneration should switch to conceptual fallback");
  }
}

async function testReferenceDiscoveryGateway(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "red-devils-gateway-"));
  const store = new ReferenceStore(join(tempDir, "references.db"));
  try {
    const coordinator = new ReferenceCoordinator(store);
    const posts: Array<Record<string, unknown>> = [];
    const result = await postReferenceRequestNode(state(), {
      coordinator,
      discover: async ({ requestId, person }) => [
        {
          id: `candidate-${person}`,
          requestId,
          person,
          imageUrl: "https://ichef.bbci.co.uk/images/player.jpg",
          sourcePageUrl:
            "https://www.bbc.com/sport/football/articles/example",
          origin: "SELECTED_ARTICLE",
          rank: 1,
          status: "AVAILABLE",
          discoveredAt: "2026-06-13T12:00:00.000Z",
        },
      ],
      postMessage: async (message) => {
        posts.push(message);
        return { ts: "slack-thread-1" };
      },
    });

    if (
      result.referenceCandidates?.length !== 1 ||
      result.referenceRequests?.[0]?.status !== "AWAITING_DECISION" ||
      !JSON.stringify(posts[0]).includes(state().draftCaption ?? "")
    ) {
      throw new Error(
        "Gateway should discover references and post the completed caption"
      );
    }
    if (
      coordinator.requestsForRun("thread-123")[0]?.threadTs !==
      "slack-thread-1"
    ) {
      throw new Error("Gateway should persist the Slack thread timestamp");
    }
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

Promise.all([
  testSeparatedSlackStages(),
  testFinalApprovalControlsMeta(),
  testRegenerationFallback(),
  testReferenceDiscoveryGateway(),
])
  .then(() => {
    buildPipeline(SqliteSaver.fromConnString(":memory:"));
    console.log("Workflow tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
