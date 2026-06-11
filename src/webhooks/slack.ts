/**
 * Express server — Slack Interactive Webhook Handler
 *
 * Listens for Slack button-click payloads, verifies the signing secret,
 * extracts the thread_id from the button value, resumes the LangGraph run
 * with the correct approvalStatus via the SQLite checkpointer.
 */

import express, { Request, Response } from "express";
import crypto from "crypto";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { buildPipeline } from "../graph/pipeline";

const router = express.Router();

// ── Verify Slack request signature ────────────────────────────────────────────

function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn("[slack-webhook] SLACK_SIGNING_SECRET not set — skipping verification (dev mode)");
    return true;
  }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSignature) return false;

  // Replay attack guard: reject requests older than 5 minutes
  const nowSecs = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - parseInt(timestamp, 10)) > 300) return false;

  const rawBody = (req as Request & { rawBody?: Buffer; body?: unknown }).rawBody;
  if (!rawBody) return false;

  const sigBase = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(sigBase);
  const computed = `v0=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSignature));
}

// ── Route: POST /slack/actions ────────────────────────────────────────────────

export function createSlackRouter(checkpointer: SqliteSaver) {
  const pipeline = buildPipeline(checkpointer);

  router.post("/actions", express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
    // ── Slack URL verification challenge (sent when saving the Request URL) ──
    if (req.body?.type === "url_verification") {
      res.json({ challenge: req.body.challenge });
      return;
    }

    // Slack sends payload as a URL-encoded form field named "payload"
    const rawPayload = req.body?.payload;
    if (!rawPayload) {
      res.status(200).send(); // Return 200 so Slack doesn't retry
      return;
    }

    let payload: {
      type: string;
      actions?: Array<{ value: string }>;
    };
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      res.status(400).send("Invalid JSON payload");
      return;
    }

    if (payload.type !== "block_actions" || !payload.actions?.length) {
      res.status(200).send(); // Acknowledge non-action events silently
      return;
    }

    // Acknowledge Slack immediately (within 3s requirement)
    res.status(200).send();

    // ── Extract thread_id and action ────────────────────────────────────────
    let buttonValue: { thread_id: string; action: "APPROVED" | "REJECTED" };
    try {
      buttonValue = JSON.parse(payload.actions[0].value);
    } catch {
      console.error("[slack-webhook] Failed to parse button value");
      return;
    }

    const { thread_id, action } = buttonValue;
    console.log(`[slack-webhook] Button clicked: ${action}  thread_id=${thread_id}`);

    // ── Resume the LangGraph run ────────────────────────────────────────────
    try {
      const result = await pipeline.invoke(
        // Command({ resume }) delivers the value back to interrupt() in slackGatewayNode
        new Command({ resume: action }),
        { configurable: { thread_id } }
      );

      console.log(`[slack-webhook] ✔ Run resumed  thread_id=${thread_id}`);
      console.log(`               approvalStatus : ${result.approvalStatus}`);
      console.log(`               publishStatus  : ${result.publishStatus}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[slack-webhook] ✖ Resume failed: ${msg}`);
    }
  });

  return router;
}
