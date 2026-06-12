import crypto from "node:crypto";
import express, { Request, Response } from "express";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { WebClient } from "@slack/web-api";
import { buildPipeline } from "../graph/pipeline";
import {
  ReferenceCoordinator,
  ReferenceResolution,
} from "../references/coordinator";
import { getReferenceCoordinator } from "../references/runtime";
import { buildReferenceDecisionBlocks } from "../slack/blocks";

type RawBodyRequest = Request & { rawBody?: Buffer };
type ResumeGraph = (threadId: string, value: unknown) => Promise<void>;
type PostMessage = (message: Record<string, unknown>) => Promise<void>;

interface SlackEventDependencies {
  coordinator: ReferenceCoordinator;
  channelId: string;
  postMessage: PostMessage;
}

interface SlackActionValue {
  thread_id: string;
  stage: "REFERENCE_DECISION" | "CANDIDATE_SELECTION" | "FINAL_APPROVAL";
  entity_id: string;
  action: string;
}

export function verifySlackSignature(
  rawBody: Buffer,
  timestamp: string,
  slackSignature: string,
  signingSecret: string,
  nowSecs = Math.floor(Date.now() / 1000)
): boolean {
  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (
    !Number.isFinite(parsedTimestamp) ||
    Math.abs(nowSecs - parsedTimestamp) > 300
  ) {
    return false;
  }
  const computed = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody.toString("utf8")}`)
    .digest("hex")}`;
  const expected = Buffer.from(computed);
  const actual = Buffer.from(slackSignature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function extractSourceUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>]+/i);
  return match?.[0].replace(/[),.;]+$/, "") ?? null;
}

function findReferenceRequest(
  coordinator: ReferenceCoordinator,
  threadTs: string,
  text: string
) {
  const pending = coordinator
    .requestsForThread(threadTs)
    .filter((request) =>
      ["AWAITING_UPLOAD", "AWAITING_SOURCE"].includes(request.status)
    );
  const normalizedText = text.toLocaleLowerCase();
  const named = pending.filter((request) =>
    normalizedText.includes(request.person.toLocaleLowerCase())
  );
  if (named.length === 1) return named[0];
  if (named.length === 0 && pending.length === 1) return pending[0];
  return null;
}

export function createSlackEventHandler({
  coordinator,
  channelId,
  postMessage,
}: SlackEventDependencies) {
  const seenEventIds = new Set<string>();

  return async (
    payload: Record<string, unknown>
  ): Promise<{ challenge?: string; handled?: boolean }> => {
    if (
      payload.type === "url_verification" &&
      typeof payload.challenge === "string"
    ) {
      return { challenge: payload.challenge };
    }
    if (
      payload.type !== "event_callback" ||
      typeof payload.event_id !== "string"
    ) {
      return { handled: false };
    }
    if (seenEventIds.has(payload.event_id)) return { handled: false };

    const event = payload.event as Record<string, unknown> | undefined;
    if (
      !event ||
      event.type !== "message" ||
      event.channel !== channelId ||
      typeof event.thread_ts !== "string" ||
      typeof event.text !== "string" ||
      typeof event.user !== "string" ||
      !Array.isArray(event.files) ||
      event.files.length === 0
    ) {
      return { handled: false };
    }

    const file = event.files[0] as Record<string, unknown>;
    const fileId = typeof file.id === "string" ? file.id : null;
    const privateUrl =
      typeof file.url_private_download === "string"
        ? file.url_private_download
        : typeof file.url_private === "string"
          ? file.url_private
          : null;
    const sourceUrl = extractSourceUrl(event.text);
    const request = findReferenceRequest(
      coordinator,
      event.thread_ts,
      event.text
    );
    if (!request || !fileId || !privateUrl || !sourceUrl) {
      return { handled: false };
    }

    coordinator.attachUpload(
      request.id,
      request.person,
      fileId,
      privateUrl,
      event.user
    );
    const ready = coordinator.attachSource(request.id, sourceUrl);
    await postMessage({
      channel: channelId,
      thread_ts: event.thread_ts,
      text: `Approve reference for ${ready.person}`,
      blocks: buildReferenceDecisionBlocks(ready.runId, ready),
    });
    seenEventIds.add(payload.event_id);
    return { handled: true };
  };
}

export async function handleSlackActionValue(
  rawValue: string,
  coordinator: ReferenceCoordinator,
  resumeGraph: ResumeGraph,
  userId: string
): Promise<ReferenceResolution | null> {
  const parsed = JSON.parse(rawValue) as Partial<SlackActionValue>;
  if (!parsed.thread_id || !parsed.action) {
    throw new Error("Slack action is missing thread or action");
  }
  const stage = parsed.stage ?? "FINAL_APPROVAL";

  if (stage === "REFERENCE_DECISION") {
    if (
      !parsed.entity_id ||
      !["APPROVED", "REJECTED"].includes(parsed.action)
    ) {
      throw new Error("Reference action is invalid");
    }
    coordinator.decide(
      parsed.entity_id,
      parsed.action as "APPROVED" | "REJECTED",
      userId
    );
    const resolution = coordinator.resolve(parsed.thread_id);
    if (resolution.ready) {
      await resumeGraph(parsed.thread_id, {
        stage: "REFERENCE_RESOLUTION",
        resolution,
      });
    }
    return resolution;
  }

  if (
    stage === "CANDIDATE_SELECTION" &&
    (!parsed.entity_id ||
      !["SELECT", "REGENERATE", "REJECT"].includes(parsed.action))
  ) {
    throw new Error("Candidate selection action is invalid");
  }
  if (
    stage === "FINAL_APPROVAL" &&
    !["APPROVED", "REJECTED"].includes(parsed.action)
  ) {
    throw new Error("Final approval action is invalid");
  }

  await resumeGraph(
    parsed.thread_id,
    stage === "FINAL_APPROVAL" ? parsed.action : parsed
  );
  return null;
}

function captureRawBody(
  req: RawBodyRequest,
  _res: Response,
  buffer: Buffer
): void {
  req.rawBody = buffer;
}

function requestIsVerified(req: RawBodyRequest): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return true;
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  return (
    Boolean(req.rawBody) &&
    typeof timestamp === "string" &&
    typeof signature === "string" &&
    verifySlackSignature(req.rawBody as Buffer, timestamp, signature, secret)
  );
}

export function createSlackRouter(checkpointer: SqliteSaver) {
  const router = express.Router();
  const pipeline = buildPipeline(checkpointer);
  const coordinator = getReferenceCoordinator();
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const channelId = process.env.SLACK_CHANNEL_ID ?? "";
  const resumeGraph: ResumeGraph = async (threadId, value) => {
    await pipeline.invoke(new Command({ resume: value }), {
      configurable: { thread_id: threadId },
    });
  };
  const eventHandler = createSlackEventHandler({
    coordinator,
    channelId,
    postMessage: async (message) => {
      await slack.chat.postMessage(message as never);
    },
  });

  router.post(
    "/events",
    express.json({ verify: captureRawBody }),
    async (req: RawBodyRequest, res: Response) => {
      if (!requestIsVerified(req)) {
        res.status(401).send("Invalid Slack signature");
        return;
      }
      const payload = req.body as Record<string, unknown>;
      if (payload.type === "url_verification") {
        const result = await eventHandler(payload);
        res.json({ challenge: result.challenge });
        return;
      }
      res.status(200).send();
      eventHandler(payload).catch((error) =>
        console.error("[slack-events] Event handling failed:", error)
      );
    }
  );

  router.post(
    "/actions",
    express.urlencoded({ extended: true, verify: captureRawBody }),
    async (req: RawBodyRequest, res: Response) => {
      if (!requestIsVerified(req)) {
        res.status(401).send("Invalid Slack signature");
        return;
      }
      const rawPayload = req.body?.payload;
      if (typeof rawPayload !== "string") {
        res.status(200).send();
        return;
      }
      let payload: {
        type: string;
        user?: { id?: string };
        actions?: Array<{ value?: string }>;
      };
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        res.status(400).send("Invalid JSON payload");
        return;
      }
      res.status(200).send();
      const value = payload.actions?.[0]?.value;
      if (payload.type !== "block_actions" || !value) return;
      handleSlackActionValue(
        value,
        coordinator,
        resumeGraph,
        payload.user?.id ?? "unknown"
      ).catch((error) =>
        console.error("[slack-actions] Action handling failed:", error)
      );
    }
  );

  return router;
}
