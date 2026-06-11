const FORBIDDEN_PHRASES = [
  "breaking",
  "stay tuned",
  "massive news",
  "what do you think?",
];

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function containsCopiedPhrase(
  caption: string,
  sourceTexts: string[],
  phraseLength = 12
): boolean {
  const captionWords = normalizeWords(caption);
  if (captionWords.length < phraseLength) return false;

  const sourceCorpus = ` ${sourceTexts
    .flatMap(normalizeWords)
    .join(" ")} `;

  for (let i = 0; i <= captionWords.length - phraseLength; i++) {
    const phrase = ` ${captionWords.slice(i, i + phraseLength).join(" ")} `;
    if (sourceCorpus.includes(phrase)) return true;
  }

  return false;
}

export function validateCaption(
  caption: string,
  sourceTexts: string[]
): string[] {
  const issues: string[] = [];
  const hashtagCount = caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;

  if (caption.length < 220 || caption.length > 420) {
    issues.push("Caption must be between 220 and 420 characters.");
  }
  if (!/\b(we|us|our)\b/i.test(caption)) {
    issues.push("Caption must use a natural first-person supporter voice.");
  }
  if (hashtagCount < 3 || hashtagCount > 5) {
    issues.push("Caption must contain three to five hashtags.");
  }
  if (!caption.includes("?")) {
    issues.push("Caption must end with a specific football discussion question.");
  }
  if (caption.split(/\n\s*\n/).length > 2) {
    issues.push("Caption must use no more than two short body paragraphs.");
  }

  const lowerCaption = caption.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lowerCaption.includes(phrase)) {
      issues.push(`Caption contains forbidden phrase: "${phrase}".`);
    }
  }

  if (containsCopiedPhrase(caption, sourceTexts)) {
    issues.push("Caption appears to copy a long phrase from source material.");
  }

  return issues;
}
