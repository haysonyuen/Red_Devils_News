# Man Utd Agentic News Pipeline

Automated LangGraph.js pipeline with four cooperating newsroom agents: Scout → Editor/Caption Producer → Fact Checker → Visual Producer. Deterministic services handle ingestion, reference approval, image generation, candidate scoring, Slack decisions, and Instagram publishing.

## Architecture

```
Cron → ingest → Scout → Editor/Caption Producer → Fact Checker
  → Visual Producer brief
      ├─ people story → Slack reference upload/source/approval → FAL
      └─ conceptual story → FAL
  → Cloudinary buffers 3 public candidates
  → Visual Producer evaluates candidates against deterministic thresholds
  → Slack candidate selection
  → separate Slack final approval
      ├─ APPROVED → Meta publish selectedCandidate.publicUrl
      └─ REJECTED → END
```

State persists in **SQLite** (`checkpoints.db`) — a Slack button click resumes the exact LangGraph thread.

## Persona Consistency

- Versioned prompts live in `prompts/scout.v2.md`, `prompts/producer.v2.md`, `prompts/fact-checker.v2.md`, and `prompts/visual-producer.v1.md`.
- OpenAI Structured Outputs enforce strict JSON schemas for every agent.
- The Producer creates captions only. It cannot generate image prompts.
- Producer captions are checked in code for supporter voice, length, hashtag count, banned clichés, a discussion question, and copied source phrasing.
- Deterministic failures trigger one Producer revision, then stop.
- The Fact Checker records every claim as `SUPPORTED`, `UNSUPPORTED`, or `OPINION`, with evidence and a source URL.
- The Visual Producer creates the fact-bounded visual brief, generation request, and candidate evaluation. Deterministic thresholds decide whether a candidate qualifies.
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
| `LLM_MODEL` | Default model used by all four agents |
| `LLM_SCOUT_MODEL` | Optional Scout-specific model |
| `LLM_PRODUCER_MODEL` | Optional Editor/Producer-specific model |
| `LLM_FACT_CHECKER_MODEL` | Optional Fact Checker-specific model |
| `LLM_VISUAL_PRODUCER_MODEL` | Optional Visual Producer text model |
| `LLM_VISUAL_MODEL` | Vision-capable model for candidate evaluation |
| `LLM_API_KEY` | Hosted-provider key; leave blank for local Ollama |
| `FAL_KEY` | FAL.ai image generation |
| `FAL_REFERENCE_MODEL` | Referenced image model; defaults to `fal-ai/flux-2-pro/edit` |
| `FAL_CONCEPT_MODEL` | Conceptual image model; defaults to `fal-ai/flux-2-pro` |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud_name` |
| `META_GRAPH_TOKEN` | Long-lived Instagram publishing token |
| `META_IG_ACCOUNT_ID` | Target IG account ID |
| `SLACK_BOT_TOKEN` | Slack Bot token (xoxb-…) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_CHANNEL_ID` | Private channel for approval cards |
| `REFERENCE_TIMEOUT_MINUTES` | Reference collection deadline; defaults to 30 |
| `REFERENCE_DB_PATH` | Persistent reference workflow SQLite path |
| `TZ` | Set to `Europe/London` for UK cron times |
| `WEBHOOK_PORT` | Express port for Slack webhooks (default: 4242) |

## Source → Allowlist / Blocklist

The active ingestion feed currently supplies **BBC Sport** articles. The existing source policy still recognizes David Ornstein, Fabrizio Romano, The Athletic, BBC Sport, and Simon Stone for future direct feeds.

**Blocked:** The Sun · Daily Mail · Mirror · BILD

Enforcement is hardcoded in [`src/mcp/server.ts`](src/mcp/server.ts) — bad data is rejected before entering the graph.

## Slack Setup

1. Create a Slack App and invite it to the private approvals channel.
2. Set Interactivity Request URL to `https://<ngrok-host>/slack/actions`.
3. Enable Events and set Request URL to `https://<ngrok-host>/slack/events`.
4. Add Bot Token Scopes: `chat:write`, `files:read`, `groups:history`.
5. Subscribe to the bot event `message.groups`.
6. Install the app and set `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_CHANNEL_ID`.

For a person-based visual, reply in the reference thread with the person's name, one image, and the image's source-page URL. Uploading a file does not approve it; a separate approval click is required. Reference files are stored privately and their URLs are never included in the publish payload.

Candidate selection is not permission to publish. The selected image and caption receive a separate final `Approve & Publish` decision before Meta is called.

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
│       ├── producer.ts        # Agent 2: supporter caption
│       ├── factChecker.ts     # Agent 3: evidence + visual boundaries
│       ├── visualProducer.ts  # Agent 4: visual brief, request, evaluation
│       ├── imageGen.ts        # FAL.ai + Cloudinary buffer
│       ├── referenceGateway.ts# Reference post + wait stages
│       ├── slackGateway.ts    # Candidate and final approval stages
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
├── references/                # Persistent reference workflow
├── slack/                     # Block Kit builders
├── visual/                    # FAL, Cloudinary, certainty, scoring
└── webhooks/
    └── slack.ts               # POST /slack/actions and /slack/events
```

Project-root persona files:

```
prompts/
├── scout.v2.md
├── producer.v2.md
├── fact-checker.v2.md
└── visual-producer.v1.md
```
