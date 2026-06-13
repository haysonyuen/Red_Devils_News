import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReferenceCandidate,
  ReferenceRequest,
  VisualBrief,
} from "../graph/contracts";
import { ReferenceCoordinator } from "./coordinator";
import { ReferenceStore } from "./store";

function expectThrows(label: string, action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw`);
}

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

const brief: VisualBrief = {
  storyHook: "United's transfer decision",
  emotionalGoal: "Tension and anticipation",
  primaryCharacter: "Player One",
  secondaryCharacters: ["Player Two"],
  compositionMode: "PRIMARY_WITH_SECONDARIES",
  requiredSignals: ["Primary player dominant"],
  forbiddenImplications: ["Completed signing"],
  referenceRequirements: [
    { person: "Player One", role: "PRIMARY", required: true },
    { person: "Player Two", role: "SECONDARY", required: true },
  ],
  searchInstructions: ["Use selected editorial sources"],
  generationPromptTemplate: "Editorial football composite",
  conceptualFallbackPrompt: "Symbolic football crossroads",
  referenceWarning: null,
};

const tempDir = mkdtempSync(join(tmpdir(), "red-devils-references-"));
const store = new ReferenceStore(join(tempDir, "references.db"));
const coordinator = new ReferenceCoordinator(store);

const requests = coordinator.createRequests(
  "run-1",
  "thread-1",
  brief,
  new Date("2026-06-13T12:00:00.000Z")
);
const primary = requests.find((request) => request.role === "PRIMARY");
const secondary = requests.find((request) => request.role === "SECONDARY");
if (!primary || !secondary) {
  throw new Error("Expected primary and secondary requests");
}
if (requests.some((request) => request.status !== "AWAITING_CANDIDATE")) {
  throw new Error("New requests should wait for discovered candidates");
}

const first = candidate(primary, "candidate-1", 1);
const second = candidate(primary, "candidate-2", 2);
const attached = coordinator.attachCandidates(primary.id, [first, second]);
if (
  attached.request.status !== "AWAITING_DECISION" ||
  attached.request.activeCandidateId !== first.id ||
  attached.activeCandidate?.id !== first.id
) {
  throw new Error("Discovery should activate the highest-ranked candidate");
}
if (store.listCandidatesForRequest(primary.id).length !== 2) {
  throw new Error("Discovered candidates should persist");
}

const retry = coordinator.decideCandidate(
  primary.id,
  first.id,
  "REJECTED",
  "approver-1"
);
if (
  retry.request.attempt !== 2 ||
  retry.request.activeCandidateId !== second.id ||
  retry.resolution.ready
) {
  throw new Error("First primary rejection should activate the next candidate");
}

const replay = coordinator.decideCandidate(
  primary.id,
  first.id,
  "REJECTED",
  "approver-1"
);
if (
  replay.request.attempt !== 2 ||
  replay.request.activeCandidateId !== second.id
) {
  throw new Error("Replayed rejection must not advance the request twice");
}

const approvedSecondaryCandidate = candidate(
  secondary,
  "secondary-candidate",
  1
);
coordinator.attachCandidates(secondary.id, [approvedSecondaryCandidate]);
coordinator.decideCandidate(
  secondary.id,
  approvedSecondaryCandidate.id,
  "APPROVED",
  "approver-1"
);

const fallback = coordinator.decideCandidate(
  primary.id,
  second.id,
  "REJECTED",
  "approver-1"
);
if (!fallback.resolution.ready || !fallback.resolution.fallbackToConceptual) {
  throw new Error("Second primary rejection should trigger conceptual fallback");
}

const approvedRequests = coordinator.createRequests(
  "run-2",
  "thread-2",
  {
    ...brief,
    secondaryCharacters: [],
    compositionMode: "PRIMARY_WITH_BACKGROUND",
    referenceRequirements: [brief.referenceRequirements[0]],
  },
  new Date("2026-06-13T13:00:00.000Z")
);
const approvedPrimary = approvedRequests[0];
const approvedCandidate = candidate(
  approvedPrimary,
  "approved-candidate",
  1
);
coordinator.attachCandidates(approvedPrimary.id, [approvedCandidate]);
const approval = coordinator.decideCandidate(
  approvedPrimary.id,
  approvedCandidate.id,
  "APPROVED",
  "approver-2"
);
if (
  !approval.resolution.ready ||
  approval.resolution.fallbackToConceptual ||
  approval.resolution.approved.length !== 1 ||
  approval.resolution.activeCandidates[0]?.status !== "APPROVED"
) {
  throw new Error("Approved primary candidate should complete reference gating");
}

const omittedRequests = coordinator.createRequests(
  "run-3",
  "thread-3",
  brief,
  new Date("2026-06-13T14:00:00.000Z")
);
const omittedPrimary = omittedRequests.find(
  (request) => request.role === "PRIMARY"
);
const omittedSecondary = omittedRequests.find(
  (request) => request.role === "SECONDARY"
);
if (!omittedPrimary || !omittedSecondary) {
  throw new Error("Expected primary and secondary requests");
}
const omittedPrimaryCandidate = candidate(
  omittedPrimary,
  "primary-approved",
  1
);
const rejectedSecondaryCandidate = candidate(
  omittedSecondary,
  "secondary-rejected",
  1
);
coordinator.attachCandidates(omittedPrimary.id, [omittedPrimaryCandidate]);
coordinator.attachCandidates(omittedSecondary.id, [
  rejectedSecondaryCandidate,
]);
coordinator.decideCandidate(
  omittedPrimary.id,
  omittedPrimaryCandidate.id,
  "APPROVED",
  "approver-3"
);
const omitted = coordinator.decideCandidate(
  omittedSecondary.id,
  rejectedSecondaryCandidate.id,
  "REJECTED",
  "approver-3"
);
if (
  !omitted.resolution.ready ||
  omitted.resolution.fallbackToConceptual ||
  omitted.request.status !== "OMITTED"
) {
  throw new Error("Rejected secondary should be omitted without blocking primary");
}

const conceptualRequests = coordinator.createRequests(
  "run-4",
  "thread-4",
  brief,
  new Date("2026-06-13T15:00:00.000Z")
);
const conceptual = coordinator.useConceptual(
  "run-4",
  "approver-4",
  new Date("2026-06-13T15:01:00.000Z")
);
if (
  !conceptual.ready ||
  !conceptual.fallbackToConceptual ||
  conceptualRequests.some(
    (request) => coordinator.requestsForRun("run-4")
      .find((current) => current.id === request.id)?.status === "AWAITING_CANDIDATE"
  )
) {
  throw new Error("Conceptual action should resolve every reference request");
}

const timeoutRequests = coordinator.createRequests(
  "run-5",
  "thread-5",
  {
    ...brief,
    secondaryCharacters: [],
    compositionMode: "PRIMARY_WITH_BACKGROUND",
    referenceRequirements: [brief.referenceRequirements[0]],
  },
  new Date("2026-06-13T16:00:00.000Z")
);
const timeout = coordinator.timeoutRun(
  "run-5",
  new Date("2026-06-13T16:31:00.000Z")
);
if (
  store.get(timeoutRequests[0].id)?.status !== "TIMED_OUT" ||
  !timeout.fallbackToConceptual
) {
  throw new Error("Missing primary at timeout should trigger conceptual fallback");
}

expectThrows("candidate for another request", () =>
  coordinator.attachCandidates(primary.id, [
    { ...first, id: "wrong-request", requestId: "another-request" },
  ])
);
expectThrows("unknown run", () => coordinator.resolve("missing-run"));

store.close();
rmSync(tempDir, { recursive: true, force: true });
console.log("Reference coordinator tests passed");
