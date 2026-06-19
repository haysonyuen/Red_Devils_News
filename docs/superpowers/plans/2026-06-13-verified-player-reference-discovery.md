# Verified Player Reference Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unverified article-preview references with official-domain Brave results that pass deterministic person-name evidence checks and AWS Rekognition face comparison.

**Architecture:** Resolve the requested person to a Wikidata entity and private verification portrait, discover bounded candidates through Brave Image Search, validate each candidate's official provenance and structured labels, then compare its face to the Wikidata portrait. The existing reference coordinator, Slack approval, FAL generation, and publishing flow receive only verified candidates and otherwise use the existing conceptual fallback.

**Tech Stack:** Node.js 22, TypeScript, Axios, Cheerio, Brave Search API, Wikidata APIs, AWS SDK v3 Rekognition, SQLite, existing LangGraph and Slack workflow.

---

## File Structure

- Create `src/references/identity.ts` for Wikidata identity resolution.
- Create `src/references/identity.test.ts` for exact-name, alias, ambiguity, and missing-portrait tests.
- Create `src/references/brave.ts` for bounded official-domain image search.
- Create `src/references/brave.test.ts` for query, host, deduplication, and result-limit tests.
- Create `src/references/evidence.ts` for HTML metadata extraction and independent name-signal validation.
- Create `src/references/evidence.test.ts` for wrong-person, exact-name, surname-only, and duplicate-signal tests.
- Create `src/references/faceVerification.ts` for image download and Rekognition comparison.
- Create `src/references/faceVerification.test.ts` for threshold, no-face, and mismatch tests.
- Rewrite `src/references/discovery.ts` as the verified-discovery orchestrator.
- Rewrite `src/references/discovery.test.ts` as the end-to-end injected-client regression suite.
- Modify `src/graph/contracts.ts` to persist verification metadata.
- Modify `src/references/store.ts` to migrate and persist verification columns.
- Modify `src/references/coordinator.test.ts`, `src/graph/workflow.test.ts`,
  `src/webhooks/slack.test.ts`, and `src/visual/providers.test.ts` fixtures for
  verified candidates.
- Modify `src/graph/nodes/referenceGateway.ts` so zero candidates resolve immediately to conceptual fallback.
- Modify `scripts/run.sh`, `.env.example`, `README.md`, `package.json`, and `package-lock.json`.

### Task 1: Add Wikidata Identity Resolution

**Files:**
- Create: `src/references/identity.ts`
- Create: `src/references/identity.test.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write the failing identity tests**

Create fixtures for an exact Mateus Fernandes result, an alias match, two
equally valid people, and a person without `P18`.

```ts
import { resolvePersonIdentity } from "./identity";

const exact = await resolvePersonIdentity("Mateus Fernandes", {
  search: async () => [
    {
      id: "Q123",
      label: "Mateus Fernandes",
      aliases: ["Mateus Gonçalo Espanha Fernandes"],
      description: "Portuguese association football player",
    },
  ],
  loadEntity: async () => ({
    id: "Q123",
    names: ["Mateus Fernandes", "Mateus Gonçalo Espanha Fernandes"],
    description: "Portuguese association football player",
    portraitUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mateus.jpg",
    officialDomains: ["whufc.com"],
  }),
});

if (exact?.entityId !== "Q123" || !exact.portraitUrl) {
  throw new Error("Exact football identity should resolve");
}
```

Assert that:

- exact normalized full names resolve;
- exact aliases resolve;
- surname-only input does not resolve;
- multiple exact football identities return `null`;
- missing portraits return `null`;
- non-football people return `null`.

- [ ] **Step 2: Run the identity test and verify RED**

Run:

```bash
npm run build
```

Expected: TypeScript fails because `src/references/identity.ts` does not exist.

- [ ] **Step 3: Implement the minimal identity resolver**

Export:

```ts
export interface PersonIdentity {
  entityId: string;
  canonicalName: string;
  aliases: string[];
  description: string;
  portraitUrl: string;
  officialDomains: string[];
}

export interface IdentityDependencies {
  search: (name: string) => Promise<IdentitySearchResult[]>;
  loadEntity: (entityId: string) => Promise<PersonIdentity | null>;
}

export async function resolvePersonIdentity(
  requestedName: string,
  dependencies?: Partial<IdentityDependencies>
): Promise<PersonIdentity | null>;
```

Use Wikidata `wbsearchentities` for search and `Special:EntityData/{id}.json`
for claims. Read English labels and aliases, `P18`, active `P54` club
memberships, and football descriptions. Load each active club entity's `P856`
official website and retain only its normalized hostname. A player's own
`P856` website is not an official club domain. Convert the Commons filename to a
`Special:Redirect/file/<encoded filename>` URL. Normalize names by Unicode
normalization, lowercase conversion, punctuation removal, and collapsed
whitespace. Require an exact full-name or exact alias match.

- [ ] **Step 4: Run the identity test and verify GREEN**

Add `node dist/references/identity.test.js` to the test runner, then run:

```bash
npm test
```

Expected: identity tests and all existing tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/references/identity.ts src/references/identity.test.ts scripts/run.sh
git commit -m "feat: resolve verified football identities"
```

### Task 2: Add Deterministic Page Evidence Validation

**Files:**
- Create: `src/references/evidence.ts`
- Create: `src/references/evidence.test.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write the failing evidence tests**

Create a regression fixture where the requested person is Mateus Fernandes but
the page metadata identifies Bernardo Silva:

```ts
const mismatch = extractCandidateEvidence(
  "https://www.bbc.com/sport/football/articles/gossip",
  `
    <title>Football gossip: Silva, Rashford, Fernandes</title>
    <meta property="og:title" content="Football gossip">
    <meta property="og:image" content="https://ichef.bbci.co.uk/bernardo.png">
    <meta property="og:image:alt" content="Bernardo Silva gossip graphic">
  `
);

if (validateCandidateEvidence("Mateus Fernandes", mismatch).accepted) {
  throw new Error("Bernardo Silva image must not verify Mateus Fernandes");
}
```

Also assert:

- page title plus image alt exact-name signals pass;
- JSON-LD person name plus caption pass;
- surname-only labels fail;
- duplicated Open Graph and Twitter values count once;
- conflicting full person names fail;
- generic or missing labels fail.

- [ ] **Step 2: Run the evidence test and verify RED**

Run:

```bash
npm run build
```

Expected: TypeScript fails because `src/references/evidence.ts` does not exist.

- [ ] **Step 3: Implement evidence extraction and validation**

Export:

```ts
export interface ImageEvidence {
  imageUrl: string;
  sourcePageUrl: string;
  signals: Array<{
    kind: "PAGE_TITLE" | "IMAGE_ALT" | "FIGCAPTION" | "JSON_LD_NAME" | "JSON_LD_CAPTION";
    value: string;
  }>;
}

export interface EvidenceDecision {
  accepted: boolean;
  independentSignalCount: number;
  reason: string;
}

export function extractCandidateEvidence(
  sourcePageUrl: string,
  html: string,
  preferredImageUrl?: string
): ImageEvidence[];

export function validateCandidateEvidence(
  requestedName: string,
  evidence: ImageEvidence
): EvidenceDecision;
```

Parse page title, Open Graph/Twitter titles and image alts, HTML image alts,
figure captions, and JSON-LD. Associate HTML labels only with their matching
image. Deduplicate equivalent signal values within the same semantic kind.
Require two different signal kinds containing an exact normalized full name.
Reject evidence containing a conflicting full name in an image-specific label.

- [ ] **Step 4: Run the evidence tests and verify GREEN**

Add `node dist/references/evidence.test.js` to `scripts/run.sh`, then run:

```bash
npm test
```

Expected: the Bernardo Silva regression and all evidence tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/references/evidence.ts src/references/evidence.test.ts scripts/run.sh
git commit -m "feat: validate player image evidence"
```

### Task 3: Add Bounded Brave Official-Domain Search

**Files:**
- Create: `src/references/brave.ts`
- Create: `src/references/brave.test.ts`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Write the failing Brave tests**

Use an injected HTTP client and assert the exact query and limits:

```ts
const calls: Array<{ query: string; count: number }> = [];
const results = await searchOfficialPlayerImages(
  {
    canonicalName: "Mateus Fernandes",
    officialDomains: ["whufc.com", "premierleague.com"],
  },
  {
    searchImages: async (query, count) => {
      calls.push({ query, count });
      return [
        {
          imageUrl: "https://cdn.whufc.com/mateus.jpg",
          sourcePageUrl: "https://www.whufc.com/player/mateus-fernandes",
          title: "Mateus Fernandes",
        },
      ];
    },
  }
);

if (!calls[0]?.query.includes('"Mateus Fernandes" site:whufc.com')) {
  throw new Error("Brave query must bind exact name to an official domain");
}
```

Assert that:

- only approved domains are queried;
- no more than five domains are queried;
- no more than ten raw results survive;
- duplicate image/source pairs are removed;
- off-domain source pages are rejected;
- a missing API key throws a typed configuration error.

- [ ] **Step 2: Run the Brave tests and verify RED**

Run:

```bash
npm run build
```

Expected: TypeScript fails because `src/references/brave.ts` does not exist.

- [ ] **Step 3: Implement the Brave client**

Export:

```ts
export interface BraveImageResult {
  imageUrl: string;
  sourcePageUrl: string;
  title: string;
}

export async function searchOfficialPlayerImages(
  input: {
    canonicalName: string;
    officialDomains: string[];
  },
  dependencies?: {
    searchImages?: (query: string, count: number) => Promise<BraveImageResult[]>;
  }
): Promise<BraveImageResult[]>;
```

The default client calls:

```text
GET https://api.search.brave.com/res/v1/images/search
X-Subscription-Token: BRAVE_SEARCH_API_KEY
Accept: application/json
```

Build one exact-name `site:` query per domain, cap at five domains, request at
most ten results total, validate both image and source URLs as HTTP(S), enforce
source host membership, and deduplicate canonical URL pairs.

- [ ] **Step 4: Run Brave tests and verify GREEN**

Add `node dist/references/brave.test.js` to `scripts/run.sh`, then run:

```bash
npm test
```

Expected: Brave unit tests and all existing tests pass without making network
requests.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/references/brave.ts src/references/brave.test.ts scripts/run.sh
git commit -m "feat: search official player images with Brave"
```

### Task 4: Add AWS Rekognition Face Verification

**Files:**
- Create: `src/references/faceVerification.ts`
- Create: `src/references/faceVerification.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/run.sh`

- [ ] **Step 1: Install the focused AWS SDK client**

Run:

```bash
npm install @aws-sdk/client-rekognition
```

Expected: `package.json` and `package-lock.json` add only the Rekognition SDK
and its transitive dependencies.

- [ ] **Step 2: Write the failing face-verification tests**

Use injected image downloads and comparison calls:

```ts
const accepted = await verifyCandidateFace(
  {
    anchorUrl: "https://commons.wikimedia.org/mateus.jpg",
    candidateUrl: "https://cdn.whufc.com/mateus.jpg",
    threshold: 95,
  },
  {
    downloadImage: async () => Buffer.from("image"),
    compareFaces: async () => ({
      sourceFaceDetected: true,
      targetFaceDetected: true,
      similarities: [98.4],
    }),
  }
);

if (!accepted.accepted || accepted.similarity !== 98.4) {
  throw new Error("High-confidence face match should pass");
}
```

Assert:

- 95 or greater passes;
- below 95 fails;
- missing source face fails;
- missing target face fails;
- no face matches fail;
- network and Rekognition errors return a rejected decision;
- configured threshold is clamped to 90–99.

- [ ] **Step 3: Run the face test and verify RED**

Run:

```bash
npm run build
```

Expected: TypeScript fails because `faceVerification.ts` does not exist.

- [ ] **Step 4: Implement face verification**

Export:

```ts
export interface FaceVerificationDecision {
  accepted: boolean;
  similarity: number | null;
  reason: string;
}

export async function verifyCandidateFace(
  input: {
    anchorUrl: string;
    candidateUrl: string;
    threshold?: number;
  },
  dependencies?: {
    downloadImage?: (url: string) => Promise<Buffer>;
    compareFaces?: (
      source: Buffer,
      target: Buffer,
      threshold: number
    ) => Promise<FaceComparisonResult>;
  }
): Promise<FaceVerificationDecision>;
```

The default comparison uses `RekognitionClient` and `CompareFacesCommand`.
Download both images with a 10-second timeout and a 10 MB response limit.
Pass bytes directly to Rekognition and retain no image data after the call.
Use `REFERENCE_FACE_SIMILARITY_THRESHOLD`, defaulting to 95.

- [ ] **Step 5: Run the face tests and verify GREEN**

Add `node dist/references/faceVerification.test.js` to `scripts/run.sh`, then
run:

```bash
npm test
```

Expected: face-verification tests and all existing tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add package.json package-lock.json src/references/faceVerification.ts src/references/faceVerification.test.ts scripts/run.sh
git commit -m "feat: verify player faces with Rekognition"
```

### Task 5: Orchestrate Verified Discovery and Persist Audit Metadata

**Files:**
- Modify: `src/graph/contracts.ts`
- Modify: `src/references/store.ts`
- Rewrite: `src/references/discovery.ts`
- Rewrite: `src/references/discovery.test.ts`
- Modify: `src/references/coordinator.test.ts`
- Modify: `src/graph/workflow.test.ts`
- Modify: `src/webhooks/slack.test.ts`
- Modify: `src/visual/providers.test.ts`

- [ ] **Step 1: Write the failing verified-discovery regression tests**

Use injected identity, Brave, HTML, and face clients. Assert:

```ts
const candidates = await discoverReferenceCandidates({
  requestId: "request-1",
  person: "Mateus Fernandes",
  resolveIdentity: async () => mateusIdentity,
  searchImages: async () => [
    bernardoResult,
    mateusOfficialResult,
  ],
  fetchHtml: async (url) =>
    url.includes("bernardo") ? bernardoMetadataHtml : mateusMetadataHtml,
  verifyFace: async ({ candidateUrl }) =>
    candidateUrl.includes("mateus")
      ? { accepted: true, similarity: 98, reason: "MATCH" }
      : { accepted: false, similarity: 12, reason: "BELOW_THRESHOLD" },
  now: new Date("2026-06-13T12:00:00.000Z"),
});

if (
  candidates.length !== 1 ||
  candidates[0].imageUrl !== mateusOfficialResult.imageUrl
) {
  throw new Error("Only the verified Mateus Fernandes candidate should survive");
}
```

Also assert:

- no identity returns no candidates;
- insufficient evidence never calls Rekognition;
- no verified candidate returns an empty list;
- ranking uses profile-page status, similarity, signal count, then URL;
- selected article URLs are not fetched or accepted;
- only three candidates reach Rekognition.

- [ ] **Step 2: Run verified discovery and verify RED**

Run:

```bash
npm test
```

Expected: discovery tests fail because current discovery still ranks selected
article preview images and lacks verification metadata.

- [ ] **Step 3: Extend the candidate contract**

Change `ReferenceCandidate` to:

```ts
export interface ReferenceCandidate {
  id: string;
  requestId: string;
  person: string;
  imageUrl: string;
  sourcePageUrl: string;
  origin: "BRAVE_OFFICIAL";
  entityId: string;
  evidenceSignalCount: number;
  faceSimilarity: number;
  verificationAnchorUrl: string;
  rank: number;
  status: ReferenceCandidateStatus;
  discoveredAt: string;
}
```

Update test fixtures to use verified metadata rather than article origins.

- [ ] **Step 4: Add SQLite migration and persistence**

Add nullable columns when absent:

```sql
ALTER TABLE reference_candidates ADD COLUMN entity_id TEXT;
ALTER TABLE reference_candidates ADD COLUMN evidence_signal_count INTEGER;
ALTER TABLE reference_candidates ADD COLUMN face_similarity REAL;
ALTER TABLE reference_candidates ADD COLUMN verification_anchor_url TEXT;
```

After adding the columns, delete legacy candidates where `entity_id IS NULL`.
Those records came from the unverified article-preview workflow and must never
be presented as verified. New inserts require all verification fields.
Requests with a deleted active candidate can receive newly discovered
candidates normally because discovery checks persisted candidates rather than
trusting a stale active-candidate ID.

- [ ] **Step 5: Rewrite discovery as orchestration**

`discoverReferenceCandidates()` should:

1. resolve `person`;
2. combine fixed approved domains with `identity.officialDomains`, which were
   resolved from current-club entities;
3. call Brave;
4. fetch each source page;
5. extract evidence for the Brave image;
6. reject evidence below two signals;
7. compare the candidate with the Wikidata portrait;
8. reject failed comparisons;
9. rank and return at most three `BRAVE_OFFICIAL` candidates.

Keep every external operation injectable. Remove selected-article image
extraction and official-link crawling from this module.

- [ ] **Step 6: Run verified discovery and persistence tests**

Run:

```bash
npm test
```

Expected: all tests pass, including the Bernardo/Mateus regression and SQLite
round-trip verification metadata.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/graph/contracts.ts src/references/store.ts src/references/discovery.ts src/references/discovery.test.ts src/references/coordinator.test.ts src/graph/workflow.test.ts src/webhooks/slack.test.ts src/visual/providers.test.ts
git commit -m "feat: persist verified player references"
```

### Task 6: Fail Closed at the Reference Gateway

**Files:**
- Modify: `src/graph/nodes/referenceGateway.ts`
- Modify: `src/graph/workflow.test.ts`

- [ ] **Step 1: Write the failing zero-candidate gateway test**

Add a primary-person gateway case where discovery returns `[]`. Assert that:

- no reference approval card is posted;
- the primary request becomes rejected;
- the returned visual brief becomes `CONCEPTUAL`;
- no unverified candidate is persisted.

```ts
const result = await postReferenceRequestNode(state(), {
  coordinator,
  discover: async () => [],
  postMessage: async () => {
    throw new Error("Slack must not receive an empty reference card");
  },
});

if (result.visualBrief?.compositionMode !== "CONCEPTUAL") {
  throw new Error("Missing verified primary must fail closed");
}
```

- [ ] **Step 2: Run workflow tests and verify RED**

Run:

```bash
npm run build && node dist/graph/workflow.test.js
```

Expected: FAIL because the current request remains
`AWAITING_CANDIDATE` and Slack is still posted.

- [ ] **Step 3: Implement immediate conceptual fallback**

After discovery, resolve requests with no candidates:

- primary: call a coordinator operation that marks it `REJECTED`;
- secondary: mark it `OMITTED`;
- if the resulting resolution requires conceptual fallback, return a
  person-free conceptual visual brief immediately;
- post Slack only when at least one decision-ready candidate exists.

Add the smallest coordinator method needed to resolve a no-candidate request;
do not reuse timeout timestamps or invent a fake candidate.

- [ ] **Step 4: Run workflow and full tests**

Run:

```bash
npm test
```

Expected: all tests pass and empty verified discovery cannot leave the graph
waiting on an impossible Slack decision.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/graph/nodes/referenceGateway.ts src/references/coordinator.ts src/references/coordinator.test.ts src/graph/workflow.test.ts
git commit -m "fix: fall back when no verified reference exists"
```

### Task 7: Document Configuration and Add an Opt-In Integration Check

**Files:**
- Create: `src/references/integration.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add the opt-in integration check**

The script should exit successfully with a clear skip message unless
`RUN_REFERENCE_INTEGRATION=1`. When enabled, it must require:

```dotenv
BRAVE_SEARCH_API_KEY=
AWS_REGION=us-east-1
```

and AWS credentials through either the standard provider chain or local
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Run discovery for one explicit test person from
`REFERENCE_INTEGRATION_PERSON`, defaulting to `Marcus Rashford`, and print only
candidate count, official source hosts, and similarity scores. Never print
keys, image bytes, or credential details.

- [ ] **Step 2: Update environment documentation**

Add to `.env.example`:

```dotenv
# Verified official player-reference discovery
BRAVE_SEARCH_API_KEY=
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
REFERENCE_FACE_SIMILARITY_THRESHOLD=95
```

Document that IAM roles or AWS profiles are preferred outside local
development and static keys must never be committed.

- [ ] **Step 3: Update README workflow**

Replace the article-preview discovery paragraph with:

```text
For person-based visuals, the pipeline resolves the person through Wikidata,
searches approved official domains through Brave, requires two independent
exact-name metadata signals, and compares the candidate against the Wikidata
portrait using AWS Rekognition. Only verified candidates appear in Slack.
Failure at any stage uses person-free conceptual artwork.
```

Add the five new environment variables to the environment table and describe
the opt-in integration command:

```bash
RUN_REFERENCE_INTEGRATION=1 npm run test:references:integration
```

- [ ] **Step 4: Add the integration npm script**

Add:

```json
"test:references:integration": "bash scripts/run.sh reference-integration"
```

Add a `reference-integration` branch to `scripts/run.sh` that compiles and runs
`dist/references/integration.test.js`.

- [ ] **Step 5: Run documentation and normal verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all commands pass without external API calls.

- [ ] **Step 6: Run the live integration check**

After AWS credentials are configured, run:

```bash
RUN_REFERENCE_INTEGRATION=1 npm run test:references:integration
```

Expected: at least one verified official reference for the configured test
person, or a clear fail-closed result describing which identity, evidence, or
face gate rejected all candidates.

- [ ] **Step 7: Commit Task 7**

```bash
git add .env.example README.md package.json package-lock.json scripts/run.sh src/references/integration.test.ts
git commit -m "docs: configure verified reference discovery"
```

### Task 8: Final Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run the complete automated suite**

```bash
npm test
```

Expected: every unit, contract, workflow, and persona test passes.

- [ ] **Step 2: Run a clean build**

```bash
npm run build
```

Expected: TypeScript exits successfully with no diagnostics.

- [ ] **Step 3: Check repository hygiene**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional uncommitted files, preferably
none.

- [ ] **Step 4: Run the live pipeline after credentials are ready**

```bash
npm run dev:now
```

Expected for a person story:

- the requested person resolves to one canonical identity;
- no selected-article preview image is considered;
- only verified official candidates appear in Slack;
- the Slack card includes the completed caption and working decision buttons;
- no candidate produces immediate conceptual fallback;
- approval continues through FAL and later approval stages.

- [ ] **Step 5: Verify the known failure is impossible**

Inspect the Slack candidate for a multi-person gossip story. Confirm its
provenance page labels the requested person and its logged similarity is at
least the configured threshold. A Bernardo Silva-labelled image must never be
shown for a Mateus Fernandes request.
