import { DatabaseSync } from "node:sqlite";
import {
  ReferenceCandidate,
  ReferenceCandidateStatus,
  ReferenceRequest,
  ReferenceStatus,
} from "../graph/contracts";

type ReferenceRow = {
  id: string;
  run_id: string;
  thread_ts: string;
  person: string;
  role: "PRIMARY" | "SECONDARY";
  required: number;
  status: ReferenceStatus;
  attempt: number;
  active_candidate_id: string | null;
  approver_id: string | null;
  decision_at: string | null;
  deadline_at: string;
};

type ReferenceCandidateRow = {
  id: string;
  request_id: string;
  person: string;
  image_url: string;
  source_page_url: string;
  origin: "SELECTED_ARTICLE" | "OFFICIAL_LINK";
  rank: number;
  status: ReferenceCandidateStatus;
  discovered_at: string;
};

function toReferenceRequest(row: ReferenceRow): ReferenceRequest {
  return {
    id: row.id,
    runId: row.run_id,
    threadTs: row.thread_ts,
    person: row.person,
    role: row.role,
    required: row.required === 1,
    status: row.status,
    attempt: row.attempt,
    activeCandidateId: row.active_candidate_id,
    approverId: row.approver_id,
    decisionAt: row.decision_at,
    deadlineAt: row.deadline_at,
  };
}

function toReferenceCandidate(row: ReferenceCandidateRow): ReferenceCandidate {
  return {
    id: row.id,
    requestId: row.request_id,
    person: row.person,
    imageUrl: row.image_url,
    sourcePageUrl: row.source_page_url,
    origin: row.origin,
    rank: row.rank,
    status: row.status,
    discoveredAt: row.discovered_at,
  };
}

export class ReferenceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reference_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        person TEXT NOT NULL,
        role TEXT NOT NULL,
        required INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        active_candidate_id TEXT,
        approver_id TEXT,
        decision_at TEXT,
        deadline_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reference_requests_run_id
        ON reference_requests(run_id);
      CREATE INDEX IF NOT EXISTS reference_requests_thread_ts
        ON reference_requests(thread_ts);
      CREATE TABLE IF NOT EXISTS reference_candidates (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        person TEXT NOT NULL,
        image_url TEXT NOT NULL,
        source_page_url TEXT NOT NULL,
        origin TEXT NOT NULL,
        rank INTEGER NOT NULL,
        status TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        FOREIGN KEY(request_id) REFERENCES reference_requests(id)
      );
      CREATE INDEX IF NOT EXISTS reference_candidates_request_id
        ON reference_candidates(request_id, rank);
    `);
    const columns = this.db
      .prepare("PRAGMA table_info(reference_requests)")
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "active_candidate_id")) {
      this.db.exec(
        "ALTER TABLE reference_requests ADD COLUMN active_candidate_id TEXT"
      );
    }
  }

  insert(request: ReferenceRequest): void {
    this.db
      .prepare(`
        INSERT INTO reference_requests (
          id, run_id, thread_ts, person, role, required, status, attempt,
          active_candidate_id, approver_id, decision_at, deadline_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        request.id,
        request.runId,
        request.threadTs,
        request.person,
        request.role,
        request.required ? 1 : 0,
        request.status,
        request.attempt,
        request.activeCandidateId,
        request.approverId,
        request.decisionAt,
        request.deadlineAt
      );
  }

  insertCandidate(candidate: ReferenceCandidate): void {
    this.db
      .prepare(`
        INSERT INTO reference_candidates (
          id, request_id, person, image_url, source_page_url, origin, rank,
          status, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        candidate.id,
        candidate.requestId,
        candidate.person,
        candidate.imageUrl,
        candidate.sourcePageUrl,
        candidate.origin,
        candidate.rank,
        candidate.status,
        candidate.discoveredAt
      );
  }

  listCandidatesForRequest(requestId: string): ReferenceCandidate[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM reference_candidates
        WHERE request_id = ?
        ORDER BY rank ASC, id ASC
      `)
      .all(requestId) as unknown as ReferenceCandidateRow[];
    return rows.map(toReferenceCandidate);
  }

  listCandidatesForRun(runId: string): ReferenceCandidate[] {
    const rows = this.db
      .prepare(`
        SELECT candidate.*
        FROM reference_candidates AS candidate
        JOIN reference_requests AS request
          ON request.id = candidate.request_id
        WHERE request.run_id = ?
        ORDER BY request.role ASC, request.person ASC, candidate.rank ASC,
          candidate.id ASC
      `)
      .all(runId) as unknown as ReferenceCandidateRow[];
    return rows.map(toReferenceCandidate);
  }

  getCandidate(id: string): ReferenceCandidate | null {
    const row = this.db
      .prepare("SELECT * FROM reference_candidates WHERE id = ?")
      .get(id) as ReferenceCandidateRow | undefined;
    return row ? toReferenceCandidate(row) : null;
  }

  updateCandidate(candidate: ReferenceCandidate): void {
    const result = this.db
      .prepare(`
        UPDATE reference_candidates SET
          status = ?
        WHERE id = ?
      `)
      .run(candidate.status, candidate.id);
    if (result.changes !== 1) {
      throw new Error(`Unknown reference candidate: ${candidate.id}`);
    }
  }

  get(id: string): ReferenceRequest | null {
    const row = this.db
      .prepare("SELECT * FROM reference_requests WHERE id = ?")
      .get(id) as ReferenceRow | undefined;
    return row ? toReferenceRequest(row) : null;
  }

  listForRun(runId: string): ReferenceRequest[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM reference_requests WHERE run_id = ? ORDER BY role, person"
      )
      .all(runId) as unknown as ReferenceRow[];
    return rows.map(toReferenceRequest);
  }

  listForThread(threadTs: string): ReferenceRequest[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM reference_requests WHERE thread_ts = ? ORDER BY role, person"
      )
      .all(threadTs) as unknown as ReferenceRow[];
    return rows.map(toReferenceRequest);
  }

  listExpiredRunIds(nowIso: string): string[] {
    const rows = this.db
      .prepare(`
        SELECT DISTINCT run_id
        FROM reference_requests
        WHERE status IN (
          'AWAITING_CANDIDATE',
          'AWAITING_DECISION'
        )
          AND deadline_at <= ?
      `)
      .all(nowIso) as unknown as Array<{ run_id: string }>;
    return rows.map((row) => row.run_id);
  }

  updateThreadForRun(runId: string, threadTs: string): void {
    this.db
      .prepare("UPDATE reference_requests SET thread_ts = ? WHERE run_id = ?")
      .run(threadTs, runId);
  }

  update(request: ReferenceRequest): void {
    const result = this.db
      .prepare(`
        UPDATE reference_requests SET
          status = ?,
          attempt = ?,
          active_candidate_id = ?,
          approver_id = ?,
          decision_at = ?,
          deadline_at = ?
        WHERE id = ?
      `)
      .run(
        request.status,
        request.attempt,
        request.activeCandidateId,
        request.approverId,
        request.decisionAt,
        request.deadlineAt,
        request.id
      );
    if (result.changes !== 1) {
      throw new Error(`Unknown reference request: ${request.id}`);
    }
  }

  close(): void {
    this.db.close();
  }
}
