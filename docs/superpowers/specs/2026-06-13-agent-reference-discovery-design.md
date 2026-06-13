# Agent Reference Discovery and Slack Approval Design

## Goal

Remove manual player-name entry, image upload, and source-URL entry from the
reference workflow. The pipeline should discover reference candidates from
already selected editorial sources, present the completed caption and evidence
in Slack, and require only a human reference decision before image generation.

## Scope

This MVP uses no additional search API. Discovery is limited to:

1. The selected source article and its metadata image.
2. Official pages directly linked from the selected article.
3. Metadata images from those directly linked official pages.

It does not crawl the wider web or query a general search engine.

## Workflow

1. Scout, Producer, and Fact Checker complete normally.
2. Visual Producer identifies the recognizable human cast and creates the
   fact-bounded visual brief.
3. Reference Discovery collects up to three candidates per required person.
4. The Slack reference card includes:
   - the finished caption;
   - selected story sources;
   - the visual hook;
   - reference photo previews;
   - the source-page URL for every candidate;
   - `Approve reference`;
   - `Reject & try next`;
   - `Use conceptual artwork`.
5. Approval stores the chosen reference privately in Cloudinary and resumes the
   exact LangGraph `thread_id`.
6. The first rejection advances to the next unused discovered candidate.
7. A second rejection, no remaining candidate, or a 30-minute timeout converts
   the visual brief to conceptual artwork.
8. FAL generates three candidates.
9. Human candidate selection remains separate.
10. Final `Approve & Publish` remains the only action that calls Meta.

## Reference Discovery

For each selected article:

- Parse `og:image`, `twitter:image`, and other standard social-preview metadata.
- Parse outbound links and retain only official club, league, governing-body,
  or player-owned domains directly linked by the article.
- Fetch a bounded number of retained pages and extract their social-preview
  images.
- Preserve both the image URL and the page URL that supplied it.
- Deduplicate candidates by canonical image URL.
- Reject unsupported protocols, data URLs, and missing source pages.
- Limit work to three usable candidates per person and a small fixed number of
  official-page fetches.

The selected article image is ranked first. Official-page images rank after it.
No candidate is treated as identity-approved until the Slack button is clicked.

## Slack Interaction

The initial reference message is a decision surface, not an upload form. It
must show the caption and sources before asking for reference approval.

Each candidate displays:

- person and role;
- image preview;
- provenance link;
- `Approve reference`;
- `Reject & try next`.

The card also provides `Use conceptual artwork`. Slack action values contain
the LangGraph thread ID, reference request ID, candidate ID, stage, and action.

For multiple people, each person is approved independently. Missing or rejected
secondary references are omitted. A failed primary reference causes conceptual
fallback after the bounded rejection policy.

## Persistence and Privacy

Reference candidates and decisions persist in SQLite so restarts and webhook
resumes preserve the exact workflow. Store candidate metadata separately from
approved private assets:

- candidate ID;
- request ID;
- image URL;
- source-page URL;
- rank;
- status;
- discovery timestamp.

Only an approved candidate is downloaded and uploaded to private Cloudinary
storage. Original image URLs and private Cloudinary URLs never enter the Meta
publish payload.

## Failure Handling

- No discovered primary candidate: immediately offer conceptual artwork and
  automatically fall back on timeout.
- Candidate download or private upload failure: mark that candidate failed and
  show the next one.
- First primary rejection: show the next unused candidate.
- Second primary rejection or exhausted candidates: conceptual fallback.
- Secondary rejection or exhaustion: omit that person.
- Slack replay: action processing remains idempotent.

## Success Criteria

- The user never types the player name.
- The user never uploads a reference or manually supplies its URL.
- The first Slack card shows the completed caption and story sources.
- Every displayed photo has a clickable provenance page.
- Approval resumes the original graph thread.
- Rejection is bounded and cannot create an unending discovery loop.
- Conceptual fallback works without approved references.
- Candidate selection and final publish approval remain separate.

## Testing

Add deterministic tests for:

- metadata extraction and URL canonicalization;
- official-domain filtering;
- candidate deduplication and ranking;
- Slack blocks containing caption, sources, previews, provenance, and actions;
- approval storing the selected candidate;
- first rejection advancing to the next candidate;
- second rejection and exhaustion causing conceptual fallback;
- secondary omission;
- timeout and restart persistence;
- exact-thread resume and action replay;
- no private reference URL in final publishing state.
