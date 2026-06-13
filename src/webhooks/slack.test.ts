import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReferenceCandidate,
  ReferenceRequest,
  VisualBrief,
} from "../graph/contracts";
import { PipelineState } from "../graph/state";
import { ReferenceCoordinator } from "../references/coordinator";
import { ReferenceStore } from "../references/store";
import { buildReferenceRequestBlocks } from "../slack/blocks";
import {
  handleSlackActionValue,
  verifySlackSignature,
} from "./slack";

const brief: VisualBrief = {
  storyHook: "United must decide their next move",
  emotionalGoal: "Tension",
  primaryCharacter: "Player One",
  secondaryCharacters: [],
  compositionMode: "PRIMARY_WITH_BACKGROUND",
  requiredSignals: ["Decision remains pending"],
  forbiddenImplications: ["Completed transfer"],
  referenceRequirements: [
    { person: "Player One", role: "PRIMARY", required: true },
  ],
  searchInstructions: ["Use selected sources"],
  generationPromptTemplate: "Editorial portrait",
  conceptualFallbackPrompt: "Symbolic football crossroads",
  referenceWarning: null,
};

function candidate(
  request: ReferenceRequest,
  id: string,
  rank: number
): ReferenceCandidate {
  return {
    id,
    requestId: request.id,
    person: request.person,
    imageUrl: `https://cdn.example/${id}.jpg`,
    sourcePageUrl:
      "https://www.bbc.com/sport/football/articles/example",
    origin: rank === 1 ? "SELECTED_ARTICLE" : "OFFICIAL_LINK",
    rank,
    status: "AVAILABLE",
    discoveredAt: "2026-06-13T12:00:00.000Z",
  };
}

function editorialState(
  runId: string,
  candidates: ReferenceCandidate[]
): PipelineState {
  return {
    runId,
    draftCaption:
      "United need clarity before this decision starts shaping the whole summer. #MUFC",
    filteredArticles: [
      {
        url: "https://www.bbc.com/sport/football/articles/example",
        title: "United face major transfer decision",
        source: "BBC Sport",
        bodyText: "The decision remains pending.",
      },
    ],
    scoutBrief: {
      selectedArticleUrls: [
        "https://www.bbc.com/sport/football/articles/example",
      ],
      selectionReason: "Current United story",
      confidence: 0.94,
    },
    visualBrief: brief,
    referenceCandidates: candidates,
  } as PipelineState;
}

async function run(): Promise<void> {
  const secret = "test-signing-secret";
  const timestamp = "1760000000";
  const rawBody = Buffer.from('{"type":"block_actions"}');
  const signature = `v0=${crypto
    .createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody.toString("utf8")}`)
    .digest("hex")}`;

  if (
    !verifySlackSignature(
      rawBody,
      timestamp,
      signature,
      secret,
      Number(timestamp)
    )
  ) {
    throw new Error("Slack signature should verify against the exact raw body");
  }
  if (
    verifySlackSignature(
      Buffer.from('{"type":"changed"}'),
      timestamp,
      signature,
      secret,
      Number(timestamp)
    )
  ) {
    throw new Error("Changed raw body must fail Slack signature verification");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "red-devils-slack-"));
  const store = new ReferenceStore(join(tempDir, "references.db"));
  try {
    const coordinator = new ReferenceCoordinator(store);

    const approvalRequest = coordinator.createRequests(
      "run-approval",
      "thread-approval",
      brief
    )[0];
    const approvalCandidate = candidate(
      approvalRequest,
      "candidate-approval",
      1
    );
    coordinator.attachCandidates(approvalRequest.id, [approvalCandidate]);

    const blocks = buildReferenceRequestBlocks(
      editorialState("run-approval", [approvalCandidate]),
      coordinator.requestsForRun("run-approval"),
      [approvalCandidate]
    );
    const blockPayload = JSON.stringify(blocks);
    for (const required of [
      "United need clarity",
      "United face major transfer decision",
      brief.storyHook,
      approvalCandidate.imageUrl,
      approvalCandidate.sourcePageUrl,
      "Approve reference",
      "Reject & try next",
      "Use conceptual artwork",
    ]) {
      if (!blockPayload.includes(required)) {
        throw new Error(`Reference card is missing: ${required}`);
      }
    }

    const resumes: Array<{ threadId: string; value: unknown }> = [];
    const resume = async (threadId: string, value: unknown) => {
      resumes.push({ threadId, value });
    };
    const approvalValue = JSON.stringify({
      thread_id: "run-approval",
      stage: "REFERENCE_DECISION",
      request_id: approvalRequest.id,
      candidate_id: approvalCandidate.id,
      action: "APPROVED",
    });
    await handleSlackActionValue(
      approvalValue,
      coordinator,
      resume,
      "approver-1"
    );
    await handleSlackActionValue(
      approvalValue,
      coordinator,
      resume,
      "approver-1"
    );
    if (
      resumes.length !== 1 ||
      resumes[0].threadId !== "run-approval"
    ) {
      throw new Error("Reference approval should resume its graph exactly once");
    }

    const retryRequest = coordinator.createRequests(
      "run-retry",
      "thread-retry",
      brief
    )[0];
    const retryCandidates = [
      candidate(retryRequest, "candidate-first", 1),
      candidate(retryRequest, "candidate-next", 2),
    ];
    coordinator.attachCandidates(retryRequest.id, retryCandidates);
    const retryOutcome = await handleSlackActionValue(
      JSON.stringify({
        thread_id: "run-retry",
        stage: "REFERENCE_DECISION",
        request_id: retryRequest.id,
        candidate_id: retryCandidates[0].id,
        action: "REJECTED",
      }),
      coordinator,
      resume,
      "approver-2"
    );
    if (
      retryOutcome?.nextCandidate?.id !== retryCandidates[1].id ||
      resumes.some((item) => item.threadId === "run-retry")
    ) {
      throw new Error("First rejection should expose the next candidate only");
    }

    coordinator.createRequests(
      "run-conceptual",
      "thread-conceptual",
      brief
    );
    const conceptualValue = JSON.stringify({
      thread_id: "run-conceptual",
      stage: "REFERENCE_DECISION",
      action: "USE_CONCEPTUAL",
    });
    await handleSlackActionValue(
      conceptualValue,
      coordinator,
      resume,
      "approver-3"
    );
    await handleSlackActionValue(
      conceptualValue,
      coordinator,
      resume,
      "approver-3"
    );
    if (
      resumes.filter((item) => item.threadId === "run-conceptual").length !== 1
    ) {
      throw new Error("Conceptual fallback should resume its graph exactly once");
    }

    await handleSlackActionValue(
      JSON.stringify({
        thread_id: "run-final",
        stage: "FINAL_APPROVAL",
        entity_id: "generated-candidate-1",
        action: "APPROVED",
      }),
      coordinator,
      resume,
      "approver-4"
    );
    if (!resumes.some((item) => item.threadId === "run-final")) {
      throw new Error("Final approval should resume its exact graph thread");
    }
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("Slack webhook tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
