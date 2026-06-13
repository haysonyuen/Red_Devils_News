# Agent Reference Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual Slack reference uploads with article-bound reference discovery, one-click approval, bounded rejection, and conceptual fallback.

**Architecture:** A deterministic discovery service fetches only selected articles and a bounded set of directly linked official pages, extracts social-preview images, and persists ranked candidates beside each reference request. Slack becomes a decision surface showing the completed caption, evidence, candidate preview, provenance, and actions; approved candidates are privately buffered in Cloudinary after LangGraph resumes.

**Tech Stack:** Node.js 22, TypeScript, Axios, Cheerio, LangGraph.js, Slack Block Kit, SQLite, Cloudinary, existing shell-based test runner.

---

## File Map

- Create `src/references/discovery.ts` - bounded HTML metadata extraction, official-link filtering, URL normalization, deduplication, and ranking.
- Create `src/references/discovery.test.ts` - deterministic discovery tests with injected HTML fetches.
- Modify `src/graph/contracts.ts` - candidate contract and discovery-oriented request statuses.
- Modify `src/graph/state.ts` - persist discovered candidates in LangGraph state.
- Modify `src/references/store.ts` - SQLite candidate table and candidate CRUD.
- Modify `src/references/coordinator.ts` - candidate attachment, approval, rejection, exhaustion, timeout, and resolution.
- Modify `src/references/coordinator.test.ts` - replace upload tests with bounded candidate workflow tests.
- Modify `src/slack/blocks.ts` - completed editorial reference card and candidate actions.
- Modify `src/webhooks/slack.ts` - remove manual file events and handle candidate actions idempotently.
- Modify `src/webhooks/slack.test.ts` - exact-thread resume, replay, rejection, and conceptual-action tests.
- Modify `src/graph/nodes/referenceGateway.ts` - discover before posting and consume persisted decisions after interrupt.
- Modify `src/visual/cloudinary.ts` - privately buffer an approved public candidate without a Slack token.
- Modify `src/visual/providers.test.ts` - verify public-reference download and private upload behavior.
- Modify `src/graph/nodes/imageGen.ts` - consume approved discovered candidates.
- Modify `src/graph/workflow.test.ts` - ensure caption/evidence precede visual generation and conceptual fallback remains valid.
- Modify `src/graph/pipeline.ts` - keep reference gateway routing explicit and unchanged for later visual stages.
- Modify `src/index.ts` - remove obsolete Slack Events endpoint logging.
- Modify `README.md` - remove upload/event setup and document article-bound discovery.

### Task 1: Define and Persist Reference Candidates

**Files:**
- Modify: `src/graph/contracts.ts`
- Modify: `src/graph/state.ts`
- Modify: `src/references/store.ts`
- Modify: `src/references/coordinator.test.ts`

- [ ] **Step 1: Write the failing persistence test**

Replace the upload-oriented setup in `src/references/coordinator.test.ts` with a candidate fixture and assert it survives a store reload:

```ts
const candidate: ReferenceCandidate = {
  id: "candidate-1",
  requestId: primary.id,
  person: primary.person,
  imageUrl: "https://ichef.bbci.co.uk/images/example.jpg",
  sourcePageUrl: "https://www.bbc.com/sport/football/articles/example",
  origin: "SELECTED_ARTICLE",
  rank: 1,
  status: "AVAILABLE",
  discoveredAt: "2026-06-13T12:00:00.000Z",
};

store.insertCandidate(candidate);
const persisted = store.listCandidatesForRequest(primary.id);
if (
  persisted.length !== 1 ||
  persisted[0].imageUrl !== candidate.imageUrl ||
  persisted[0].origin !== "SELECTED_ARTICLE"
) {
  throw new Error("Reference candidates should persist with provenance");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: TypeScript fails because `ReferenceCandidate`, `insertCandidate`, and `listCandidatesForRequest` do not exist.

- [ ] **Step 3: Add the candidate contract and state**

In `src/graph/contracts.ts`, replace upload collection statuses and add:

```ts
export type ReferenceStatus =
  | "AWAITING_CANDIDATE"
  | "AWAITING_DECISION"
  | "APPROVED"
  | "REJECTED"
  | "OMITTED"
  | "TIMED_OUT";

export type ReferenceCandidateStatus =
  | "AVAILABLE"
  | "APPROVED"
  | "REJECTED"
  | "FAILED";

export interface ReferenceCandidate {
  id: string;
  requestId: string;
  person: string;
  imageUrl: string;
  sourcePageUrl: string;
  origin: "SELECTED_ARTICLE" | "OFFICIAL_LINK";
  rank: number;
  status: ReferenceCandidateStatus;
  discoveredAt: string;
}
```

Remove `slackFileId`, `privateDownloadUrl`, and `uploaderId` from `ReferenceRequest`. Add:

```ts
activeCandidateId: string | null;
```

In `src/graph/state.ts`, import `ReferenceCandidate` and add:

```ts
referenceCandidates: Annotation<ReferenceCandidate[]>({
  reducer: (_, next) => next,
  default: () => [],
}),
```

- [ ] **Step 4: Add SQLite candidate persistence**

In `src/references/store.ts`, add a `reference_candidates` table:

```sql
CREATE TABLE IF NOT EXISTS reference_candidates (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  person TEXT NOT NULL,
  image_url TEXT NOT NULL,
  source_page_url TEXT NOT NULL,
  origin TEXT NOT NULL,
  rank INTEGER NOT NULL,
  status TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES reference_requests(id)
);
CREATE INDEX IF NOT EXISTS reference_candidates_request_id
  ON reference_candidates(request_id, rank);
```

Update request row conversion and SQL to persist `active_candidate_id` instead of upload fields. Add:

```ts
insertCandidate(candidate: ReferenceCandidate): void
listCandidatesForRequest(requestId: string): ReferenceCandidate[]
getCandidate(id: string): ReferenceCandidate | null
updateCandidate(candidate: ReferenceCandidate): void
```

`listCandidatesForRequest` must order by `rank ASC, id ASC`.

- [ ] **Step 5: Run the tests**

Run: `npm test`

Expected: candidate persistence passes; coordinator tests still fail where they reference removed upload fields.

- [ ] **Step 6: Commit**

```bash
git add src/graph/contracts.ts src/graph/state.ts src/references/store.ts src/references/coordinator.test.ts
git commit -m "feat: persist discovered reference candidates"
```

### Task 2: Discover Article-Bound Reference Images

**Files:**
- Create: `src/references/discovery.ts`
- Create: `src/references/discovery.test.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write failing metadata and ranking tests**

Create `src/references/discovery.test.ts` with injected HTML:

```ts
import {
  discoverReferenceCandidates,
  extractPageMetadata,
  isApprovedOfficialHost,
} from "./discovery";

const articleUrl = "https://www.bbc.com/sport/football/articles/example";
const articleHtml = `
  <html><head>
    <meta property="og:image" content="/images/player.jpg">
    <meta name="twitter:image" content="https://cdn.example/player.jpg">
  </head><body>
    <a href="https://www.manutd.com/en/players-and-staff/detail/player-one">
      Player One profile
    </a>
    <a href="https://random.example/player-one">Untrusted profile</a>
  </body></html>`;
const officialHtml = `
  <html><head>
    <meta property="og:image" content="https://assets.manutd.com/player-one.jpg">
  </head></html>`;

const metadata = extractPageMetadata(articleUrl, articleHtml);
if (metadata.imageUrls[0] !== "https://www.bbc.com/images/player.jpg") {
  throw new Error("Relative metadata images should resolve against the page");
}
if (!isApprovedOfficialHost("https://www.manutd.com/en/players")) {
  throw new Error("Known official football domains should be accepted");
}
if (isApprovedOfficialHost("https://random.example/player-one")) {
  throw new Error("Unknown domains should not be crawled");
}

const candidates = await discoverReferenceCandidates({
  requestId: "request-1",
  person: "Player One",
  selectedArticleUrls: [articleUrl],
  fetchHtml: async (url) => {
    if (url === articleUrl) return articleHtml;
    if (url.startsWith("https://www.manutd.com/")) return officialHtml;
    throw new Error(`Unexpected fetch: ${url}`);
  },
  now: new Date("2026-06-13T12:00:00.000Z"),
});

if (
  candidates.length !== 3 ||
  candidates[0].origin !== "SELECTED_ARTICLE" ||
  candidates[2].origin !== "OFFICIAL_LINK"
) {
  throw new Error("Article images should rank before official linked pages");
}
```

- [ ] **Step 2: Add the test to the runner and verify failure**

Add this command beside the existing TypeScript test commands in `scripts/run.sh`:

```bash
node dist/references/discovery.test.js
```

Run: `npm test`

Expected: compilation fails because `src/references/discovery.ts` does not exist.

- [ ] **Step 3: Implement bounded discovery**

Create `src/references/discovery.ts` with these exported interfaces:

```ts
interface DiscoveryInput {
  requestId: string;
  person: string;
  selectedArticleUrls: string[];
  fetchHtml?: (url: string) => Promise<string>;
  now?: Date;
}

interface PageMetadata {
  imageUrls: string[];
  officialLinks: string[];
}
```

Use Axios with the existing bot user agent, a 15-second timeout, and `responseType: "text"`. `extractPageMetadata` must:

```ts
const imageSelectors = [
  "meta[property='og:image']",
  "meta[property='og:image:secure_url']",
  "meta[name='twitter:image']",
  "meta[name='twitter:image:src']",
];
```

Resolve URLs with `new URL(value, pageUrl)`, accept only `http:` and `https:`, strip fragments, and deduplicate exact normalized URLs.

`isApprovedOfficialHost` must accept only these host suffixes for the MVP:

```ts
const OFFICIAL_HOSTS = [
  "manutd.com",
  "premierleague.com",
  "thefa.com",
  "uefa.com",
  "fifa.com",
];
```

Fetch at most two official linked pages across the run. Return at most three candidates per request, ranked selected-article metadata first and official-link metadata second. A failed page fetch must skip that page without widening the crawl.

- [ ] **Step 4: Run focused and full tests**

Run: `npm run build && node dist/references/discovery.test.js`

Expected: `Reference discovery tests passed`.

Run: `npm test`

Expected: all discovery tests pass; remaining failures are confined to old coordinator/webhook expectations.

- [ ] **Step 5: Commit**

```bash
git add src/references/discovery.ts src/references/discovery.test.ts scripts/run.sh
git commit -m "feat: discover references from selected articles"
```

### Task 3: Replace Upload Coordination With Bounded Candidate Decisions

**Files:**
- Modify: `src/references/coordinator.ts`
- Modify: `src/references/coordinator.test.ts`

- [ ] **Step 1: Write failing decision-transition tests**

In `src/references/coordinator.test.ts`, replace manual upload assertions with:

```ts
coordinator.attachCandidates(primary.id, [
  candidate,
  { ...candidate, id: "candidate-2", imageUrl: "https://cdn.example/2.jpg", rank: 2 },
]);

const awaiting = coordinator.requestsForRun("run-1").find(
  (request) => request.id === primary.id
);
if (
  awaiting?.status !== "AWAITING_DECISION" ||
  awaiting.activeCandidateId !== "candidate-1"
) {
  throw new Error("Discovery should activate the highest-ranked candidate");
}

const retry = coordinator.decideCandidate(
  primary.id,
  "candidate-1",
  "REJECTED",
  "approver-1"
);
if (
  retry.request.attempt !== 2 ||
  retry.request.activeCandidateId !== "candidate-2" ||
  retry.resolution.ready
) {
  throw new Error("First primary rejection should activate the next candidate");
}

const fallback = coordinator.decideCandidate(
  primary.id,
  "candidate-2",
  "REJECTED",
  "approver-1"
);
if (!fallback.resolution.ready || !fallback.resolution.fallbackToConceptual) {
  throw new Error("Second primary rejection should trigger conceptual fallback");
}
```

Add separate assertions for:

```ts
coordinator.useConceptual("run-3", "approver-1");
coordinator.timeoutRun("run-4", new Date("2026-06-13T12:31:00.000Z"));
```

Verify secondary exhaustion produces `OMITTED`, and replaying the same terminal candidate action returns the existing resolution without another transition.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node dist/references/coordinator.test.js`

Expected: compilation fails because the new coordinator methods do not exist.

- [ ] **Step 3: Implement the candidate coordinator**

In `src/references/coordinator.ts`:

- Initialize new requests as `AWAITING_CANDIDATE`, `attempt: 1`, and `activeCandidateId: null`.
- Remove `attachUpload`, `attachSource`, and upload completeness checks.
- Add:

```ts
interface ReferenceDecisionResult {
  request: ReferenceRequest;
  activeCandidate: ReferenceCandidate | null;
  resolution: ReferenceResolution;
}

attachCandidates(
  requestId: string,
  candidates: ReferenceCandidate[]
): ReferenceDecisionResult

decideCandidate(
  requestId: string,
  candidateId: string,
  decision: "APPROVED" | "REJECTED",
  approverId: string,
  decidedAt?: Date
): ReferenceDecisionResult

useConceptual(
  runId: string,
  approverId: string,
  decidedAt?: Date
): ReferenceResolution
```

Approval marks the candidate and request `APPROVED`. Rejection marks the candidate `REJECTED`; a primary may advance only while `attempt < 2`, otherwise it becomes `REJECTED`. A secondary with no remaining candidate becomes `OMITTED`. `attachCandidates` with an empty list leaves the primary pending for timeout and immediately omits an optional secondary.

Update active statuses to:

```ts
const ACTIVE_STATUSES: ReferenceStatus[] = [
  "AWAITING_CANDIDATE",
  "AWAITING_DECISION",
];
```

Update `ReferenceResolution` to include:

```ts
activeCandidates: ReferenceCandidate[];
```

- [ ] **Step 4: Run focused and full tests**

Run: `npm run build && node dist/references/coordinator.test.js`

Expected: `Reference coordinator tests passed`.

Run: `npm test`

Expected: coordinator and discovery tests pass; Slack tests fail against removed event behavior.

- [ ] **Step 5: Commit**

```bash
git add src/references/coordinator.ts src/references/coordinator.test.ts
git commit -m "feat: coordinate bounded reference decisions"
```

### Task 4: Turn Slack Into a Completed Editorial Decision Surface

**Files:**
- Modify: `src/slack/blocks.ts`
- Modify: `src/webhooks/slack.ts`
- Modify: `src/webhooks/slack.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing Slack block and action tests**

In `src/webhooks/slack.test.ts`, delete file-upload event tests. Add a serialized block assertion:

```ts
const blocks = buildReferenceRequestBlocks(state, requests, candidates);
const payload = JSON.stringify(blocks);
for (const required of [
  state.draftCaption,
  state.filteredArticles[0].title,
  state.visualBrief?.storyHook,
  candidate.imageUrl,
  candidate.sourcePageUrl,
  "Approve reference",
  "Reject & try next",
  "Use conceptual artwork",
]) {
  if (!required || !payload.includes(required)) {
    throw new Error(`Reference card is missing: ${required}`);
  }
}
```

Add action tests using values with:

```ts
{
  thread_id: "run-1",
  stage: "REFERENCE_DECISION",
  request_id: request.id,
  candidate_id: candidate.id,
  action: "APPROVED"
}
```

Assert:

- approval resumes exactly `run-1` once;
- first rejection returns the next candidate without resuming;
- duplicate rejection does not increment the attempt twice;
- `USE_CONCEPTUAL` resumes exactly once with conceptual resolution.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node dist/webhooks/slack.test.js`

Expected: compilation or assertions fail because blocks and action values still use upload-oriented request IDs.

- [ ] **Step 3: Build the new Slack blocks**

Change `buildReferenceRequestBlocks` to:

```ts
export function buildReferenceRequestBlocks(
  state: PipelineState,
  requests: ReferenceRequest[],
  candidates: ReferenceCandidate[]
): KnownBlock[]
```

The opening blocks must show:

```text
Reference approval required
Run: <run id>
Visual hook: <story hook>
Caption:
<finished caption>
Sources:
• <article URL|article title>
```

For each request with an active candidate, add an image block, a provenance section, and actions:

```ts
actionValue(state.runId, "REFERENCE_DECISION", {
  request_id: request.id,
  candidate_id: candidate.id,
  action: "APPROVED",
})
```

Use visible labels `Approve reference` and `Reject & try next`. Add one `Use conceptual artwork` button with action `USE_CONCEPTUAL`.

- [ ] **Step 4: Remove Slack file-event handling and implement actions**

In `src/webhooks/slack.ts`:

- Delete `createSlackEventHandler`, `extractSourceUrl`, `findReferenceRequest`, `SlackEventDependencies`, and `/events`.
- Keep signature verification and `/actions`.
- Change `SlackActionValue` to include `request_id?: string` and `candidate_id?: string`.
- Have `handleSlackActionValue` return:

```ts
interface ReferenceActionOutcome {
  resolution: ReferenceResolution;
  nextCandidate: ReferenceCandidate | null;
}
```

For `REFERENCE_DECISION`, call `decideCandidate`. Resume only when the resolution is ready. For `USE_CONCEPTUAL`, call `useConceptual` and resume immediately. A first rejection returns `nextCandidate` so the router can post the next decision card in the existing Slack thread without waking LangGraph.

Use the action payload's `container.message_ts` as `thread_ts` and post the replacement candidate blocks through `slack.chat.postMessage`.

In `src/index.ts`, remove the console line advertising `POST /slack/events`.

- [ ] **Step 5: Run focused and full tests**

Run: `npm run build && node dist/webhooks/slack.test.js`

Expected: `Slack webhook tests passed`.

Run: `npm test`

Expected: all reference and Slack tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/slack/blocks.ts src/webhooks/slack.ts src/webhooks/slack.test.ts src/index.ts
git commit -m "feat: approve discovered references in Slack"
```

### Task 5: Discover References Before the LangGraph Interrupt

**Files:**
- Modify: `src/graph/nodes/referenceGateway.ts`
- Modify: `src/graph/workflow.test.ts`
- Modify: `src/graph/pipeline.ts`

- [ ] **Step 1: Write failing gateway tests**

In `src/graph/workflow.test.ts`, add an injected gateway test with a completed caption and one selected article:

```ts
const result = await postReferenceRequestNode(state(), {
  discover: async ({ requestId, person }) => [{
    id: `candidate-${person}`,
    requestId,
    person,
    imageUrl: "https://ichef.bbci.co.uk/images/player.jpg",
    sourcePageUrl: state().filteredArticles[0].url,
    origin: "SELECTED_ARTICLE",
    rank: 1,
    status: "AVAILABLE",
    discoveredAt: "2026-06-13T12:00:00.000Z",
  }],
  postMessage,
});

if (
  result.referenceCandidates?.length !== 1 ||
  !JSON.stringify(posts[0]).includes(state().draftCaption ?? "")
) {
  throw new Error("Gateway should discover references and post the completed caption");
}
```

Add a no-candidate test asserting the message still offers conceptual artwork and does not invoke image generation.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node dist/graph/workflow.test.js`

Expected: compilation fails because `postReferenceRequestNode` has no injectable discovery dependencies.

- [ ] **Step 3: Implement gateway discovery**

In `src/graph/nodes/referenceGateway.ts`, define:

```ts
interface ReferenceGatewayDependencies {
  discover: typeof discoverReferenceCandidates;
  postMessage: (message: Record<string, unknown>) => Promise<{ ts?: string }>;
}
```

Default to `discoverReferenceCandidates` and `slack.chat.postMessage`.

For each newly created request:

1. call discovery with the request ID, person, and `state.scoutBrief.selectedArticleUrls`;
2. persist results through `coordinator.attachCandidates`;
3. reload requests and candidates;
4. post `buildReferenceRequestBlocks(state, requests, candidates)`;
5. persist the Slack thread timestamp.

On graph resume, do not rediscover or repost if requests already exist. Return both `referenceRequests` and `referenceCandidates`.

Keep the graph order:

```text
createVisualBrief -> postReferenceRequest -> waitForReferences -> imageGen
```

`waitForReferencesNode` converts the brief to `CONCEPTUAL` when resolution requests fallback and otherwise returns approved persisted candidates.

- [ ] **Step 4: Run focused and full tests**

Run: `npm run build && node dist/graph/workflow.test.js`

Expected: `Workflow tests passed`.

Run: `npm test`

Expected: all tests pass except image buffering tests still expecting Slack authentication.

- [ ] **Step 5: Commit**

```bash
git add src/graph/nodes/referenceGateway.ts src/graph/workflow.test.ts src/graph/pipeline.ts
git commit -m "feat: discover references before Slack approval"
```

### Task 6: Privately Buffer Approved Discovered References

**Files:**
- Modify: `src/visual/cloudinary.ts`
- Modify: `src/visual/providers.test.ts`
- Modify: `src/graph/nodes/imageGen.ts`

- [ ] **Step 1: Write the failing public-reference buffering test**

In `src/visual/providers.test.ts`, construct an approved request and candidate:

```ts
const candidate: ReferenceCandidate = {
  id: "candidate-1",
  requestId: request.id,
  person: request.person,
  imageUrl: "https://ichef.bbci.co.uk/images/player.jpg",
  sourcePageUrl: "https://www.bbc.com/sport/football/articles/example",
  origin: "SELECTED_ARTICLE",
  rank: 1,
  status: "APPROVED",
  discoveredAt: "2026-06-13T12:00:00.000Z",
};

const buffered = await service.bufferDiscoveredReference(request, candidate);
if (
  downloadCalls[0].headers !== undefined ||
  buffered.approvedReference.sourcePageUrl !== candidate.sourcePageUrl ||
  !buffered.signedUrl.includes("authenticated")
) {
  throw new Error("Discovered references should download publicly and buffer privately");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node dist/visual/providers.test.js`

Expected: compilation fails because `bufferDiscoveredReference` does not exist.

- [ ] **Step 3: Implement private buffering**

Replace `bufferReference(request, slackBotToken)` with:

```ts
async bufferDiscoveredReference(
  request: ReferenceRequest,
  candidate: ReferenceCandidate
): Promise<PrivateReferenceAsset>
```

Validate:

```ts
request.status === "APPROVED"
candidate.status === "APPROVED"
request.activeCandidateId === candidate.id
candidate.requestId === request.id
```

Download `candidate.imageUrl` without an Authorization header. Upload to:

```text
man-utd-pipeline/references/<runId>/<requestId>
```

with `type: "authenticated"`, then return the signed URL and an `ApprovedReference` whose provenance is `candidate.sourcePageUrl`.

- [ ] **Step 4: Update image generation**

In `src/graph/nodes/imageGen.ts`, pair each approved request with its approved candidate from `state.referenceCandidates`, call `bufferDiscoveredReference`, and remove the `SLACK_BOT_TOKEN` requirement.

If an approved request has no matching approved candidate, throw:

```ts
throw new Error(`Approved reference has no candidate: ${request.id}`);
```

- [ ] **Step 5: Run focused and full tests**

Run: `npm run build && node dist/visual/providers.test.js`

Expected: `Visual provider tests passed`.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/visual/cloudinary.ts src/visual/providers.test.ts src/graph/nodes/imageGen.ts
git commit -m "feat: buffer approved discovered references"
```

### Task 7: Remove Obsolete Setup and Verify the End-to-End Contract

**Files:**
- Modify: `README.md`
- Modify: `src/graph/workflow.test.ts`
- Modify: `src/webhooks/slack.test.ts`

- [ ] **Step 1: Add final privacy and separation assertions**

In `src/graph/workflow.test.ts`, assert the final approval payload:

```ts
const finalPayload = JSON.stringify(posts[1]);
if (
  finalPayload.includes("ichef.bbci.co.uk") ||
  finalPayload.includes("man-utd-pipeline/references/") ||
  !finalPayload.includes(selectedCandidate.publicUrl)
) {
  throw new Error("Final approval must expose only the generated public candidate");
}
```

In `src/webhooks/slack.test.ts`, assert candidate reference approval never invokes final approval or Meta behavior:

```ts
if (resumes[0]?.value === "APPROVED") {
  throw new Error("Reference approval must not act as final publish approval");
}
```

- [ ] **Step 2: Update setup documentation**

In `README.md`:

- remove Slack `message.groups` and `files:read` setup;
- remove the `/slack/events` Request URL;
- retain only the interactive Request URL `/slack/actions`;
- describe selected-article and direct-official-link discovery;
- state that reference approval, generated-candidate selection, and final publish approval are three separate gates;
- state that no Brave or Perplexity key is required for reference discovery.

- [ ] **Step 3: Run all verification**

Run: `npm test`

Expected: all test scripts pass.

Run: `npm run build`

Expected: TypeScript exits successfully with no diagnostics.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Run a local pipeline smoke test**

Run: `npm run dev:now`

Expected before the Slack interrupt:

```text
[scout] Decision=SELECT
[producer] ...
[factChecker] Result: PASS
[referenceGateway] ...
```

Expected in Slack:

- completed caption;
- selected article source links;
- visual hook;
- candidate preview and provenance;
- `Approve reference`;
- `Reject & try next`;
- `Use conceptual artwork`;
- no instruction to type a name, upload a file, or paste a URL.

Stop the long-running server after verifying the Slack card.

- [ ] **Step 5: Commit**

```bash
git add README.md src/graph/workflow.test.ts src/webhooks/slack.test.ts
git commit -m "docs: finalize automated reference approval flow"
```

## Completion Criteria

- No manual player-name entry, image upload, or source URL is requested.
- Discovery never broadens beyond selected articles and directly linked known official football domains.
- The first Slack card contains the finished caption, evidence, visual hook, preview, provenance, and actions.
- First primary rejection advances once; second rejection, exhaustion, explicit conceptual choice, or timeout falls back.
- Secondary failure omits the secondary without blocking the primary.
- Approved references are privately buffered and never sent to Meta.
- Generated candidate selection and final `Approve & Publish` remain separate.
- `npm test`, `npm run build`, and `git diff --check` pass.
