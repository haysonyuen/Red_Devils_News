# Verified Player Reference Discovery Design

## Objective

Replace article-preview image selection with a verified player-reference
pipeline. A candidate must be associated with the requested person by
structured page evidence and pass face comparison before it can appear in
Slack.

The system must fail closed: if identity cannot be verified, it uses the
existing person-free conceptual fallback instead of guessing.

## Scope

This change affects reference discovery and configuration only.

It does not change:

- Scout story selection;
- Producer caption creation;
- Fact Checker review;
- Visual Producer character selection;
- Slack's mandatory human reference approval;
- FAL generation;
- final Slack publish approval;
- Meta publishing.

## Data Flow

```text
Visual Producer reference requirement
  -> resolve exact person identity
  -> load trusted identity anchors
  -> Brave search on approved official domains
  -> extract candidate image and structured labels
  -> deterministic identity-evidence validation
  -> AWS Rekognition face comparison
  -> rank verified candidates
  -> Slack reference approval
  -> existing private buffering and FAL generation
```

## Identity Resolution

The requested full name is resolved through Wikidata. A usable identity must:

- have an exact normalized name or alias match;
- represent a human football player, coach, or football executive;
- expose a Wikidata entity ID;
- expose a `P18` portrait;
- expose current-club membership through a non-ended `P54` statement when one
  is available;
- provide football context sufficient to disambiguate names when multiple
  entities match.

The `P18` image is the first trusted identity anchor. It is not published and
is used only for face comparison. A previously human-approved official
reference for the same Wikidata entity may also be used as an anchor.

Current club domains are resolved from each active `P54` club entity's `P856`
official website statement. A player's personal `P856` website does not become
an approved club domain.

If identity resolution is ambiguous or has no portrait, recognizable-person
discovery fails closed.

## Brave Candidate Discovery

Brave Image Search finds candidate images for the resolved person. Queries use
the canonical full name and one approved domain at a time.

Initial approved domains:

- `manutd.com`
- `premierleague.com`
- `thefa.com`
- `uefa.com`
- `fifa.com`
- official current club domains resolved through the player's active Wikidata
  `P54` club membership and that club's `P856` official website statement

Search is bounded to avoid unnecessary requests:

- at most five official-domain queries per person;
- at most ten raw results inspected;
- at most three candidates sent to Rekognition;
- at most three verified candidates persisted.

Selected news article preview images are not candidates unless the same image
is independently returned from an approved official page and passes all
checks.

## Deterministic Evidence Validation

Each Brave result is followed to its source page. The page extractor records:

- page title;
- canonical URL;
- Open Graph title and image alt text;
- Twitter title and image alt text;
- matching HTML image alt text and nearby figure caption;
- JSON-LD person name, image URL, and caption where available.

A candidate needs at least two independent exact-name signals. Valid examples
include:

- page title plus image alt text;
- JSON-LD person name plus image caption;
- Open Graph title plus matching HTML image alt text.

Repeated copies of the same field do not count as independent signals.
Conflicting person names, unlabeled images, generic roundup graphics, and
multi-person images without a uniquely labelled requested person are rejected.

Name matching is case-insensitive and punctuation-insensitive but does not use
substring-only matching. For example, `Fernandes` alone cannot verify `Mateus
Fernandes`.

## Face Verification

AWS Rekognition `CompareFaces` compares each surviving candidate with trusted
identity anchors.

A candidate is accepted only when:

- Rekognition detects a face in the trusted anchor;
- Rekognition detects a face in the candidate;
- the best match is at least 95 percent similarity;
- no conflicting face result makes the requested identity ambiguous.

The implementation records the similarity score and anchor identity for audit
and ranking. Network errors, unreadable images, no-face responses, and scores
below the threshold reject the candidate.

Rekognition is an additional check, not the source of identity. Metadata
validation must pass first.

## Ranking

Verified candidates are ranked deterministically:

1. exact official player-profile page;
2. highest face similarity;
3. strongest count of independent name signals;
4. newest official source when a date is available;
5. stable URL ordering.

Slack receives no unverified candidate.

## Persistence

The existing reference candidate model gains optional verification metadata:

- canonical Wikidata entity ID;
- evidence signal count;
- Rekognition similarity;
- verification anchor URL;
- verification status.

Human-approved candidates may be reused as trusted anchors for the same
Wikidata identity. Source images remain private and never enter the Meta
publishing payload.

## Failure Behavior

- Missing Brave key: log a configuration error and use conceptual fallback.
- Missing AWS configuration: log a configuration error and use conceptual
  fallback.
- Ambiguous Wikidata identity: use conceptual fallback.
- No official-domain result: use conceptual fallback.
- Insufficient name evidence: reject the candidate.
- Face mismatch or no detectable face: reject the candidate.
- All candidates rejected: use conceptual fallback.

The pipeline must never fall back to an unverified article image.

## Configuration

Add these environment variables:

```dotenv
BRAVE_SEARCH_API_KEY=
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
REFERENCE_FACE_SIMILARITY_THRESHOLD=95
```

AWS's standard credential provider chain remains supported, so deployed
environments may use an IAM role instead of static keys.

## Security and Cost Controls

- Never log API keys, AWS credentials, or downloaded image bytes.
- Download only HTTP(S) images from validated result URLs.
- Apply existing URL validation before fetching.
- Set bounded response sizes and timeouts for page and image downloads.
- Do not persist Rekognition image bytes.
- Keep search and comparison counts within the stated per-person bounds.

## Testing

Unit tests must cover:

- the Bernardo Silva image being rejected for Mateus Fernandes;
- an exact-name official player image passing evidence validation;
- surname-only and unlabeled images being rejected;
- duplicate metadata fields not counting as independent evidence;
- ambiguous Wikidata identities failing closed;
- Rekognition scores below 95 being rejected;
- no-face responses being rejected;
- verified candidates ranking ahead of weaker matches;
- no Brave or AWS configuration producing conceptual fallback;
- article preview images never bypassing verification.

External APIs are represented by injected clients in unit tests. A separate
opt-in integration check may call Brave and Rekognition when credentials are
present.

## Success Criteria

- No candidate reaches Slack without official-domain provenance, two
  independent exact-name signals, and a passing face comparison.
- The known Mateus Fernandes/Bernardo Silva mismatch is prevented by an
  automated regression test.
- Missing or uncertain identity data produces conceptual artwork rather than a
  guessed person.
- Existing reference approval, image generation, and publishing tests continue
  to pass.
