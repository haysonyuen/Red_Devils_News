import {
  CandidateEvaluation,
  GeneratedCandidate,
  VisualScores,
} from "../graph/contracts";

const EVALUATION_KEYS = [
  "candidateId",
  "scores",
  "hardFailures",
  "warnings",
  "rationale",
  "recommended",
] as const;
const SCORE_KEYS = [
  "identityFidelity",
  "storyAlignment",
  "feedImpact",
  "composition",
  "captionComplement",
  "factualIntegrity",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function score(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error("Visual evaluation score must be between 0 and 100");
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`Visual evaluation has invalid ${field}`);
  }
  return value;
}

export function parseCandidateEvaluation(value: unknown): CandidateEvaluation {
  if (!isRecord(value) || !exactKeys(value, EVALUATION_KEYS)) {
    throw new Error("Visual evaluation must contain exactly the required keys");
  }
  if (
    typeof value.candidateId !== "string" ||
    !value.candidateId.trim() ||
    !isRecord(value.scores) ||
    !exactKeys(value.scores, SCORE_KEYS) ||
    typeof value.rationale !== "string" ||
    !value.rationale.trim() ||
    typeof value.recommended !== "boolean"
  ) {
    throw new Error("Visual evaluation is invalid");
  }
  if (!isRecord(value.scores.identityFidelity)) {
    throw new Error("Identity fidelity must contain per-person scores");
  }
  const identityFidelity = Object.fromEntries(
    Object.entries(value.scores.identityFidelity).map(([person, value]) => [
      person,
      score(value),
    ])
  );
  const scores: VisualScores = {
    identityFidelity,
    storyAlignment: score(value.scores.storyAlignment),
    feedImpact: score(value.scores.feedImpact),
    composition: score(value.scores.composition),
    captionComplement: score(value.scores.captionComplement),
    factualIntegrity: score(value.scores.factualIntegrity),
  };
  return {
    candidateId: value.candidateId,
    scores,
    hardFailures: stringArray(value.hardFailures, "hardFailures"),
    warnings: stringArray(value.warnings, "warnings"),
    rationale: value.rationale,
    recommended: value.recommended,
  };
}

export function qualifiesCandidate(evaluation: CandidateEvaluation): boolean {
  const identityScores = Object.values(evaluation.scores.identityFidelity);
  return (
    evaluation.hardFailures.length === 0 &&
    identityScores.every((value) => value >= 90) &&
    evaluation.scores.storyAlignment >= 85 &&
    evaluation.scores.feedImpact >= 85 &&
    evaluation.scores.composition >= 80 &&
    evaluation.scores.captionComplement >= 80 &&
    evaluation.scores.factualIntegrity >= 80
  );
}

function averageScore(evaluation: CandidateEvaluation): number {
  const identities = Object.values(evaluation.scores.identityFidelity);
  const values = [
    ...(identities.length > 0 ? identities : [100]),
    evaluation.scores.storyAlignment,
    evaluation.scores.feedImpact,
    evaluation.scores.composition,
    evaluation.scores.captionComplement,
    evaluation.scores.factualIntegrity,
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function rankCandidates(
  candidates: GeneratedCandidate[]
): GeneratedCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
    if (!left.evaluation || !right.evaluation) return 0;
    return averageScore(right.evaluation) - averageScore(left.evaluation);
  });
}
