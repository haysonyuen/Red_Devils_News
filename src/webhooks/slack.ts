import crypto from "node:crypto";
import express, { Request, Response } from "express";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { WebClient } from "@slack/web-api";
import {
  ReferenceCandidate,
  ReferenceRequest,
} from "../graph/contracts";
import { buildPipeline } from "../graph/pipeline";
import {
  ReferenceCoordinator,
  ReferenceResolution,
} from "../references/coordinator";
import { getReferenceCoordinator } from "../references/runtime";
import {
  buildConceptualReferenceBlock,
  buildReferenceCandidateBlocks,
} from "../slack/blocks";

type RawBodyRequest = Request & { rawBody?: Buffer };
type ResumeGraph = (threadId: string, value: unknown) => Promise<void>;

interface SlackActionValue {
  thread_id: string;
  stage: "REFERENCE_DECISION" | "CANDIDATE_SELECTION" | "FINAL_APPROVAL";
  entity_id?: string;
  request_id?: string;
  candidate_id?: string;
  action: string;
}

export interface ReferenceActionOutcome {
  resolution: ReferenceResolution;
  nextCandidate: ReferenceCandidate | null;
  request: ReferenceRequest | null;
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

export async function handleSlackActionValue(
  rawValue: string,
  coordinator: ReferenceCoordinator,
  resumeGraph: ResumeGraph,
  userId: string
): Promise<ReferenceActionOutcome | null> {
  const parsed = JSON.parse(rawValue) as Partial<SlackActionValue>;
  if (!parsed.thread_id || !parsed.action) {
    throw new Error("Slack action is missing thread or action");
  }
  const stage = parsed.stage ?? "FINAL_APPROVAL";

  if (stage === "REFERENCE_DECISION") {
    if (parsed.action === "USE_CONCEPTUAL") {
      const existing = coordinator.resolve(parsed.thread_id);
      if (existing.ready) {
        return { resolution: existing, nextCandidate: null, request: null };
      }
      const resolution = coordinator.useConceptual(
        parsed.thread_id,
        userId
      );
      await resumeGraph(parsed.thread_id, {
        stage: "REFERENCE_RESOLUTION",
        resolution,
      });
      return { resolution, nextCandidate: null, request: null };
    }
    if (
      !parsed.request_id ||
      !parsed.candidate_id ||
      !["APPROVED", "REJECTED"].includes(parsed.action)
    ) {
      throw new Error("Reference action is invalid");
    }
    const result = coordinator.decideCandidate(
      parsed.request_id,
      parsed.candidate_id,
      parsed.action as "APPROVED" | "REJECTED",
      userId
    );
    if (result.changed && result.resolution.ready) {
      await resumeGraph(parsed.thread_id, {
        stage: "REFERENCE_RESOLUTION",
        resolution: result.resolution,
      });
    }
    return {
      resolution: result.resolution,
      nextCandidate:
        result.changed && !result.resolution.ready
          ? result.activeCandidate
          : null,
      request: result.request,
    };
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
        container?: { message_ts?: string };
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
      )
        .then(async (outcome) => {
          if (!outcome?.nextCandidate || !payload.container?.message_ts) return;
          const request = outcome.request;
          if (!request) return;
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: payload.container.message_ts,
            text: `Next reference option for ${request.person}`,
            blocks: [
              ...buildReferenceCandidateBlocks(
                request.runId,
                request,
                outcome.nextCandidate
              ),
              buildConceptualReferenceBlock(request.runId),
            ],
          });
        })
        .catch((error) =>
          console.error("[slack-actions] Action handling failed:", error)
        );
    }
  );

  return router;
}
