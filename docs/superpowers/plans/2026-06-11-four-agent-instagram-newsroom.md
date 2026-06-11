# Four-Agent Instagram Newsroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-agent text-to-image path with the approved four-agent newsroom, including bounded story rejection, fact-defined visual boundaries, Slack reference approval, three FAL candidates, visual evaluation, human image selection, and separate final publish approval.

**Architecture:** LangGraph remains the orchestration and checkpoint layer. The four LLM agents return strict JSON only; deterministic modules validate contracts, persist reference workflow data, verify Slack callbacks, move private files, call FAL/Cloudinary, apply score thresholds, and resume the exact graph thread. Implementation is split into three working milestones: editorial contracts, reference collection, and visual generation/final approval.

**Tech Stack:** Node.js 22, TypeScript, LangGraph.js, SQLite checkpointer, OpenAI-compatible structured-output API, Slack Web API and Events API, FAL `flux-2-pro/edit` plus `flux-2-pro`, Cloudinary, Axios.

---

## File Map

**Create**

- `src/graph/contracts.ts` - shared four-agent and visual-workflow types.
- `src/prompts/scout.v2.md` - Scout persona and output rules.
- `src/prompts/producer.v2.md` - Editor/Caption Producer persona without image generation.
- `src/prompts/fact-checker.v2.md` - claim audit plus visual implication boundaries.
- `src/prompts/visual-producer.v1.md` - visual brief, generation request, and candidate evaluation persona.
- `src/graph/nodes/visualProducer.ts` - both Visual Producer structured-output phases.
- `src/visual/certainty.ts` - deterministic certainty and visual implication checks.
- `src/visual/fal.ts` - typed FAL provider adapter.
- `src/visual/cloudinary.ts` - private reference and public candidate asset handling.
- `src/visual/evaluation.ts` - visual score parsing, hard failures, qualification, ranking.
- `src/references/store.ts` - SQLite persistence for Slack reference workflow.
- `src/references/coordinator.ts` - upload/source matching, approval transitions, fallback decisions.
- `src/slack/blocks.ts` - pure Block Kit builders for references, candidates, and final approval.
- `src/graph/editorial-contracts.test.ts` - Scout, Producer, Fact Checker, and routing tests.
- `src/graph/visual-contracts.test.ts` - Visual Producer, certainty, and evaluation tests.
- `src/references/coordinator.test.ts` - reference state transition and timeout tests.
- `src/webhooks/slack.test.ts` - signature, event, action, and exact-thread resume tests.
- `src/graph/workflow.test.ts` - end-to-end graph routing with fake services.

**Modify**

- `src/graph/state.ts` - replace legacy image-prompt fields with approved grouped state.
- `src/graph/nodes/scout.ts` - emit story status, characters, visual potential, and alternate selection.
- `src/graph/nodes/producer.ts` - explicit accept/rescout/end decision and caption only.
- `src/graph/nodes/factChecker.ts` - emit allowed and forbidden visual implications.
- `src/graph/nodes/imageGen.ts` - delegate to FAL/Cloudinary adapter and generate three candidates.
- `src/graph/nodes/slackGateway.ts` - split candidate selection from final post approval.
- `src/graph/pipeline.ts` - add bounded rejection, visual brief, reference pause, generation, evaluation, candidate selection, and final approval routes.
- `src/llm/client.ts` - support multimodal structured JSON for candidate evaluation.
- `src/webhooks/slack.ts` - add `/events`, stage-specific actions, and reference handling.
- `src/index.ts` - initialize services/store, raw body handling, timeout sweep, and complete initial state.
- `src/validation/caption.ts` - retain approved concise supporter-caption rules.
- `scripts/run.sh` - execute new test files.
- `.env.example` - document visual model, Slack, and timeout configuration.
- `.gitignore` - ignore reference workflow SQLite files.
- `README.md` - document Slack Events setup and the two human approval stages.

**Delete after replacement**

- `src/validation/imagePrompt.ts` - the Producer no longer creates conceptual image prompts.
- `prompts/producer.v1.md`
- `prompts/fact-checker.v1.md`

---

### Task 1: Define Four-Agent Contracts and State

**Files:**
- Create: `src/graph/contracts.ts`
- Create: `src/graph/editorial-contracts.test.ts`
- Modify: `src/graph/state.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing contract tests**

Add assertions that parse valid values and reject malformed values for:

```ts
const scout = {
  decision: "SELECT",
  primaryStory: "United are considering a move",
  supportingSourceUrls: ["https://www.bbc.com/sport/football/articles/example"],
  mainCharacters: ["Marcus Rashford"],
  storyStatus: "INTEREST",
  visualPotential: 90,
  selectionReason: "Current, consequential, and visually clear",
  confidence: 0.95,
};

const producer = {
  decision: "ACCEPT",
  decisionReason: "The story has a clear United supporter angle",
  angle: "United need clarity before pre-season",
  facts: [{ claim: "A decision is pending", sourceUrl: scout.supportingSourceUrls[0] }],
  supporterOpinion: "We should avoid another unresolved summer",
  caption: "We need clarity before pre-season...",
  headlineOptions: ["DECISION TIME", "NO MORE DRIFTING"],
};

const factCheck = {
  status: "PASS",
  storyStatus: "INTEREST",
  claimChecks: [{
    claim: "A decision is pending",
    verdict: "SUPPORTED",
    evidence: "The article says a decision is pending.",
    sourceUrl: scout.supportingSourceUrls[0],
  }],
  visualImplicationsAllowed: ["Current or neutral clothing", "Symbolic destination colors"],
  visualImplicationsForbidden: ["Completed signing", "Destination kit"],
  issues: [],
  revisionFeedback: null,
};
```

Also assert the default state contains:

```ts
producerDecision: null
producerRejectionCount: 0
rejectedStoryUrls: []
visualBrief: null
referenceRequests: []
generatedCandidates: []
selectedCandidate: null
visualRegenerationCount: 0
approvalStatus: "PENDING"
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: TypeScript fails because the new contracts and state fields do not exist.

- [ ] **Step 3: Add the shared contracts**

Define these exact unions and interfaces in `src/graph/contracts.ts`:

```ts
export type StoryStatus = "CONFIRMED" | "ADVANCED" | "INTEREST" | "SPECULATION";
export type ProducerDecision = "ACCEPT" | "REJECT_AND_RESCOUT" | "REJECT_AND_END";
export type CompositionMode =
  | "PRIMARY_WITH_BACKGROUND"
  | "PRIMARY_WITH_SECONDARIES"
  | "CONCEPTUAL";
export type ReferenceRole = "PRIMARY" | "SECONDARY";
export type ReferenceStatus =
  | "AWAITING_UPLOAD"
  | "AWAITING_SOURCE"
  | "AWAITING_DECISION"
  | "APPROVED"
  | "REJECTED"
  | "OMITTED"
  | "TIMED_OUT";

export interface StorySelection {
  decision: "SELECT" | "NO_STORY";
  primaryStory: string | null;
  supportingSourceUrls: string[];
  mainCharacters: string[];
  storyStatus: StoryStatus | null;
  visualPotential: number;
  selectionReason: string;
  confidence: number;
}

export interface ProducerOutput {
  decision: ProducerDecision;
  decisionReason: string;
  angle: string | null;
  facts: Array<{ claim: string; sourceUrl: string }>;
  supporterOpinion: string | null;
  caption: string | null;
  headlineOptions: string[];
}

export interface FactCheckOutput {
  status: "PASS" | "REVISE" | "REJECT";
  storyStatus: StoryStatus;
  claimChecks: ClaimCheck[];
  visualImplicationsAllowed: string[];
  visualImplicationsForbidden: string[];
  issues: string[];
  revisionFeedback: string | null;
}

export interface VisualBrief {
  storyHook: string;
  emotionalGoal: string;
  primaryCharacter: string | null;
  secondaryCharacters: string[];
  compositionMode: CompositionMode;
  requiredSignals: string[];
  forbiddenImplications: string[];
  referenceRequirements: Array<{
    person: string;
    role: ReferenceRole;
    required: boolean;
  }>;
  searchInstructions: string[];
  generationPromptTemplate: string;
  conceptualFallbackPrompt: string;
  referenceWarning: string | null;
}

export interface ReferenceRequest {
  id: string;
  runId: string;
  threadTs: string;
  person: string;
  role: ReferenceRole;
  required: boolean;
  status: ReferenceStatus;
  attempt: number;
  slackFileId: string | null;
  privateDownloadUrl: string | null;
  sourcePageUrl: string | null;
  uploaderId: string | null;
  approverId: string | null;
  decisionAt: string | null;
  deadlineAt: string;
}

export interface ApprovedReference {
  requestId: string;
  person: string;
  role: ReferenceRole;
  privateAssetId: string;
  sourcePageUrl: string;
  sha256: string;
}

export interface GenerationRequest {
  compositionMode: CompositionMode;
  includedPeople: string[];
  omittedPeople: string[];
  approvedReferenceIds: string[];
  generationPrompt: string;
  candidateCount: 3;
  fallbackUsed: boolean;
}

export interface VisualScores {
  identityFidelity: Record<string, number>;
  storyAlignment: number;
  feedImpact: number;
  composition: number;
  captionComplement: number;
  factualIntegrity: number;
}

export interface CandidateEvaluation {
  candidateId: string;
  scores: VisualScores;
  hardFailures: string[];
  warnings: string[];
  rationale: string;
  recommended: boolean;
}

export interface GeneratedCandidate {
  id: string;
  publicUrl: string;
  providerRequestId: string;
  evaluation: CandidateEvaluation | null;
  qualified: boolean;
}
```

- [ ] **Step 4: Replace legacy state fields minimally**

Keep ingestion and publishing fields. Replace `scoutBrief`, `editorialBrief`, `imagePrompt`, and `generatedImageUrl` with the new grouped contracts. Keep `draftCaption` as the final caption and retain revision fields for the one Fact Checker revision.

- [ ] **Step 5: Add the new tests to `scripts/run.sh` and run them**

Run: `npm test`

Expected: all existing tests plus `editorial-contracts.test.js` pass.

- [ ] **Step 6: Commit**

```bash
git add src/graph/contracts.ts src/graph/state.ts src/graph/editorial-contracts.test.ts scripts/run.sh
git commit -m "feat: define four-agent newsroom contracts"
```

---

### Task 2: Implement Scout Selection and Producer Rejection

**Files:**
- Create: `src/prompts/scout.v2.md`
- Create: `src/prompts/producer.v2.md`
- Modify: `src/graph/nodes/scout.ts`
- Modify: `src/graph/nodes/producer.ts`
- Modify: `src/graph/pipeline.ts`
- Modify: `src/graph/editorial-contracts.test.ts`

- [ ] **Step 1: Write failing routing tests**

Test these exact transitions:

```ts
routeAfterScout(NO_STORY) === "__end__"
routeAfterScout(SELECT) === "producer"
routeAfterProducer(REJECT_AND_RESCOUT, 0) === "scout"
routeAfterProducer(REJECT_AND_RESCOUT, 1) === "__end__"
routeAfterProducer(REJECT_AND_END, 0) === "__end__"
routeAfterProducer(ACCEPT with valid caption) === "factChecker"
```

Also test that a second Scout call receives `rejectedStoryUrls` and rejects an output containing one of those URLs.

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test`

Expected: routing assertions fail because the current graph only supports producer self-revision.

- [ ] **Step 3: Implement Scout v2**

Move the persona into `prompts/scout.v2.md`. Require strict JSON matching `StorySelection`, only supplied URLs, one coherent story, one to three supporting sources, explicit status, named main characters, and visual potential from 0 to 100.

Pass this input:

```ts
{
  candidates,
  rejectedStoryUrls: state.rejectedStoryUrls
}
```

Reject any selected URL not supplied or already present in `rejectedStoryUrls`.

- [ ] **Step 4: Implement Producer v2**

Remove `image_prompt` from schema, parsing, prompt, and validation. Require the explicit decision values. For `ACCEPT`, require non-null `angle`, `supporterOpinion`, `caption`, at least one fact, and one to three headline options. For either rejection decision, require `caption === null`, no facts, and a concrete `decisionReason`.

Continue using `validateCaption()` and canonical URL mapping for accepted outputs.

- [ ] **Step 5: Implement bounded rescout routing**

On `REJECT_AND_RESCOUT`, append selected source URLs to `rejectedStoryUrls` and increment `producerRejectionCount`. Route to Scout only when the prior count is zero. Any second rejection ends the run.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all tests pass; the Producer no longer creates an image prompt.

- [ ] **Step 7: Commit**

```bash
git add prompts/scout.v2.md prompts/producer.v2.md src/graph/nodes/scout.ts src/graph/nodes/producer.ts src/graph/pipeline.ts src/graph/editorial-contracts.test.ts
git commit -m "feat: add editorial acceptance and rescout loop"
```

---

### Task 3: Add Fact-Defined Visual Boundaries

**Files:**
- Create: `src/prompts/fact-checker.v2.md`
- Create: `src/visual/certainty.ts`
- Create: `src/graph/visual-contracts.test.ts`
- Modify: `src/graph/nodes/factChecker.ts`
- Modify: `src/graph/pipeline.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing certainty tests**

Cover all four statuses:

```ts
assertVisualRequestAllowed("CONFIRMED", "player in destination kit") // passes
assertVisualRequestAllowed("ADVANCED", "player in destination kit") // throws
assertVisualRequestAllowed("INTEREST", "completed signing photo") // throws
assertVisualRequestAllowed("SPECULATION", "player in current clothing with symbolic backdrop") // passes
```

Test that a `PASS` response is rejected when it has an unsupported claim or either visual implication array is empty.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: missing certainty module and new Fact Checker fields.

- [ ] **Step 3: Implement Fact Checker v2**

Require the exact output in the approved design. The prompt must:

- classify every material claim;
- preserve clearly framed supporter opinion;
- reconcile `storyStatus` with source wording;
- list concrete allowed and forbidden visual implications;
- never rewrite the caption.

Deterministically downgrade `PASS` to `REVISE` when any claim is `UNSUPPORTED`, and end after one revision.

- [ ] **Step 4: Implement certainty validation**

Use status-specific forbidden concepts:

```ts
const STATUS_FORBIDDEN = {
  CONFIRMED: [],
  ADVANCED: ["completed signing", "signed contract", "destination kit"],
  INTEREST: ["completed signing", "signed contract", "destination kit", "medical"],
  SPECULATION: [
    "completed signing",
    "signed contract",
    "destination kit",
    "medical",
    "negotiation room",
  ],
};
```

The Fact Checker's explicit forbidden implications are always additive and take precedence.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all contract and certainty tests pass.

- [ ] **Step 6: Commit**

```bash
git add prompts/fact-checker.v2.md src/visual/certainty.ts src/graph/nodes/factChecker.ts src/graph/pipeline.ts src/graph/visual-contracts.test.ts scripts/run.sh
git commit -m "feat: define fact checked visual boundaries"
```

---

### Task 4: Implement Visual Producer Phase 1

**Files:**
- Create: `src/prompts/visual-producer.v1.md`
- Create: `src/graph/nodes/visualProducer.ts`
- Modify: `src/graph/visual-contracts.test.ts`
- Modify: `src/graph/pipeline.ts`

- [ ] **Step 1: Write failing Visual Brief tests**

Test:

- a single-player story creates `PRIMARY_WITH_BACKGROUND`;
- a story requiring two essential people creates `PRIMARY_WITH_SECONDARIES`;
- a club-only story creates `CONCEPTUAL`;
- every recognizable person has a separate reference requirement;
- more than three people creates a warning but remains valid;
- the prompt template contains no unapproved URL;
- forbidden implications are copied into the brief.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: Visual Producer module is missing.

- [ ] **Step 3: Add the Visual Producer prompt and strict parser**

The prompt must implement both approved phases, but expose separate functions:

```ts
createVisualBrief(state: PipelineState): Promise<VisualBrief>
createGenerationRequest(state: PipelineState): Promise<GenerationRequest>
evaluateCandidates(state: PipelineState): Promise<CandidateEvaluation[]>
```

Phase 1 receives the fact-checked caption, characters, status, claims, and implication boundaries. It must choose one primary person, essential secondary people only, a mobile-first composition, trusted-domain-first search instructions, a no-reference conceptual fallback, and no embedded text/logos in the generation prompt.

- [ ] **Step 4: Add the graph node and route**

After Fact Checker `PASS`, route to `visualBrief`. Route conceptual briefs directly to image generation. Route people-based briefs to the reference request stage added in Task 6.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all tests pass and no FAL call occurs in Visual Producer code.

- [ ] **Step 6: Commit**

```bash
git add prompts/visual-producer.v1.md src/graph/nodes/visualProducer.ts src/graph/visual-contracts.test.ts src/graph/pipeline.ts
git commit -m "feat: add visual producer brief"
```

---

### Task 5: Persist the Reference Workflow

**Files:**
- Create: `src/references/store.ts`
- Create: `src/references/coordinator.ts`
- Create: `src/references/coordinator.test.ts`
- Modify: `.gitignore`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing store and transition tests**

Use a temporary SQLite file and test:

```ts
createRequests(runId, threadTs, visualBrief)
attachUpload(requestId, slackFileId, privateDownloadUrl, uploaderId)
attachSource(requestId, "https://www.bbc.com/sport/football/articles/example")
decide(requestId, "APPROVED", approverId)
listForRun(runId)
```

Assert upload alone remains `AWAITING_SOURCE` or `AWAITING_DECISION`, never `APPROVED`.

Test timeout outcomes:

- missing primary becomes `TIMED_OUT` and requests conceptual fallback;
- missing secondary becomes `OMITTED`;
- first primary rejection returns to `AWAITING_UPLOAD` with `attempt = 2`;
- second primary rejection requests conceptual fallback.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test`

Expected: missing store and coordinator modules.

- [ ] **Step 3: Implement SQLite persistence**

Use Node's built-in `node:sqlite` `DatabaseSync` with one table:

```sql
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
```

Use parameterized statements only. Store metadata, never image bytes.

- [ ] **Step 4: Implement deterministic transitions**

`ReferenceCoordinator` must reject:

- unknown run/request IDs;
- source URLs that are not `http` or `https`;
- decisions before both file and source are present;
- decisions after terminal states;
- a secondary reference being attached to the primary request.

Return a typed `ReferenceResolution` with `ready`, `fallbackToConceptual`, `approved`, `omitted`, and `pending`.

- [ ] **Step 5: Ignore runtime databases and run tests**

Add `reference-workflow.db`, `reference-workflow.db-shm`, and `reference-workflow.db-wal` to `.gitignore`.

Run: `npm test`

Expected: persistence and transition tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/references/store.ts src/references/coordinator.ts src/references/coordinator.test.ts scripts/run.sh .gitignore
git commit -m "feat: persist reference approval workflow"
```

---

### Task 6: Add Slack Reference Events and Approval

**Files:**
- Create: `src/slack/blocks.ts`
- Create: `src/webhooks/slack.test.ts`
- Modify: `src/webhooks/slack.ts`
- Modify: `src/graph/pipeline.ts`
- Modify: `src/index.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing Slack tests**

Test:

- Slack signature verification uses the exact raw body;
- `/slack/events` returns the URL verification challenge;
- a thread message containing a file and source URL attaches both to the matching request;
- `Approve Reference` updates only that reference;
- candidate selection resumes the exact `thread_id`;
- final approval resumes the exact `thread_id`;
- replayed event IDs are acknowledged without a second transition.

Use injected fake pipeline and fake Slack client; no network calls.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: `/events` and stage-specific actions are missing.

- [ ] **Step 3: Extract pure Block Kit builders**

Implement:

```ts
buildReferenceRequestBlocks(runId, visualBrief, requests)
buildReferenceDecisionBlocks(runId, request)
buildCandidateSelectionBlocks(runId, candidates)
buildFinalApprovalBlocks(runId, selectedCandidate, state)
```

All action values must contain `{ thread_id, stage, entity_id, action }`. Reference and final approval buttons must have different `stage` values.

- [ ] **Step 4: Add the Events API endpoint**

Add `POST /slack/events` with JSON parsing and raw-body signature verification. Handle `url_verification` and `event_callback`. Accept thread replies only when `channel === SLACK_CHANNEL_ID` and `thread_ts` maps to a pending run. Extract Slack file metadata and the first `http` or `https` source-page URL from message text.

Required Slack subscriptions/scopes documented later:

```text
Event: message.groups
Scopes: chat:write, files:read, groups:history
```

- [ ] **Step 5: Add the reference pause and timeout sweep**

Post one parent reference request message, persist its `ts`, then interrupt the graph with:

```ts
interrupt({ stage: "REFERENCE_APPROVAL", runId: state.runId })
```

In `src/index.ts`, run a one-minute interval that asks the coordinator for expired pending runs and resumes each exact thread with `{ stage: "REFERENCE_TIMEOUT" }`. The deadline is `createdAt + 30 minutes`.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: Slack tests pass with no live Slack access.

- [ ] **Step 7: Commit**

```bash
git add src/slack/blocks.ts src/webhooks/slack.ts src/webhooks/slack.test.ts src/graph/pipeline.ts src/index.ts scripts/run.sh
git commit -m "feat: add Slack reference approval gateway"
```

---

### Task 7: Add Private Reference Assets and Three-Candidate FAL Generation

**Files:**
- Create: `src/visual/cloudinary.ts`
- Create: `src/visual/fal.ts`
- Modify: `src/graph/nodes/imageGen.ts`
- Modify: `src/graph/visual-contracts.test.ts`

- [ ] **Step 1: Write failing provider tests**

With fake clients, assert:

- Slack private files are downloaded using `Authorization: Bearer ${SLACK_BOT_TOKEN}`;
- references upload to Cloudinary as `type: "authenticated"` under `man-utd-pipeline/references/{runId}`;
- generated candidates upload publicly under `man-utd-pipeline/candidates/{runId}/{candidateId}`;
- conceptual generation calls `fal-ai/flux-2-pro` with `image_size: "portrait_4_3"`;
- referenced generation calls `fal-ai/flux-2-pro/edit` with `image_urls`, `prompt`, and one candidate per request;
- exactly three candidate requests are made with different seeds;
- partial failure is retained when at least one candidate succeeds.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: FAL and asset adapters are missing.

- [ ] **Step 3: Implement Cloudinary handling**

Download the Slack private file, upload it as authenticated, and create a signed temporary delivery URL used only for FAL. Do not place original reference URLs in the final Slack card or Meta payload. Upload generated candidates as stable public assets.

- [ ] **Step 4: Implement the typed FAL adapter**

Use these exact endpoints and inputs:

```ts
fal.subscribe("fal-ai/flux-2-pro/edit", {
  input: {
    prompt,
    image_urls: signedReferenceUrls.slice(0, 4),
    image_size: "portrait_4_3",
    output_format: "jpeg",
    safety_tolerance: "2",
  },
});

fal.subscribe("fal-ai/flux-2-pro", {
  input: {
    prompt,
    image_size: "portrait_4_3",
    output_format: "jpeg",
    safety_tolerance: "2",
  },
});
```

FAL accepts at most four edit images. When the approved cast exceeds four, retain the primary plus the first three essential secondaries and record the rest in `omittedPeople`; the existing warning above three remains visible to the human.

- [ ] **Step 5: Replace `imageGenNode`**

Build the Generation Request through the Visual Producer, validate certainty rules, resolve signed reference URLs, run three independent seeds, buffer every successful result, and return `generatedCandidates`. End only when no candidate succeeds.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: provider tests pass without spending FAL or Cloudinary credit.

- [ ] **Step 7: Commit**

```bash
git add src/visual/cloudinary.ts src/visual/fal.ts src/graph/nodes/imageGen.ts src/graph/visual-contracts.test.ts
git commit -m "feat: generate referenced visual candidates"
```

---

### Task 8: Evaluate, Filter, and Select Candidates

**Files:**
- Create: `src/visual/evaluation.ts`
- Modify: `src/llm/client.ts`
- Modify: `src/graph/nodes/visualProducer.ts`
- Modify: `src/graph/nodes/slackGateway.ts`
- Modify: `src/graph/pipeline.ts`
- Modify: `src/graph/visual-contracts.test.ts`

- [ ] **Step 1: Write failing evaluation tests**

Test qualification thresholds:

```ts
identityFidelity >= 90 // for every recognizable person
storyAlignment >= 85
feedImpact >= 85
composition >= 80
captionComplement >= 80
factualIntegrity >= 80
hardFailures.length === 0
```

Test that a wrong face, malformed crest/text, critical anatomy artifact, unclear story, or certainty violation disqualifies a candidate regardless of numeric scores.

Test ordering by average score after qualification.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: evaluation functions and multimodal client are missing.

- [ ] **Step 3: Add multimodal structured output**

Add `callLlmVisionJson()` using the same OpenAI-compatible endpoint and strict schema. The user message content must contain the fact-checked brief followed by one `image_url` part for the candidate and one for each approved reference.

- [ ] **Step 4: Implement Visual Producer evaluation**

Require per-person identity scores, the six approved score dimensions, hard failures, warnings, rationale, and `recommended`. Deterministic code computes `qualified`; the LLM cannot override thresholds.

- [ ] **Step 5: Add candidate selection and bounded regeneration**

Post all qualified candidates to Slack. Interrupt with `CANDIDATE_SELECTION`. Handle:

- `SELECT_CANDIDATE` -> save selected candidate and continue;
- `REGENERATE` with count zero -> return to image generation once;
- `REGENERATE` with count one -> create conceptual fallback;
- no qualified candidates -> same one-regeneration rule;
- `REJECT` -> end.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all candidate evaluation and routing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/visual/evaluation.ts src/llm/client.ts src/graph/nodes/visualProducer.ts src/graph/nodes/slackGateway.ts src/graph/pipeline.ts src/graph/visual-contracts.test.ts
git commit -m "feat: evaluate and select visual candidates"
```

---

### Task 9: Separate Final Approval and Publish

**Files:**
- Modify: `src/graph/nodes/slackGateway.ts`
- Modify: `src/webhooks/slack.ts`
- Modify: `src/graph/pipeline.ts`
- Modify: `src/graph/nodes/publish.ts`
- Create: `src/graph/workflow.test.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing workflow tests**

Use fake agent, Slack, FAL, Cloudinary, and Meta services for:

- single-person approved-reference path;
- multi-person path with all references approved;
- missing secondary omitted;
- primary rejected twice to conceptual fallback;
- 30-minute timeout;
- one regeneration then conceptual fallback;
- selected candidate followed by separate final approval;
- final rejection never invokes Meta;
- final approval publishes `selectedCandidate.publicUrl`;
- every resume uses the original LangGraph `thread_id`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test`

Expected: final approval is still coupled to candidate/reference stages.

- [ ] **Step 3: Split Slack posting from graph interruption**

Use separate nodes:

```text
postReferenceRequest -> waitForReferences
postCandidates -> waitForCandidateSelection
postFinalApproval -> waitForFinalApproval
```

This prevents LangGraph replay from posting duplicate cards when an interrupted node resumes.

- [ ] **Step 4: Build the final approval card**

Include only:

- selected public candidate;
- concise caption;
- source article links;
- Fact Checker status and issue count;
- visual scores and warnings;
- reference audit summary without private URLs;
- `Approve & Publish` and `Reject`.

- [ ] **Step 5: Publish the selected candidate**

Update Meta publishing to read `selectedCandidate.publicUrl`. Preserve existing Create Media Container then Publish Container flow. On failure set `publishStatus: "FAILED"` and keep the selected asset/state.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all workflow tests and earlier tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/graph/nodes/slackGateway.ts src/webhooks/slack.ts src/graph/pipeline.ts src/graph/nodes/publish.ts src/graph/workflow.test.ts scripts/run.sh
git commit -m "feat: separate final approval from visual workflow"
```

---

### Task 10: Remove Legacy Image Prompt Code and Document Setup

**Files:**
- Delete: `src/validation/imagePrompt.ts`
- Delete: `prompts/producer.v1.md`
- Delete: `prompts/fact-checker.v1.md`
- Modify: `src/graph/agents.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Remove legacy imports and tests**

Delete all references to `imagePrompt`, `validateImagePrompt`, `addImageSafetyConstraints`, and the v1 prompt files. Rename the existing console message from `Three-agent contract tests passed` to `Four-agent contract tests passed`.

- [ ] **Step 2: Document environment variables**

Add:

```dotenv
LLM_VISUAL_MODEL=
FAL_REFERENCE_MODEL=fal-ai/flux-2-pro/edit
FAL_CONCEPT_MODEL=fal-ai/flux-2-pro
REFERENCE_TIMEOUT_MINUTES=30
REFERENCE_DB_PATH=./reference-workflow.db
SLACK_CHANNEL_ID=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
```

- [ ] **Step 3: Document Slack configuration**

Document:

```text
Interactivity URL: https://<ngrok-host>/slack/actions
Events URL:        https://<ngrok-host>/slack/events
Bot scopes:        chat:write, files:read, groups:history
Bot event:         message.groups
```

State that uploaded references require a source-page URL and a separate approval click, reference files remain private, candidate selection is not publish approval, and final publishing remains human-controlled.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit zero.

- [ ] **Step 5: Run a local dry run**

Run:

```bash
npm run dev:now
```

Expected: ingestion, Scout, Producer, and Fact Checker run; a people-based story posts a Slack reference request and pauses without calling FAL. A club-only story bypasses reference collection and generates three conceptual candidates.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: finish four-agent newsroom setup"
```

---

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Producer output contains no image prompt.
- [ ] Producer can reject once and trigger a different Scout story.
- [ ] Fact Checker emits explicit allowed and forbidden visual implications.
- [ ] Every recognizable person requires a separate approved reference.
- [ ] Upload alone never approves a reference.
- [ ] Missing secondary references are omitted.
- [ ] Missing or twice-rejected primary references trigger conceptual fallback.
- [ ] Reference timeout survives process restarts through SQLite deadlines.
- [ ] Original references are private and absent from publish payloads.
- [ ] FAL produces three buffered candidates.
- [ ] Deterministic thresholds filter candidates.
- [ ] Human candidate selection is separate from final publish approval.
- [ ] Only final approval calls Meta.
- [ ] All Slack callbacks resume the exact LangGraph thread.
