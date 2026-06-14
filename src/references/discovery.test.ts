import { BraveImageResult } from "./brave";
import { discoverReferenceCandidates } from "./discovery";
import { PersonIdentity } from "./identity";

const identity: PersonIdentity = {
  entityId: "Q123",
  canonicalName: "Mateus Fernandes",
  aliases: ["Mateus Goncalo Espanha Fernandes"],
  description: "Portuguese association football player",
  portraitUrl: "https://commons.wikimedia.org/mateus.jpg",
  officialDomains: ["whufc.com"],
};

const bernardoResult: BraveImageResult = {
  imageUrl: "https://cdn.whufc.com/bernardo.jpg",
  sourcePageUrl: "https://www.whufc.com/news/bernardo",
  title: "Football transfer news",
};

const mateusResult: BraveImageResult = {
  imageUrl: "https://cdn.whufc.com/mateus.jpg",
  sourcePageUrl: "https://www.whufc.com/player/mateus-fernandes",
  title: "Mateus Fernandes",
};

const bernardoHtml = `
  <title>Football gossip: Silva, Rashford, Fernandes</title>
  <meta property="og:image" content="https://cdn.whufc.com/bernardo.jpg">
  <meta property="og:image:alt" content="Bernardo Silva gossip graphic">
`;

const mateusHtml = `
  <title>Mateus Fernandes | West Ham United</title>
  <meta property="og:image" content="https://cdn.whufc.com/mateus.jpg">
  <meta property="og:image:alt" content="Mateus Fernandes official portrait">
`;

async function run(): Promise<void> {
  let faceCalls = 0;
  const candidates = await discoverReferenceCandidates({
    requestId: "request-1",
    person: "Mateus Fernandes",
    selectedArticleUrls: [
      "https://www.bbc.com/sport/football/articles/gossip",
    ],
    resolveIdentity: async () => identity,
    searchImages: async () => [bernardoResult, mateusResult],
    fetchHtml: async (url) => {
      if (url.includes("bbc.com")) {
        throw new Error("Selected articles must not be fetched for references");
      }
      return url.includes("bernardo") ? bernardoHtml : mateusHtml;
    },
    verifyFace: async ({ candidateUrl }) => {
      faceCalls += 1;
      return candidateUrl.includes("mateus")
        ? { accepted: true, similarity: 98, reason: "MATCH" }
        : { accepted: false, similarity: 12, reason: "BELOW_THRESHOLD" };
    },
    now: new Date("2026-06-13T12:00:00.000Z"),
  });

  if (
    candidates.length !== 1 ||
    candidates[0].imageUrl !== mateusResult.imageUrl ||
    candidates[0].entityId !== "Q123" ||
    candidates[0].faceSimilarity !== 98 ||
    candidates[0].origin !== "BRAVE_OFFICIAL"
  ) {
    throw new Error("Only the verified Mateus Fernandes candidate should survive");
  }
  if (faceCalls !== 1) {
    throw new Error("Insufficient metadata must be rejected before Rekognition");
  }

  const unresolved = await discoverReferenceCandidates({
    requestId: "request-2",
    person: "Unknown Player",
    resolveIdentity: async () => null,
    searchImages: async () => {
      throw new Error("Brave must not run without a resolved identity");
    },
  });
  if (unresolved.length !== 0) {
    throw new Error("Unresolved identities must fail closed");
  }

  let boundedFaceCalls = 0;
  const rawResults = Array.from({ length: 5 }, (_value, index) => ({
    imageUrl: `https://cdn.whufc.com/mateus-${index}.jpg`,
    sourcePageUrl: `https://www.whufc.com/news/mateus-${index}`,
    title: "Mateus Fernandes",
  }));
  const bounded = await discoverReferenceCandidates({
    requestId: "request-3",
    person: "Mateus Fernandes",
    resolveIdentity: async () => identity,
    searchImages: async () => rawResults,
    fetchHtml: async (url) => `
      <title>Mateus Fernandes news</title>
      <meta property="og:image" content="${rawResults.find((item) => item.sourcePageUrl === url)?.imageUrl}">
      <meta property="og:image:alt" content="Mateus Fernandes portrait">
    `,
    verifyFace: async () => {
      boundedFaceCalls += 1;
      return { accepted: true, similarity: 96, reason: "MATCH" };
    },
  });
  if (boundedFaceCalls !== 3 || bounded.length !== 3) {
    throw new Error("At most three evidence-qualified candidates reach Rekognition");
  }

  const ranked = await discoverReferenceCandidates({
    requestId: "request-4",
    person: "Mateus Fernandes",
    resolveIdentity: async () => identity,
    searchImages: async () => [
      {
        imageUrl: "https://cdn.whufc.com/news.jpg",
        sourcePageUrl: "https://www.whufc.com/news/mateus",
        title: "Mateus Fernandes",
      },
      {
        imageUrl: "https://cdn.whufc.com/profile.jpg",
        sourcePageUrl: "https://www.whufc.com/player/mateus-fernandes",
        title: "Mateus Fernandes",
      },
    ],
    fetchHtml: async (url) => `
      <title>Mateus Fernandes</title>
      <meta property="og:image" content="${
        url.includes("/player/")
          ? "https://cdn.whufc.com/profile.jpg"
          : "https://cdn.whufc.com/news.jpg"
      }">
      <meta property="og:image:alt" content="Mateus Fernandes portrait">
    `,
    verifyFace: async ({ candidateUrl }) => ({
      accepted: true,
      similarity: candidateUrl.includes("news") ? 99 : 96,
      reason: "MATCH",
    }),
  });
  if (!ranked[0]?.sourcePageUrl.includes("/player/")) {
    throw new Error("Official player profiles should rank before news pages");
  }
}

run()
  .then(() => console.log("Verified reference discovery tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
