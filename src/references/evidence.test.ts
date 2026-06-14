import {
  extractCandidateEvidence,
  validateCandidateEvidence,
} from "./evidence";

function requireSingleEvidence(html: string, preferredImageUrl?: string) {
  const evidence = extractCandidateEvidence(
    "https://www.whufc.com/news/mateus-fernandes",
    html,
    preferredImageUrl
  );
  if (evidence.length !== 1) {
    throw new Error(`Expected one image evidence record, got ${evidence.length}`);
  }
  return evidence[0];
}

function run(): void {
  const mismatch = requireSingleEvidence(
    `
      <title>Football gossip: Silva, Rashford, Fernandes</title>
      <meta property="og:image" content="https://ichef.bbci.co.uk/bernardo.png">
      <meta property="og:image:alt" content="Bernardo Silva gossip graphic">
    `,
    "https://ichef.bbci.co.uk/bernardo.png"
  );
  if (validateCandidateEvidence("Mateus Fernandes", mismatch).accepted) {
    throw new Error("Bernardo Silva image must not verify Mateus Fernandes");
  }

  const official = requireSingleEvidence(
    `
      <title>Mateus Fernandes | West Ham United</title>
      <meta property="og:image" content="/images/mateus.jpg">
      <meta property="og:image:alt" content="Mateus Fernandes official portrait">
    `,
    "https://www.whufc.com/images/mateus.jpg"
  );
  const officialDecision = validateCandidateEvidence(
    "Mateus Fernandes",
    official
  );
  if (
    !officialDecision.accepted ||
    officialDecision.independentSignalCount !== 2
  ) {
    throw new Error("Exact page title and image alt should verify the player");
  }

  const surnameOnly = requireSingleEvidence(
    `
      <title>Fernandes | Player profile</title>
      <meta property="og:image" content="/images/player.jpg">
      <meta property="og:image:alt" content="Fernandes training">
    `,
    "https://www.whufc.com/images/player.jpg"
  );
  if (validateCandidateEvidence("Mateus Fernandes", surnameOnly).accepted) {
    throw new Error("Surname-only labels must not verify a player");
  }

  const duplicateKinds = requireSingleEvidence(
    `
      <title>Mateus Fernandes | West Ham United</title>
      <meta property="og:title" content="Mateus Fernandes | West Ham United">
      <meta name="twitter:title" content="Mateus Fernandes | West Ham United">
      <meta property="og:image" content="/images/unlabelled.jpg">
    `,
    "https://www.whufc.com/images/unlabelled.jpg"
  );
  const duplicateDecision = validateCandidateEvidence(
    "Mateus Fernandes",
    duplicateKinds
  );
  if (
    duplicateDecision.accepted ||
    duplicateDecision.independentSignalCount !== 1
  ) {
    throw new Error("Duplicate title fields must count as one evidence kind");
  }

  const jsonLd = requireSingleEvidence(
    `
      <script type="application/ld+json">
        {
          "@type": "Person",
          "name": "Mateus Fernandes",
          "image": {
            "url": "https://www.whufc.com/images/json-mateus.jpg",
            "caption": "Mateus Fernandes first-team portrait"
          }
        }
      </script>
    `,
    "https://www.whufc.com/images/json-mateus.jpg"
  );
  const jsonDecision = validateCandidateEvidence("Mateus Fernandes", jsonLd);
  if (
    !jsonDecision.accepted ||
    jsonDecision.independentSignalCount !== 2
  ) {
    throw new Error("JSON-LD person name and caption should verify the player");
  }

  const figure = requireSingleEvidence(
    `
      <title>Mateus Fernandes profile</title>
      <figure>
        <img src="/images/figure.jpg" alt="Mateus Fernandes in training">
        <figcaption>Mateus Fernandes with the first team</figcaption>
      </figure>
    `,
    "https://www.whufc.com/images/figure.jpg"
  );
  if (!validateCandidateEvidence("Mateus Fernandes", figure).accepted) {
    throw new Error("Matching image alt and figure caption should pass");
  }

  const generic = requireSingleEvidence(
    `
      <title>First-team news</title>
      <meta property="og:image" content="/images/team.jpg">
    `,
    "https://www.whufc.com/images/team.jpg"
  );
  if (validateCandidateEvidence("Mateus Fernandes", generic).accepted) {
    throw new Error("Generic unlabelled images must fail closed");
  }
}

try {
  run();
  console.log("Reference evidence tests passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
