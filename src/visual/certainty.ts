import { StoryStatus } from "../graph/contracts";

const STATUS_FORBIDDEN: Record<StoryStatus, string[]> = {
  CONFIRMED: [],
  ADVANCED: ["completed signing", "signed contract", "destination kit"],
  INTEREST: [
    "completed signing",
    "signed contract",
    "destination kit",
    "medical",
  ],
  SPECULATION: [
    "completed signing",
    "signed contract",
    "destination kit",
    "medical",
    "negotiation room",
  ],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsConcept(text: string, concept: string): boolean {
  const normalizedConcept = normalize(concept);
  if (!normalizedConcept) return false;

  for (const rawClause of text.split(/[.;,!?\n]+/)) {
    const clause = normalize(rawClause);
    const negated = new RegExp(
      `\\b(?:do not|dont|never|without|avoid|no)\\s+(?:(?:show|depict|include|use|wear)\\s+)?(?:(?:a|an|the)\\s*)?$`
    );
    let start = 0;
    while ((start = clause.indexOf(normalizedConcept, start)) !== -1) {
      const before = clause.slice(0, start).trim();
      if (!negated.test(before)) return true;
      start += normalizedConcept.length;
    }
  }

  return false;
}

export function assertVisualRequestAllowed(
  storyStatus: StoryStatus,
  text: string,
  explicitForbidden: string[] = []
): void {
  for (const implication of [
    ...explicitForbidden,
    ...STATUS_FORBIDDEN[storyStatus],
  ]) {
    if (containsConcept(text, implication)) {
      throw new Error(`Visual request contains forbidden implication: ${implication}`);
    }
  }
}
