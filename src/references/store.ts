import { DatabaseSync } from "node:sqlite";
import { ReferenceRequest, ReferenceStatus } from "../graph/contracts";

type ReferenceRow = {
  id: string;
  run_id: string;
  thread_ts: string;
  person: string;
  role: "PRIMARY" | "SECONDARY";
  required: number;
  status: ReferenceStatus;
  attempt: number;
  slack_file_id: string | null;
  private_download_url: string | null;
  source_page_url: string | null;
  uploader_id: string | null;
  approver_id: string | null;
  decision_at: string | null;
  deadline_at: string;
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
    slackFileId: row.slack_file_id,
    privateDownloadUrl: row.private_download_url,
    sourcePageUrl: row.source_page_url,
    uploaderId: row.uploader_id,
    approverId: row.approver_id,
    decisionAt: row.decision_at,
    deadlineAt: row.deadline_at,
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
        slack_file_id TEXT,
        private_download_url TEXT,
        source_page_url TEXT,
        uploader_id TEXT,
        approver_id TEXT,
        decision_at TEXT,
        deadline_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reference_requests_run_id
        ON reference_requests(run_id);
      CREATE INDEX IF NOT EXISTS reference_requests_thread_ts
        ON reference_requests(thread_ts);
    `);
  }

  insert(request: ReferenceRequest): void {
    this.db
      .prepare(`
        INSERT INTO reference_requests (
          id, run_id, thread_ts, person, role, required, status, attempt,
          slack_file_id, private_download_url, source_page_url, uploader_id,
          approver_id, decision_at, deadline_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        request.slackFileId,
        request.privateDownloadUrl,
        request.sourcePageUrl,
        request.uploaderId,
        request.approverId,
        request.decisionAt,
        request.deadlineAt
      );
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
        WHERE status IN ('AWAITING_UPLOAD', 'AWAITING_SOURCE', 'AWAITING_DECISION')
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
          slack_file_id = ?,
          private_download_url = ?,
          source_page_url = ?,
          uploader_id = ?,
          approver_id = ?,
          decision_at = ?,
          deadline_at = ?
        WHERE id = ?
      `)
      .run(
        request.status,
        request.attempt,
        request.slackFileId,
        request.privateDownloadUrl,
        request.sourcePageUrl,
        request.uploaderId,
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
