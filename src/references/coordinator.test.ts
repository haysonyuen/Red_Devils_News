import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisualBrief } from "../graph/contracts";
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

const tempDir = mkdtempSync(join(tmpdir(), "red-devils-references-"));
const store = new ReferenceStore(join(tempDir, "references.db"));
const coordinator = new ReferenceCoordinator(store);

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
  searchInstructions: ["Search official club and established news sites"],
  generationPromptTemplate: "Editorial football composite",
  conceptualFallbackPrompt: "Symbolic football crossroads",
  referenceWarning: null,
};

const requests = coordinator.createRequests(
  "run-1",
  "thread-1",
  brief,
  new Date("2026-06-12T12:00:00.000Z")
);
if (requests.length !== 2) {
  throw new Error("Expected one reference request per recognizable person");
}

const primary = requests.find((request) => request.role === "PRIMARY");
const secondary = requests.find((request) => request.role === "SECONDARY");
if (!primary || !secondary) {
  throw new Error("Expected primary and secondary requests");
}

coordinator.attachUpload(
  primary.id,
  "Player One",
  "file-1",
  "https://slack.example/private/file-1",
  "user-1"
);
if (store.get(primary.id)?.status !== "AWAITING_SOURCE") {
  throw new Error("Upload alone must wait for a source URL");
}
expectThrows("approval before source", () =>
  coordinator.decide(primary.id, "APPROVED", "approver-1")
);

coordinator.attachSource(
  primary.id,
  "https://www.bbc.com/sport/football/articles/example"
);
if (store.get(primary.id)?.status !== "AWAITING_DECISION") {
  throw new Error("A file and source should wait for explicit approval");
}
coordinator.decide(primary.id, "APPROVED", "approver-1");
if (store.get(primary.id)?.status !== "APPROVED") {
  throw new Error("Explicit approval should approve the reference");
}
expectThrows("decision after terminal state", () =>
  coordinator.decide(primary.id, "REJECTED", "approver-2")
);

expectThrows("invalid source protocol", () =>
  coordinator.attachSource(secondary.id, "file:///tmp/reference.jpg")
);
expectThrows("wrong person attached to request", () =>
  coordinator.attachUpload(
    secondary.id,
    "Player One",
    "file-2",
    "https://slack.example/private/file-2",
    "user-1"
  )
);
expectThrows("unknown request", () =>
  coordinator.attachSource(
    "missing-request",
    "https://www.bbc.com/sport/football/articles/example"
  )
);

coordinator.timeoutRun("run-1", new Date("2026-06-12T12:31:00.000Z"));
const firstResolution = coordinator.resolve("run-1");
if (
  !firstResolution.ready ||
  firstResolution.fallbackToConceptual ||
  firstResolution.approved.length !== 1 ||
  firstResolution.omitted.length !== 1 ||
  firstResolution.pending.length !== 0
) {
  throw new Error("Missing secondary should be omitted after timeout");
}

const rejectionRequests = coordinator.createRequests(
  "run-2",
  "thread-2",
  { ...brief, secondaryCharacters: [], compositionMode: "PRIMARY_WITH_BACKGROUND", referenceRequirements: [brief.referenceRequirements[0]] },
  new Date("2026-06-12T13:00:00.000Z")
);
const rejectedPrimary = rejectionRequests[0];
coordinator.attachUpload(
  rejectedPrimary.id,
  rejectedPrimary.person,
  "file-3",
  "https://slack.example/private/file-3",
  "user-1"
);
coordinator.attachSource(
  rejectedPrimary.id,
  "https://www.bbc.com/sport/football/articles/example"
);
coordinator.decide(rejectedPrimary.id, "REJECTED", "approver-1");
const retry = store.get(rejectedPrimary.id);
if (
  retry?.status !== "AWAITING_UPLOAD" ||
  retry.attempt !== 2 ||
  retry.slackFileId !== null ||
  retry.sourcePageUrl !== null
) {
  throw new Error("First primary rejection should request one clean retry");
}

coordinator.attachUpload(
  rejectedPrimary.id,
  rejectedPrimary.person,
  "file-4",
  "https://slack.example/private/file-4",
  "user-1"
);
coordinator.attachSource(
  rejectedPrimary.id,
  "https://www.bbc.com/sport/football/articles/example"
);
coordinator.decide(rejectedPrimary.id, "REJECTED", "approver-1");
const rejectedResolution = coordinator.resolve("run-2");
if (!rejectedResolution.ready || !rejectedResolution.fallbackToConceptual) {
  throw new Error("Second primary rejection should trigger conceptual fallback");
}

const timeoutRequests = coordinator.createRequests(
  "run-3",
  "thread-3",
  { ...brief, secondaryCharacters: [], compositionMode: "PRIMARY_WITH_BACKGROUND", referenceRequirements: [brief.referenceRequirements[0]] },
  new Date("2026-06-12T14:00:00.000Z")
);
coordinator.timeoutRun("run-3", new Date("2026-06-12T14:31:00.000Z"));
if (
  store.get(timeoutRequests[0].id)?.status !== "TIMED_OUT" ||
  !coordinator.resolve("run-3").fallbackToConceptual
) {
  throw new Error("Missing primary at timeout should trigger conceptual fallback");
}

expectThrows("unknown run", () => coordinator.resolve("missing-run"));

store.close();
rmSync(tempDir, { recursive: true, force: true });
console.log("Reference coordinator tests passed");
