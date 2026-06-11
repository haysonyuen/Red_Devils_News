# Man Utd Agentic News Pipeline

Automated LangGraph.js pipeline with three cooperating editorial agents: Scout → Editor/Producer → Fact Checker. Deterministic services handle news ingestion, image generation, Slack approval, and Instagram publishing.

## Architecture

```
Cron (08:00 / 16:00 / 00:00 UK)
  └─▶ [ingest]       BBC Sport RSS + Cheerio scrape (allow/blocklist enforced)
        ├──(no valid articles)──▶ END
        └─▶ [scout agent]       Select current story and supporting articles
              └─▶ [producer agent]    Create grounded narrative, caption, and image prompt
                    └─▶ [fact checker agent]
                          ├──(REVISE, once)──▶ [producer agent]
                          ├──(REJECT)────────▶ END
                          └──(PASS)──────────▶ [imageGen] FAL.ai → Cloudinary
                                                   └─▶ [slackGateway] approval
                                                         ├──(APPROVED)──▶ [publish]
                                                         └──(REJECTED)──▶ END
```

State persists in **SQLite** (`checkpoints.db`) — a Slack button click resumes the exact LangGraph thread.

## Persona Consistency

- Versioned prompts live in `prompts/producer.v1.md` and `prompts/fact-checker.v1.md`.
- OpenAI Structured Outputs enforce strict JSON schemas for every agent.
- Producer captions are checked in code for supporter voice, length, hashtag count, banned clichés, a discussion question, and copied source phrasing.
- Deterministic failures trigger one Producer revision, then stop.
- The Fact Checker records every claim as `SUPPORTED`, `UNSUPPORTED`, or `OPINION`, with evidence and a source URL.
- Regression fixtures live in `src/evals/persona.fixtures.json`.

Run all checks with:

```bash
npm test
```

## Quick Start

### 1. Install

```bash
nvm use
npm install
```

The runtime scripts load Node `22.22.1` from `.nvmrc` automatically.

### 2. Environment

```bash
cp .env.example .env
# Fill in all variables — see .env.example for details
```

For a local, no-per-call-cost LLM, run an OpenAI-compatible Ollama model and set:

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=your-installed-model
LLM_SCOUT_MODEL=
LLM_PRODUCER_MODEL=
LLM_FACT_CHECKER_MODEL=
LLM_API_KEY=
```

For a hosted provider, use its OpenAI-compatible base URL, model name, and API key.

### 3. Start the pipeline

```bash
npm run dev
```

The scheduler boots, the Slack webhook server starts on port **4242**, and the cron fires at 08:00, 16:00, 00:00 UK time.

### Manual trigger

```bash
npm run dev:now
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible endpoint; defaults to local Ollama |
| `LLM_MODEL` | Default model used by all three agents |
| `LLM_SCOUT_MODEL` | Optional Scout-specific model |
| `LLM_PRODUCER_MODEL` | Optional Editor/Producer-specific model |
| `LLM_FACT_CHECKER_MODEL` | Optional Fact Checker-specific model |
| `LLM_API_KEY` | Hosted-provider key; leave blank for local Ollama |
| `FAL_KEY` | FAL.ai image generation |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud_name` |
| `META_GRAPH_TOKEN` | Long-lived Instagram publishing token |
| `META_IG_ACCOUNT_ID` | Target IG account ID |
| `SLACK_BOT_TOKEN` | Slack Bot token (xoxb-…) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_CHANNEL_ID` | Private channel for approval cards |
| `TZ` | Set to `Europe/London` for UK cron times |
| `WEBHOOK_PORT` | Express port for Slack webhooks (default: 4242) |

## Source → Allowlist / Blocklist

The active ingestion feed currently supplies **BBC Sport** articles. The existing source policy still recognizes David Ornstein, Fabrizio Romano, The Athletic, BBC Sport, and Simon Stone for future direct feeds.

**Blocked:** The Sun · Daily Mail · Mirror · BILD

Enforcement is hardcoded in [`src/mcp/server.ts`](src/mcp/server.ts) — bad data is rejected before entering the graph.

## Slack Setup

1. Create a Slack App with **Interactive Components** enabled
2. Set the Request URL to `https://your-ngrok-url/slack/actions`
3. Add Bot Token Scopes: `chat:write`, `files:write`
4. Install to your workspace and copy `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET`

## Meta / Instagram Setup

1. Create a Meta Developer App with `instagram_basic`, `instagram_content_publish` permissions
2. Generate a long-lived user access token
3. Get your Instagram Business Account ID
4. Set `META_GRAPH_TOKEN` and `META_IG_ACCOUNT_ID`

## File Structure

```
src/
├── index.ts                   # Cron scheduler + Express webhook server
├── graph/
│   ├── state.ts               # PipelineState type + LangGraph Annotation
│   ├── pipeline.ts            # StateGraph wiring
│   └── nodes/
│       ├── ingest.ts          # BBC RSS discovery + Cheerio scrape
│       ├── scout.ts           # Agent 1: story selection
│       ├── producer.ts        # Agent 2: editorial brief + creative draft
│       ├── factChecker.ts     # Agent 3: evidence audit + revision decision
│       ├── imageGen.ts        # FAL.ai + Cloudinary buffer
│       ├── slackGateway.ts    # Slack Block Kit + interrupt()
│       └── publish.ts         # Meta Graph API publish
├── llm/
│   └── client.ts              # Shared OpenAI-compatible JSON client
├── prompts/
│   └── load.ts                # Versioned prompt loader
├── validation/
│   └── caption.ts             # Deterministic persona and originality checks
├── evals/
│   ├── persona.fixtures.json  # Good and bad caption fixtures
│   └── persona.test.ts        # Persona regression checks
├── ingestion/
│   ├── bbcRss.ts              # BBC Sport RSS discovery
│   └── bbcRss.test.ts         # RSS parser test
├── mcp/
│   ├── server.ts              # Local MCP server (search + scrape tools)
│   └── server.test.ts         # Allowlist/blocklist unit tests
└── webhooks/
    └── slack.ts               # Express router: POST /slack/actions
```

Project-root persona files:

```
prompts/
├── producer.v1.md
└── fact-checker.v1.md
```
