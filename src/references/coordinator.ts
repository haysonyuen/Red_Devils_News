import { randomUUID } from "node:crypto";
import {
  ReferenceCandidate,
  ReferenceRequest,
  ReferenceStatus,
  VisualBrief,
} from "../graph/contracts";
import { ReferenceStore } from "./store";

const ACTIVE_STATUSES: ReferenceStatus[] = [
  "AWAITING_CANDIDATE",
  "AWAITING_UPLOAD",
  "AWAITING_SOURCE",
  "AWAITING_DECISION",
];

export interface ReferenceResolution {
  ready: boolean;
  fallbackToConceptual: boolean;
  approved: ReferenceRequest[];
  omitted: ReferenceRequest[];
  pending: ReferenceRequest[];
  activeCandidates: ReferenceCandidate[];
}

export interface ReferenceDecisionResult {
  request: ReferenceRequest;
  activeCandidate: ReferenceCandidate | null;
  resolution: ReferenceResolution;
  changed: boolean;
}

function normalizePerson(person: string): string {
  return person.trim().toLocaleLowerCase();
}

function nextCollectionStatus(request: ReferenceRequest): ReferenceStatus {
  if (request.slackFileId && request.sourcePageUrl) {
    return "AWAITING_DECISION";
  }
  return request.slackFileId ? "AWAITING_SOURCE" : "AWAITING_UPLOAD";
}

export class ReferenceCoordinator {
  constructor(
    private readonly store: ReferenceStore,
    private readonly timeoutMinutes = 30
  ) {}

  createRequests(
    runId: string,
    threadTs: string,
    brief: VisualBrief,
    createdAt = new Date()
  ): ReferenceRequest[] {
    if (!runId || !threadTs) {
      throw new Error("Reference requests require run and thread IDs");
    }
    if (this.store.listForRun(runId).length > 0) {
      throw new Error(`Reference requests already exist for run: ${runId}`);
    }

    const deadlineAt = new Date(
      createdAt.getTime() + this.timeoutMinutes * 60_000
    ).toISOString();
    const requests = brief.referenceRequirements.map((requirement) => ({
      id: randomUUID(),
      runId,
      threadTs,
      person: requirement.person,
      role: requirement.role,
      required: requirement.required,
      status: "AWAITING_CANDIDATE" as const,
      attempt: 1,
      activeCandidateId: null,
      slackFileId: null,
      privateDownloadUrl: null,
      sourcePageUrl: null,
      uploaderId: null,
      approverId: null,
      decisionAt: null,
      deadlineAt,
    }));
    requests.forEach((request) => this.store.insert(request));
    return requests;
  }

  attachCandidates(
    requestId: string,
    candidates: ReferenceCandidate[]
  ): ReferenceDecisionResult {
    const request = this.requireActive(requestId);
    for (const candidate of candidates) {
      if (
        candidate.requestId !== request.id ||
        normalizePerson(candidate.person) !== normalizePerson(request.person)
      ) {
        throw new Error("Reference candidate does not match its request");
      }
    }

    const existing = this.store.listCandidatesForRequest(request.id);
    if (existing.length > 0) {
      return this.decisionResult(request, false);
    }

    const ranked = [...candidates]
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
      .slice(0, 3);
    ranked.forEach((candidate) => this.store.insertCandidate(candidate));
    const activeCandidate = ranked[0] ?? null;
    const updated: ReferenceRequest = activeCandidate
      ? {
          ...request,
          status: "AWAITING_DECISION",
          activeCandidateId: activeCandidate.id,
        }
      : request.role === "SECONDARY"
        ? {
            ...request,
            status: "OMITTED",
            activeCandidateId: null,
          }
        : request;
    this.store.update(updated);
    return this.decisionResult(updated, true);
  }

  decideCandidate(
    requestId: string,
    candidateId: string,
    decision: "APPROVED" | "REJECTED",
    approverId: string,
    decidedAt = new Date()
  ): ReferenceDecisionResult {
    const request = this.requireRequest(requestId);
    const candidate = this.requireCandidate(candidateId);
    if (candidate.requestId !== request.id) {
      throw new Error("Reference candidate does not belong to its request");
    }
    if (candidate.status !== "AVAILABLE") {
      return this.decisionResult(request, false);
    }
    if (
      request.status !== "AWAITING_DECISION" ||
      request.activeCandidateId !== candidate.id
    ) {
      throw new Error("Reference candidate is not awaiting a decision");
    }

    const decisionAt = decidedAt.toISOString();
    if (decision === "APPROVED") {
      this.store.updateCandidate({ ...candidate, status: "APPROVED" });
      const approved: ReferenceRequest = {
        ...request,
        status: "APPROVED",
        approverId,
        decisionAt,
      };
      this.store.update(approved);
      return this.decisionResult(approved, true);
    }

    this.store.updateCandidate({ ...candidate, status: "REJECTED" });
    const nextCandidate =
      request.role === "PRIMARY" && request.attempt < 2
        ? this.store
            .listCandidatesForRequest(request.id)
            .find((item) => item.status === "AVAILABLE") ?? null
        : null;
    const rejected: ReferenceRequest = nextCandidate
      ? {
          ...request,
          status: "AWAITING_DECISION",
          attempt: request.attempt + 1,
          activeCandidateId: nextCandidate.id,
          approverId,
          decisionAt,
        }
      : {
          ...request,
          status: request.role === "SECONDARY" ? "OMITTED" : "REJECTED",
          activeCandidateId: null,
          approverId,
          decisionAt,
        };
    this.store.update(rejected);
    return this.decisionResult(rejected, true);
  }

  useConceptual(
    runId: string,
    approverId: string,
    decidedAt = new Date()
  ): ReferenceResolution {
    const decisionAt = decidedAt.toISOString();
    for (const request of this.requireRun(runId)) {
      if (!ACTIVE_STATUSES.includes(request.status)) continue;
      this.store.update({
        ...request,
        status: request.role === "PRIMARY" ? "REJECTED" : "OMITTED",
        activeCandidateId: null,
        approverId,
        decisionAt,
      });
    }
    return this.resolve(runId);
  }

  attachUpload(
    requestId: string,
    person: string,
    slackFileId: string,
    privateDownloadUrl: string,
    uploaderId: string
  ): ReferenceRequest {
    const request = this.requireActive(requestId);
    if (normalizePerson(person) !== normalizePerson(request.person)) {
      throw new Error("Uploaded reference does not match the requested person");
    }
    if (!slackFileId || !privateDownloadUrl || !uploaderId) {
      throw new Error("Reference upload metadata is incomplete");
    }

    const updated: ReferenceRequest = {
      ...request,
      slackFileId,
      privateDownloadUrl,
      uploaderId,
    };
    updated.status = nextCollectionStatus(updated);
    this.store.update(updated);
    return updated;
  }

  attachSource(requestId: string, sourcePageUrl: string): ReferenceRequest {
    const request = this.requireActive(requestId);
    let source: URL;
    try {
      source = new URL(sourcePageUrl);
    } catch {
      throw new Error("Reference source URL is invalid");
    }
    if (!["http:", "https:"].includes(source.protocol)) {
      throw new Error("Reference source URL must use HTTP or HTTPS");
    }

    const updated: ReferenceRequest = {
      ...request,
      sourcePageUrl: source.toString(),
    };
    updated.status = nextCollectionStatus(updated);
    this.store.update(updated);
    return updated;
  }

  decide(
    requestId: string,
    decision: "APPROVED" | "REJECTED",
    approverId: string,
    decidedAt = new Date()
  ): ReferenceRequest {
    const request = this.requireRequest(requestId);
    if (request.status !== "AWAITING_DECISION") {
      throw new Error("Reference is not ready for a decision");
    }
    if (!request.slackFileId || !request.sourcePageUrl) {
      throw new Error("Reference requires both an upload and source URL");
    }

    if (decision === "REJECTED" && request.role === "PRIMARY" && request.attempt < 2) {
      const retry: ReferenceRequest = {
        ...request,
        status: "AWAITING_UPLOAD",
        attempt: 2,
        slackFileId: null,
        privateDownloadUrl: null,
        sourcePageUrl: null,
        uploaderId: null,
        approverId,
        decisionAt: decidedAt.toISOString(),
      };
      this.store.update(retry);
      return retry;
    }

    const status: ReferenceStatus =
      decision === "APPROVED"
        ? "APPROVED"
        : request.role === "SECONDARY"
          ? "OMITTED"
          : "REJECTED";
    const updated: ReferenceRequest = {
      ...request,
      status,
      approverId,
      decisionAt: decidedAt.toISOString(),
    };
    this.store.update(updated);
    return updated;
  }

  timeoutRun(runId: string, now = new Date()): ReferenceResolution {
    const requests = this.requireRun(runId);
    for (const request of requests) {
      if (
        ACTIVE_STATUSES.includes(request.status) &&
        new Date(request.deadlineAt).getTime() <= now.getTime()
      ) {
        this.store.update({
          ...request,
          status: request.role === "PRIMARY" ? "TIMED_OUT" : "OMITTED",
          activeCandidateId: null,
          decisionAt: now.toISOString(),
        });
      }
    }
    return this.resolve(runId);
  }

  resolve(runId: string): ReferenceResolution {
    const requests = this.requireRun(runId);
    const approved = requests.filter((request) => request.status === "APPROVED");
    const omitted = requests.filter((request) =>
      ["OMITTED", "REJECTED"].includes(request.status)
    );
    const pending = requests.filter((request) =>
      ACTIVE_STATUSES.includes(request.status)
    );
    const primary = requests.find((request) => request.role === "PRIMARY");
    const fallbackToConceptual =
      !primary || ["REJECTED", "TIMED_OUT"].includes(primary.status);
    const activeCandidates = requests
      .map((request) =>
        request.activeCandidateId
          ? this.store.getCandidate(request.activeCandidateId)
          : null
      )
      .filter((candidate): candidate is ReferenceCandidate => candidate !== null);

    return {
      ready: pending.length === 0,
      fallbackToConceptual,
      approved,
      omitted,
      pending,
      activeCandidates,
    };
  }

  requestsForRun(runId: string): ReferenceRequest[] {
    return this.store.listForRun(runId);
  }

  requestsForThread(threadTs: string): ReferenceRequest[] {
    return this.store.listForThread(threadTs);
  }

  expiredRunIds(now = new Date()): string[] {
    return this.store.listExpiredRunIds(now.toISOString());
  }

  updateThread(runId: string, threadTs: string): void {
    this.requireRun(runId);
    this.store.updateThreadForRun(runId, threadTs);
  }

  private requireRequest(requestId: string): ReferenceRequest {
    const request = this.store.get(requestId);
    if (!request) throw new Error(`Unknown reference request: ${requestId}`);
    return request;
  }

  private requireCandidate(candidateId: string): ReferenceCandidate {
    const candidate = this.store.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`Unknown reference candidate: ${candidateId}`);
    }
    return candidate;
  }

  private decisionResult(
    request: ReferenceRequest,
    changed: boolean
  ): ReferenceDecisionResult {
    return {
      request,
      activeCandidate: request.activeCandidateId
        ? this.store.getCandidate(request.activeCandidateId)
        : null,
      resolution: this.resolve(request.runId),
      changed,
    };
  }

  private requireActive(requestId: string): ReferenceRequest {
    const request = this.requireRequest(requestId);
    if (!ACTIVE_STATUSES.includes(request.status)) {
      throw new Error("Reference request is already resolved");
    }
    return request;
  }

  private requireRun(runId: string): ReferenceRequest[] {
    const requests = this.store.listForRun(runId);
    if (requests.length === 0) {
      throw new Error(`Unknown reference run: ${runId}`);
    }
    return requests;
  }
}
