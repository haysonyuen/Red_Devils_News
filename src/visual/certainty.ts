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
  const textTokens = normalize(text).split(" ").filter(Boolean);
  const conceptTokens = normalize(concept).split(" ").filter(Boolean);
  if (conceptTokens.length === 0) return false;

  for (let index = 0; index <= textTokens.length - conceptTokens.length; index++) {
    const matches = conceptTokens.every(
      (token, offset) => textTokens[index + offset] === token
    );
    if (!matches) continue;

    const prefix = textTokens.slice(Math.max(0, index - 4), index);
    if (
      prefix.includes("no") ||
      prefix.includes("not") ||
      prefix.includes("without") ||
      prefix.includes("avoid") ||
      prefix.includes("never")
    ) {
      continue;
    }
    return true;
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
