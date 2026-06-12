import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisualBrief } from "../graph/contracts";
import { ReferenceCoordinator } from "../references/coordinator";
import { ReferenceStore } from "../references/store";
import {
  createSlackEventHandler,
  handleSlackActionValue,
  verifySlackSignature,
} from "./slack";

async function run(): Promise<void> {
  const secret = "test-signing-secret";
  const timestamp = "1760000000";
  const rawBody = Buffer.from('{"type":"event_callback"}');
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
    const brief: VisualBrief = {
      storyHook: "Player One decision",
      emotionalGoal: "Tension",
      primaryCharacter: "Player One",
      secondaryCharacters: [],
      compositionMode: "PRIMARY_WITH_BACKGROUND",
      requiredSignals: ["Player dominant"],
      forbiddenImplications: ["Completed signing"],
      referenceRequirements: [
        { person: "Player One", role: "PRIMARY", required: true },
      ],
      searchInstructions: ["Search trusted sources"],
      generationPromptTemplate: "Editorial portrait",
      conceptualFallbackPrompt: "Symbolic football crossroads",
      referenceWarning: null,
    };
    const request = coordinator.createRequests(
      "run-1",
      "thread-1",
      brief,
      new Date("2026-06-12T12:00:00.000Z")
    )[0];

    const posted: Array<Record<string, unknown>> = [];
    const eventHandler = createSlackEventHandler({
      coordinator,
      channelId: "channel-1",
      postMessage: async (message: Record<string, unknown>) => {
        posted.push(message);
      },
    });

    const challenge = await eventHandler({
      type: "url_verification",
      challenge: "challenge-token",
    });
    if (challenge.challenge !== "challenge-token") {
      throw new Error("Slack URL verification challenge should be returned");
    }

    const eventPayload = {
      type: "event_callback",
      event_id: "event-1",
      event: {
        type: "message",
        channel: "channel-1",
        thread_ts: "thread-1",
        user: "user-1",
        text: "Player One https://www.bbc.com/sport/football/articles/example",
        files: [
          {
            id: "file-1",
            url_private_download: "https://files.slack.com/file-1",
          },
        ],
      },
    };
    await eventHandler(eventPayload);
    const attached = store.get(request.id);
    if (
      attached?.status !== "AWAITING_DECISION" ||
      attached.slackFileId !== "file-1" ||
      !attached.sourcePageUrl?.startsWith("https://www.bbc.com/")
    ) {
      throw new Error(
        "Slack thread reply should attach file and source to request"
      );
    }
    if (posted.length !== 1) {
      throw new Error("Ready reference should receive one decision card");
    }
    await eventHandler(eventPayload);
    if (posted.length !== 1) {
      throw new Error("Replayed Slack event must not repeat transitions");
    }

    const resumes: Array<{ threadId: string; value: unknown }> = [];
    await handleSlackActionValue(
      JSON.stringify({
        thread_id: "run-1",
        stage: "REFERENCE_DECISION",
        entity_id: request.id,
        action: "APPROVED",
      }),
      coordinator,
      async (threadId: string, value: unknown) => {
        resumes.push({ threadId, value });
      },
      "approver-1"
    );
    if (resumes.length !== 1 || resumes[0].threadId !== "run-1") {
      throw new Error(
        "Final reference decision should resume the exact graph thread"
      );
    }

    await handleSlackActionValue(
      JSON.stringify({
        thread_id: "run-final",
        stage: "FINAL_APPROVAL",
        entity_id: "candidate-1",
        action: "APPROVED",
      }),
      coordinator,
      async (threadId: string, value: unknown) => {
        resumes.push({ threadId, value });
      },
      "approver-1"
    );
    if (resumes[1]?.threadId !== "run-final") {
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
