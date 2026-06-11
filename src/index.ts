import cron from "node-cron";
import express from "express";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { buildPipeline } from "./graph/pipeline";
import { createSlackRouter } from "./webhooks/slack";
import { randomUUID } from "crypto";

// ── Checkpointer (SQLite) ─────────────────────────────────────────────────────
const checkpointer = SqliteSaver.fromConnString("./checkpoints.db");

// ── Compiled graph ────────────────────────────────────────────────────────────
const pipeline = buildPipeline(checkpointer);

// ── Express server — Slack webhook + health ───────────────────────────────────
const app = express();

// Capture raw body for Slack signature verification (before other body parsers)
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use("/slack", createSlackRouter(checkpointer));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", scheduler: "running" });
});

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT ?? "4242", 10);
app.listen(WEBHOOK_PORT, () => {
  console.log(`[webhook] Express listening on http://localhost:${WEBHOOK_PORT}`);
  console.log(`[webhook] POST /slack/actions — Slack interactive handler`);
});

// ── Run one pipeline cycle ────────────────────────────────────────────────────
async function runPipeline(): Promise<void> {
  const runId = randomUUID();
  const triggerTime = new Date().toISOString();

  console.log(`\n[pipeline] ▶ Starting run  runId=${runId}  at=${triggerTime}`);

  const initialState = {
    runId,
    triggerTime,
    rawSearchHits: [],
    filteredArticles: [],
    scoutBrief: null,
    editorialBrief: null,
    draftCaption: null,
    imagePrompt: null,
    producerValidationIssues: [],
    factCheckStatus: "PENDING" as const,
    factCheckIssues: [],
    factCheckClaims: [],
    revisionFeedback: null,
    revisionCount: 0,
    generatedImageUrl: null,
    approvalStatus: "PENDING" as const,
    publishStatus: "UNPUBLISHED" as const,
    errorLog: [],
  };

  try {
    const result = await pipeline.invoke(initialState, {
      configurable: { thread_id: runId },
    });

    console.log(`[pipeline] ✔ Run complete  runId=${runId}`);
    console.log(`           approvalStatus : ${result.approvalStatus}`);
    console.log(`           publishStatus  : ${result.publishStatus}`);
    if (result.errorLog.length > 0) {
      console.warn(`[pipeline] ⚠ Errors logged:`, result.errorLog);
    }
  } catch (err) {
    console.error(`[pipeline] ✖ Run failed  runId=${runId}`, err);
  }
}

// ── Cron schedule — 08:00, 16:00, 00:00 UK time ──────────────────────────────
// TZ is set to Europe/London in .env so node-cron respects UK time automatically
const SCHEDULE = "0 8,16,0 * * *";

cron.schedule(SCHEDULE, () => {
  runPipeline().catch((err) =>
    console.error("[cron] Unhandled error in runPipeline:", err)
  );
});

console.log(
  `[scheduler] Pipeline scheduled — "${SCHEDULE}" (TZ=${process.env.TZ ?? "system"})`
);
console.log(`[scheduler] Next fires at 08:00, 16:00, 00:00 UK time`);

// ── Allow a one-off manual trigger via CLI arg ────────────────────────────────
if (process.argv.includes("--run-now")) {
  console.log("[scheduler] --run-now flag detected — triggering immediately");
  runPipeline();
}
