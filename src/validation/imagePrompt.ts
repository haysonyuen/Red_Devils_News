const FORBIDDEN_VISUAL_TERMS = [
  /\bportrait\b/i,
  /\bplayer\b/i,
  /\bfootballer\b/i,
  /\bforward\b/i,
  /\bstriker\b/i,
  /\bmidfielder\b/i,
  /\bgoalkeeper\b/i,
  /\bface\b/i,
  /\bperson\b/i,
  /\bman\b/i,
  /\bwoman\b/i,
  /\bsilhouette\b/i,
  /\bwearing\b/i,
  /\bjersey\b/i,
  /\bkit\b/i,
  /\bshirt number\b/i,
  /\bsponsor\b/i,
  /\bbadge\b/i,
  /\bcrest\b/i,
  /\bManchester United\b/i,
  /\bOld Trafford\b/i,
];

export function validateImagePrompt(prompt: string): string[] {
  const issues: string[] = [];

  if (prompt.length < 80 || prompt.length > 700) {
    issues.push("Image prompt must be between 80 and 700 characters.");
  }

  for (const pattern of FORBIDDEN_VISUAL_TERMS) {
    if (pattern.test(prompt)) {
      issues.push(
        `Image prompt contains forbidden visual term: "${pattern.source.replaceAll("\\b", "")}".`
      );
    }
  }

  return issues;
}

export function addImageSafetyConstraints(prompt: string): string {
  return [
    prompt.trim(),
    "Conceptual editorial still life, not documentary photography.",
    "No people, no faces, no bodies, no silhouettes, no player likenesses.",
    "No football kits, club badges, crests, sponsors, shirt numbers, text, logos, or watermarks.",
    "No identifiable real stadium architecture. Generic football environment only.",
  ].join(" ");
}
