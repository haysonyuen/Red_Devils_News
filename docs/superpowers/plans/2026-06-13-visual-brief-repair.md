# Visual Brief Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Visual Producer validation recover through one repair call and a deterministic conceptual fallback instead of terminating the pipeline.

**Architecture:** Extract visual-brief validation into a reusable issue collector, then orchestrate draft, repair, and fallback inside `createVisualBrief`. Inject the JSON caller for deterministic tests while production continues using `callLlmJson`.

**Tech Stack:** TypeScript, existing OpenAI-compatible JSON client, LangGraph state, shell-based test runner.

---

### Task 1: Add Repair and Fallback Contract Tests

**Files:**
- Modify: `src/graph/visual-contracts.test.ts`
- Modify: `src/graph/nodes/visualProducer.ts`

- [ ] Add an injectable `createVisualBrief(state, { callJson })` contract test where the first response requests embedded branding and the second response is valid.
- [ ] Verify the focused test fails because `createVisualBrief` does not accept dependencies or repair.
- [ ] Add a test where both responses are invalid and assert the result is a person-free `CONCEPTUAL` brief with exact forbidden implications.
- [ ] Add a test where the first response is valid and assert only one JSON call occurs.

Run: `npm run build && node dist/graph/visual-contracts.test.js`

Expected before implementation: compile or assertion failure on missing repair behavior.

### Task 2: Implement Bounded Repair Orchestration

**Files:**
- Modify: `src/graph/nodes/visualProducer.ts`
- Modify: `prompts/visual-producer.v1.md`

- [ ] Add a reusable validation function that returns all independently detectable issue messages.
- [ ] Keep `validateVisualBriefAgainstInput` as the throwing compatibility wrapper.
- [ ] Add one repair call containing the original input, original response, and validation issues.
- [ ] Validate the repair with the same parser and issue collector.
- [ ] Return a deterministic safe conceptual brief when repair parsing or validation fails.
- [ ] Add the `VISUAL_BRIEF_REPAIR` phase instructions to the Visual Producer prompt.

Run: `npm run build && node dist/graph/visual-contracts.test.js`

Expected: `Visual contract tests passed`.

### Task 3: Verify and Commit

**Files:**
- Modify: `src/visual/certainty.ts`
- Modify: `src/graph/visual-contracts.test.ts`
- Modify: `src/graph/nodes/visualProducer.ts`
- Modify: `prompts/visual-producer.v1.md`
- Add: `docs/superpowers/specs/2026-06-13-visual-brief-repair-design.md`
- Add: `docs/superpowers/plans/2026-06-13-visual-brief-repair.md`

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run dev:now` and verify the current story reaches reference discovery or conceptual image generation without a Visual Producer validation error.
- [ ] Commit with `fix: repair invalid visual briefs`.
