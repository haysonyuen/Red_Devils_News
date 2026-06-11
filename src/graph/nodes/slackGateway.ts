import { WebClient, KnownBlock } from "@slack/web-api";
import { interrupt } from "@langchain/langgraph";
import { PipelineState } from "../state";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "";

export async function slackGatewayNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  console.log(`[slackGateway] Sending approval card for runId=${state.runId}`);

  const caption = state.draftCaption ?? "_(no caption drafted)_";
  const imageUrl = state.generatedImageUrl;
  const selectedUrls = new Set(state.scoutBrief?.selectedArticleUrls ?? []);
  const sources = state.filteredArticles
    .filter((article) => selectedUrls.has(article.url))
    .map((article) => `• <${article.url}|${article.title}>`)
    .join("\n");

  // ── Build Slack Block Kit payload ─────────────────────────────────────────
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔴 Man Utd Pipeline — Approval Required", emoji: true },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Run ID:* \`${state.runId}\`` },
    },
  ];

  // Attach image if available
  if (imageUrl) {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: "Generated Instagram image",
    });
  }

  blocks.push(
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Draft Caption:*\n${caption}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Fact Check:* ${state.factCheckStatus} · ${state.factCheckClaims.length} claim(s) checked · ${state.factCheckIssues.length} issue(s)`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Source Articles:*\n${sources || "_(none scraped)_"}` },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve & Publish", emoji: true },
          style: "primary",
          action_id: "pipeline_approve",
          // thread_id embedded in value so the webhook handler can resume the correct run
          value: JSON.stringify({ thread_id: state.runId, action: "APPROVED" }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject", emoji: true },
          style: "danger",
          action_id: "pipeline_reject",
          value: JSON.stringify({ thread_id: state.runId, action: "REJECTED" }),
        },
      ],
    }
  );

  // ── Post to Slack ─────────────────────────────────────────────────────────
  try {
    if (!process.env.SLACK_BOT_TOKEN) {
      console.warn("[slackGateway] SLACK_BOT_TOKEN not set — skipping Slack post (dev mode)");
    } else {
      await slack.chat.postMessage({ channel: CHANNEL_ID, blocks, text: "Man Utd pipeline approval needed" });
      console.log(`[slackGateway] ✔ Approval card posted to Slack channel`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[slackGateway] ✖ Slack post failed: ${msg}`);
    return { errorLog: [`[slackGateway] Slack post failed: ${msg}`] };
  }

  // ── Pause graph execution — resume triggered by Slack webhook ─────────────
  // interrupt() returns the value passed via Command({ resume: value }) on resume
  const decision = interrupt("Waiting for Slack approval") as "APPROVED" | "REJECTED";

  console.log(`[slackGateway] ✔ Resumed with decision: ${decision}`);
  return { approvalStatus: decision };
}
