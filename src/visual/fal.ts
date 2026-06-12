import { fal } from "@fal-ai/client";
import { GenerationRequest } from "../graph/contracts";

interface FalResult {
  requestId?: string;
  data?: { images?: Array<{ url?: string }> };
}

export interface FalClient {
  subscribe(
    endpoint: string,
    options: { input: Record<string, unknown>; logs?: boolean }
  ): Promise<FalResult>;
}

export interface FalCandidate {
  providerRequestId: string;
  temporaryUrl: string;
  seed: number;
}

const defaultFalClient: FalClient = {
  subscribe: (endpoint, options) =>
    fal.subscribe(endpoint as never, options as never) as Promise<FalResult>,
};

function createUniqueSeeds(count: number): number[] {
  const seeds = new Set<number>();
  while (seeds.size < count) {
    seeds.add(Math.floor(Math.random() * 2_147_483_647));
  }
  return [...seeds];
}

export async function generateFalCandidates(
  request: GenerationRequest,
  signedReferenceUrls: string[],
  client: FalClient = defaultFalClient,
  seeds = createUniqueSeeds(request.candidateCount)
): Promise<FalCandidate[]> {
  if (seeds.length !== request.candidateCount) {
    throw new Error("FAL candidate seeds must match candidateCount");
  }
  if (new Set(seeds).size !== seeds.length) {
    throw new Error("FAL candidate seeds must be unique");
  }
  if (!process.env.FAL_KEY && client === defaultFalClient) {
    throw new Error("FAL_KEY is not set");
  }
  if (client === defaultFalClient) {
    fal.config({ credentials: process.env.FAL_KEY as string });
  }

  const referenced = signedReferenceUrls.length > 0;
  const endpoint = referenced
    ? process.env.FAL_REFERENCE_MODEL ?? "fal-ai/flux-2-pro/edit"
    : process.env.FAL_CONCEPT_MODEL ?? "fal-ai/flux-2-pro";

  const settled = await Promise.allSettled(
    seeds.map(async (seed) => {
      const input: Record<string, unknown> = {
        prompt: request.generationPrompt,
        image_size: "portrait_4_3",
        output_format: "jpeg",
        safety_tolerance: "2",
        seed,
      };
      if (referenced) {
        input.image_urls = signedReferenceUrls.slice(0, 4);
      }
      const result = await client.subscribe(endpoint, { input, logs: false });
      const temporaryUrl = result.data?.images?.[0]?.url;
      if (!temporaryUrl) throw new Error("FAL returned no image URL");
      return {
        providerRequestId: result.requestId ?? `${endpoint}:${seed}`,
        temporaryUrl,
        seed,
      };
    })
  );

  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (candidates.length === 0) {
    const messages = settled
      .filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      )
      .map((result) =>
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      );
    throw new Error(`All FAL candidate requests failed: ${messages.join("; ")}`);
  }
  return candidates;
}
