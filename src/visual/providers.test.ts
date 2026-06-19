import {
  GenerationRequest,
  ReferenceCandidate,
  ReferenceRequest,
} from "../graph/contracts";
import { CloudinaryAssetService } from "./cloudinary";
import { generateFalCandidates } from "./fal";

async function run(): Promise<void> {
  const downloads: Array<Record<string, unknown>> = [];
  const uploads: Array<{
    buffer: Buffer;
    options: Record<string, unknown>;
  }> = [];
  const assetService = new CloudinaryAssetService({
    download: async (url, options) => {
      downloads.push({ url, options });
      return Buffer.from("reference-image");
    },
    upload: async (buffer, options) => {
      uploads.push({ buffer, options });
      return {
        publicId: String(options.public_id),
        secureUrl: `https://cloudinary.example/${String(options.public_id)}.jpg`,
      };
    },
    signedUrl: (publicId) =>
      `https://cloudinary.example/authenticated/${publicId}.jpg?signature=test`,
  });

  const request: ReferenceRequest = {
    id: "reference-1",
    runId: "run-1",
    threadTs: "thread-1",
    person: "Player One",
    role: "PRIMARY",
    required: true,
    status: "APPROVED",
    attempt: 1,
    activeCandidateId: "reference-candidate-1",
    approverId: "approver-1",
    decisionAt: "2026-06-12T12:00:00.000Z",
    deadlineAt: "2026-06-12T12:30:00.000Z",
  };
  const referenceCandidate: ReferenceCandidate = {
    id: "reference-candidate-1",
    requestId: request.id,
    person: request.person,
    imageUrl: "https://ichef.bbci.co.uk/images/player.jpg",
    sourcePageUrl:
      "https://www.bbc.com/sport/football/articles/example",
    origin: "BRAVE_OFFICIAL",
    entityId: "Q123",
    evidenceSignalCount: 2,
    faceSimilarity: 98,
    verificationAnchorUrl: "https://commons.wikimedia.org/rashford.jpg",
    rank: 1,
    status: "APPROVED",
    discoveredAt: "2026-06-13T12:00:00.000Z",
  };
  const privateAsset = await assetService.bufferDiscoveredReference(
    request,
    referenceCandidate
  );
  const downloadOptions = downloads[0].options as {
    headers?: Record<string, string>;
  };
  if (downloadOptions.headers !== undefined) {
    throw new Error("Public reference downloads must not use Slack credentials");
  }
  if (
    uploads[0].options.type !== "authenticated" ||
    !String(uploads[0].options.public_id).includes(
      "man-utd-pipeline/references/run-1"
    ) ||
    !privateAsset.signedUrl.includes("authenticated") ||
    privateAsset.approvedReference.sourcePageUrl !==
      referenceCandidate.sourcePageUrl
  ) {
    throw new Error(
      "Discovered references must be private and preserve provenance"
    );
  }

  await assetService.bufferCandidate(
    Buffer.from("candidate-image"),
    "run-1",
    "candidate-1"
  );
  if (
    uploads[1].options.type === "authenticated" ||
    !String(uploads[1].options.public_id).includes(
      "man-utd-pipeline/candidates/run-1/candidate-1"
    )
  ) {
    throw new Error("Generated candidates must be stable public assets");
  }

  const calls: Array<{ endpoint: string; input: Record<string, unknown> }> = [];
  const falClient = {
    subscribe: async (
      endpoint: string,
      options: { input: Record<string, unknown> }
    ) => {
      calls.push({ endpoint, input: options.input });
      if (options.input.seed === 1002) {
        throw new Error("partial provider failure");
      }
      return {
        requestId: `request-${String(options.input.seed)}`,
        data: {
          images: [
            { url: `https://fal.example/${String(options.input.seed)}.jpg` },
          ],
        },
      };
    },
  };
  const generation: GenerationRequest = {
    compositionMode: "PRIMARY_WITH_BACKGROUND",
    includedPeople: ["Player One"],
    omittedPeople: [],
    approvedReferenceIds: ["reference-1"],
    generationPrompt: "Editorial portrait of Player One",
    candidateCount: 3,
    fallbackUsed: false,
  };
  const referenced = await generateFalCandidates(
    generation,
    [privateAsset.signedUrl],
    falClient,
    [1001, 1002, 1003]
  );
  if (
    calls.length !== 3 ||
    calls.some((call) => call.endpoint !== "fal-ai/flux-2-pro/edit") ||
    calls.some(
      (call) =>
        call.input.image_size !== "portrait_4_3" ||
        !Array.isArray(call.input.image_urls)
    ) ||
    new Set(calls.map((call) => call.input.seed)).size !== 3 ||
    referenced.length !== 2
  ) {
    throw new Error(
      "Referenced generation should make three independent edit requests and retain partial successes"
    );
  }

  calls.length = 0;
  await generateFalCandidates(
    { ...generation, compositionMode: "CONCEPTUAL", approvedReferenceIds: [], fallbackUsed: true },
    [],
    falClient,
    [2001, 2002, 2003]
  );
  if (
    calls.some((call) => call.endpoint !== "fal-ai/flux-2-pro") ||
    calls.some((call) => "image_urls" in call.input)
  ) {
    throw new Error("Conceptual generation must use the text-to-image endpoint");
  }
}

run()
  .then(() => console.log("Visual provider tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
