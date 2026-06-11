# Four-Agent Instagram Newsroom Design

Date: 2026-06-11  
Status: Approved design, not implemented

## Objective

Build a four-agent Manchester United newsroom that creates timely, visually compelling Instagram posts from trusted reporting while preserving factual accuracy and explicit human control over reference images, generated candidates, and final publishing.

The target visual style is a bold mobile-first editorial composite:

- Recognizable real-world subjects
- Clear story meaning before the caption is read
- Strong subject/background separation
- Club context communicated through composition, colors, props, kits, or crests
- Short supporter-led captions
- Visual dramatization whose certainty does not exceed the reporting

## Architecture

```text
Scheduled trigger
  -> deterministic ingestion
  -> Scout Agent
  -> Editor/Caption Producer Agent
  -> Fact Checker Agent
  -> Visual Producer Agent
  -> deterministic reference coordinator
  -> FAL candidate generation
  -> Visual Producer candidate evaluation
  -> human image selection
  -> final Slack approval
  -> deterministic Instagram publishing
```

LangGraph owns orchestration, bounded retries, checkpointing, and state transitions. Deterministic services own RSS, scraping, Slack events, timers, file handling, FAL calls, Cloudinary uploads, and Meta publishing.

## Agent 1: Scout

### Purpose

Select a current story with both editorial value and strong visual potential.

### Inputs

- Recent allowlisted articles
- Previously rejected story URLs for the current run
- Previously published story history when deduplication is added

### Output

```json
{
  "decision": "SELECT",
  "primaryStory": "string",
  "supportingSourceUrls": ["string"],
  "mainCharacters": ["string"],
  "storyStatus": "CONFIRMED",
  "visualPotential": 90,
  "selectionReason": "string",
  "confidence": 0.95
}
```

`decision` is `SELECT` or `NO_STORY`.

`storyStatus` is:

- `CONFIRMED`
- `ADVANCED`
- `INTEREST`
- `SPECULATION`

### Responsibilities

- Prefer current, consequential Manchester United stories.
- Reject stale, duplicated, thin, or weakly sourced stories.
- Identify the main people and club entities involved.
- Classify reporting certainty.
- Select only supplied source URLs.
- Avoid selecting a story merely to satisfy the posting schedule.

### Success

- Source URLs are valid and allowlisted.
- Certainty classification matches source language.
- Story has a clear supporter angle.
- Story has a visual concept understandable on a mobile feed.

## Agent 2: Editor/Caption Producer

### Purpose

Exercise editorial judgment and create the final supporter-led caption.

### Inputs

- Scout proposal
- Selected source articles
- Rejection or revision feedback

### Output

```json
{
  "decision": "ACCEPT",
  "decisionReason": "string",
  "angle": "string",
  "facts": [
    {
      "claim": "string",
      "sourceUrl": "string"
    }
  ],
  "supporterOpinion": "string",
  "caption": "string",
  "headlineOptions": ["string"]
}
```

`decision` is:

- `ACCEPT`
- `REJECT_AND_RESCOUT`
- `REJECT_AND_END`

### Responsibilities

- Reject stories with insufficient evidence, weak relevance, unresolved conflict, excessive speculation, or no worthwhile United angle.
- Separate reported facts from supporter opinion.
- Write in original language as an informed, emotionally invested United supporter.
- Keep the caption concise and mobile-friendly.
- Add value beyond summarizing the source article.
- Produce headline options for visual composition, not final baked-in text.
- Create no image prompt or visual composition.

### Caption Standard

- 220 to 420 characters, including hashtags
- One strong supporter hook
- One or two material verified facts
- One clear supporter perspective
- One specific football discussion question
- Three to five relevant hashtags
- No copied source phrasing
- No neutral newswire voice
- No unsupported certainty, quotes, statistics, or inside knowledge

### Producer Rejection Loop

- First `REJECT_AND_RESCOUT`: Scout selects one different story.
- Second Producer rejection: end the run.
- The Scout may not return the previously rejected story in the same run.

### Success

- Decision is explicit.
- Accepted facts cite selected sources.
- Caption passes deterministic length, originality, voice, question, and hashtag checks.
- A reader can understand the post's point within five seconds.

## Agent 3: Fact Checker

### Purpose

Audit every material claim and define the truth boundaries for both caption and visual production.

### Inputs

- Accepted caption
- Fact list
- Source article evidence
- Scout certainty classification

### Output

```json
{
  "status": "PASS",
  "storyStatus": "INTEREST",
  "claimChecks": [
    {
      "claim": "string",
      "verdict": "SUPPORTED",
      "evidence": "string",
      "sourceUrl": "string"
    }
  ],
  "visualImplicationsAllowed": ["string"],
  "visualImplicationsForbidden": ["string"],
  "issues": [],
  "revisionFeedback": null
}
```

`status` is `PASS`, `REVISE`, or `REJECT`.

Claim verdicts are:

- `SUPPORTED`
- `UNSUPPORTED`
- `OPINION`

### Responsibilities

- Extract and classify every material factual claim.
- Verify quotations, numbers, dates, contract details, and transfer status.
- Ensure uncertainty is not presented as fact.
- Permit clearly framed supporter opinion.
- Explicitly define what the visual may and may not imply.
- Never modify the caption directly.

### Revision Loop

- One `REVISE` may return to the Producer.
- A second failure ends the run.
- `REJECT` ends the run immediately.

### Success

- Every material factual claim is classified.
- Supported claims cite supplied evidence.
- No unsupported claim remains after `PASS`.
- Visual certainty boundaries are explicit and consistent with story status.

## Agent 4: Visual Producer

### Purpose

Translate the fact-checked story into a high-impact editorial composite and manage its creative quality.

### Inputs

- Fact-checked story and caption
- Story certainty status
- Allowed and forbidden visual implications

### Phase 1 Output: Visual Brief and Reference Request

```json
{
  "storyHook": "string",
  "emotionalGoal": "string",
  "primaryCharacter": "string",
  "secondaryCharacters": ["string"],
  "compositionMode": "PRIMARY_WITH_SECONDARIES",
  "requiredSignals": ["string"],
  "forbiddenImplications": ["string"],
  "referenceRequirements": [
    {
      "person": "string",
      "role": "PRIMARY",
      "required": true
    }
  ],
  "searchInstructions": ["string"],
  "generationPromptTemplate": "string",
  "conceptualFallbackPrompt": "string",
  "referenceWarning": null
}
```

`compositionMode` is:

- `PRIMARY_WITH_BACKGROUND`
- `PRIMARY_WITH_SECONDARIES`
- `CONCEPTUAL`

### Responsibilities

- Identify the primary character.
- Include secondary people only when essential to understanding the story.
- Decide between primary-only and multi-person composition.
- Request an approved reference for every recognizable person.
- Warn, but continue, when more than three references are required.
- Create a clear emotional and narrative visual brief.
- Produce targeted trusted-domain-first search instructions.
- Produce an identity-preserving prompt template that does not yet contain reference assets.
- Produce a conceptual fallback prompt.
- After reference resolution, produce the final FAL prompt and reference mapping.
- Evaluate each generated candidate against the approved brief.

### Phase 2 Inputs

- Approved reference images and source-page URLs
- Timed-out, rejected, and omitted reference requests
- The Phase 1 visual brief

### Phase 2 Output: Generation Request

```json
{
  "compositionMode": "PRIMARY_WITH_SECONDARIES",
  "includedPeople": ["string"],
  "omittedPeople": ["string"],
  "approvedReferenceIds": ["string"],
  "generationPrompt": "string",
  "candidateCount": 3,
  "fallbackUsed": false
}
```

Deterministic code validates this request and calls FAL. The Visual Producer never calls FAL, Slack, Cloudinary, or a search engine directly.

### Reference Discovery and Approval

Version one uses a manual open-web workflow:

1. Visual Producer supplies targeted trusted-domain-first search instructions.
2. Human searches the open web.
3. Human uploads a candidate image in the Slack thread.
4. Human supplies the original source-page URL.
5. Slack presents `Approve Reference` and `Reject Reference`.
6. Upload alone never counts as approval.
7. Original reference remains private and is never directly published.

For every recognizable person:

- A separate approved reference is required.
- There is no hard cast limit.
- More than three people displays a workload and quality warning.

### Timeout and Fallback

The reference workflow waits 30 minutes.

- Rejected primary reference: request one alternative.
- Second primary rejection or no primary reference: use conceptual fallback.
- Missing or unapproved secondary reference: omit that person and continue.
- Club-only story: generate conceptual artwork immediately without reference approval.

## Visual Certainty Rules

| Story status | Permitted visual treatment |
|---|---|
| `CONFIRMED` | Destination kit, crest, signing context, or completed-event framing |
| `ADVANCED` | Destination colors or crest; current or neutral clothing; no completed signing implication |
| `INTEREST` | Current or neutral clothing with destination crest, colors, or split composition |
| `SPECULATION` | Current or neutral clothing with symbolic context only |

The Fact Checker's explicit allowed and forbidden implications override this default table.

## Candidate Generation and Evaluation

FAL generates three candidates from the approved references and visual brief.

The Visual Producer evaluates each candidate for:

- Identity fidelity
- Story alignment
- Factual integrity
- Visual quality
- Feed impact
- Caption complement

### Hard Failures

A candidate is disqualified when:

- A person is not recognizable as the approved subject.
- A face, body, hand, or object has a critical artifact.
- The image depicts the wrong person.
- Story meaning is unclear at mobile size.
- The scene contradicts evidence or exceeds reporting certainty.
- A crest, kit, sponsor, shirt number, or embedded text is malformed.
- The primary subject is visually weak or obscured.

### Initial Thresholds

```text
Identity fidelity       >= 90/100 per recognizable person
Story alignment         >= 85/100
Feed impact             >= 85/100
Composition             >= 80/100
Caption complement      >= 80/100
Factual integrity       >= 80/100 and no critical violation
```

Scores filter and rank candidates. Human judgment remains authoritative.

### Human Candidate Selection

Slack shows every qualified candidate with:

- Candidate image
- Overall recommendation
- Per-dimension scores
- Visual rationale
- Identity or factual warnings

The human selects one candidate.

If none is acceptable:

- Permit one regeneration, or
- Choose conceptual fallback.

## Slack Interaction Model

The existing action endpoint remains:

```text
POST /slack/actions
```

The Slack Events API adds:

```text
POST /slack/events
```

Events are used to receive:

- Thread replies
- Uploaded reference files
- Source-page URLs

Each reference approval records:

- Run and thread IDs
- Person name and role
- Slack file ID and private download location
- Source-page URL
- Uploader
- Approval or rejection
- Decision timestamp

Reference approval and final post approval are separate Slack stages.

## Final Approval and Publishing

The final Slack card contains:

- Selected image
- Caption
- Story sources
- Fact-check result
- Visual scores and warnings
- Reference audit summary

The human selects:

- `Approve & Publish`
- `Reject`

Only explicit approval resumes the exact LangGraph thread and calls Meta publishing.

## State and Persistence

New state groups:

```text
storySelection
producerDecision
factCheck
visualBrief
referenceRequests[]
referenceApprovals[]
generatedCandidates[]
selectedCandidate
visualEvaluation
approvalStatus
publishStatus
```

SQLite checkpointing persists every pause and decision. Reference image binaries are stored privately outside LangGraph state; state stores IDs, URLs, hashes, and metadata.

## Error Handling

- No valid story: end cleanly.
- Producer rejects twice: end cleanly.
- Fact check rejects or fails twice: end cleanly.
- Slack reference timeout: apply omission or fallback rules.
- FAL partial candidate failure: continue if at least one qualified candidate remains.
- No qualified candidates: one regeneration or conceptual fallback.
- Cloudinary failure: end before final approval.
- Slack callback cannot identify run: reject callback and log.
- Meta failure: mark `FAILED`, preserve approved assets and state for diagnosis.

## Testing Strategy

### Contract Tests

- Every agent schema accepts valid output and rejects malformed output.
- Agent URLs map only to supplied sources.
- Producer rejection triggers one alternate Scout selection.
- Fact Checker revision is bounded to one attempt.
- Visual certainty rules match story status.

### Workflow Tests

- Single-person approved-reference path
- Multi-person path with all references approved
- Missing secondary reference omission
- Primary reference rejected twice to conceptual fallback
- Thirty-minute timeout handling
- Three-candidate generation and ranking
- No qualified candidates followed by one regeneration
- Final Slack selection and exact-thread resume

### Evaluation Fixtures

Fixtures cover:

- Confirmed transfer
- Advanced negotiation
- Club interest
- Weak speculation
- Manager/board meeting
- Multiple-person story
- Player departure
- Club-only tactical or financial story

Each fixture defines expected:

- Story status
- Producer decision
- Caption properties
- Allowed and forbidden visual implications
- Primary and secondary cast
- Candidate quality characteristics

## Success Metrics

### Per Run

- Every factual claim supported or clearly marked opinion
- Caption passes deterministic validation
- Every recognizable person has an approved reference
- At least one qualified image candidate or accepted conceptual fallback
- Final Slack card is complete
- Meta returns a media ID after approval

### Operational

- Duplicate post rate
- Producer and Fact Checker rejection rates
- Reference approval completion time
- Candidate qualification rate
- Regeneration and fallback rates
- API failure rate by provider
- Average cost per published post

### Post Performance

Store:

- Selected and rejected candidate IDs
- Human rejection reasons
- Reach
- Likes
- Comments
- Saves
- Shares
- Engagement rate

Performance metrics inform future visual briefs and rankings but do not override factual or human approval gates.

## Explicit Non-Goals for Version One

- Automated open-web image scraping
- Automatic copyright or licensing determination
- Direct publication of reference images
- Fully autonomous reference approval
- Fully autonomous final publishing
- Separate visual workflow service
- Parallel LangGraph reference subgraphs
- Automatic performance-driven prompt optimization

## Approved Design Decisions

- Four runtime agents: Scout, Editor/Caption Producer, Fact Checker, Visual Producer
- Approach A: Visual Producer plus deterministic Reference Coordinator
- Open-web reference discovery is manual for version one
- Trusted domains are searched first
- References are uploaded into Slack threads with source-page URLs
- Every recognizable person requires a separately approved reference
- No hard cast limit; warn above three people
- Reference approval is separate from final post approval
- Thirty-minute reference timeout
- One alternative after reference rejection
- Missing secondary references are omitted
- Missing primary reference triggers conceptual fallback
- Club-only stories use immediate conceptual artwork
- Three generated candidates
- Visual Producer evaluates; human selects
- One regeneration or conceptual fallback when no candidate is acceptable
- Original reference images remain private
- No mandatory AI-generated-art disclosure in the Instagram caption
