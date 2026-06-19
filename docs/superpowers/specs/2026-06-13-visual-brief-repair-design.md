# Visual Brief Repair Design

## Goal

Prevent one malformed Visual Producer response from ending an otherwise valid
news run, while preserving deterministic fact, identity, branding, and
certainty safeguards.

## Flow

1. Build the fact-checked Visual Producer input.
2. Request the initial strict JSON visual brief.
3. Parse and validate it against all deterministic contracts.
4. If valid, continue normally.
5. If invalid, send the original input, original output, and validation issues
   to the Visual Producer for exactly one repair call.
6. Parse and validate the repaired output.
7. If repair is valid, continue normally.
8. If repair fails, return a deterministic conceptual brief with no people,
   references, branding, text, or story-status implications.

## Boundaries

- At most two LLM calls: one draft and one repair.
- Validation rules remain authoritative; repair cannot bypass them.
- The deterministic fallback copies the Fact Checker's forbidden implications
  exactly.
- The fallback contains no recognizable person and routes directly to
  conceptual image generation.
- Existing valid responses make only one LLM call.
- Repair failures are recorded for diagnostics but do not terminate the run.

## Validation

Validation reports all independently detectable issues in one list:

- forbidden implications changed;
- invented or duplicate cast members;
- cast/reference mismatches;
- forbidden certainty implications;
- embedded text or branding requests;
- recognizable people in conceptual fallback.

Schema and parsing failures may remain a single issue because no structured
brief exists to inspect further.

## Success Criteria

- A repairable invalid brief continues after one repair call.
- A second invalid response becomes a safe conceptual brief.
- A valid first response does not trigger repair.
- The pipeline no longer ends with a Visual Producer validation error for these
  recoverable output-shape or prompt-wording mistakes.
- Existing visual contract and full project tests remain green.
