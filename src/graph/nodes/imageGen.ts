import { randomUUID } from "node:crypto";
import { PipelineState } from "../state";
import { createGenerationRequest } from "./visualProducer";
import { CloudinaryAssetService } from "../../visual/cloudinary";
import { generateFalCandidates } from "../../visual/fal";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function imageGenNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  if (!state.visualBrief) {
    return {
      generatedCandidates: [],
      generatedImageUrl: null,
      errorLog: ["[imageGen] No visual brief was available"],
    };
  }

  try {
    const assets = new CloudinaryAssetService();
    const approvedRequests = state.referenceRequests.filter(
      (request) => request.status === "APPROVED"
    );
    const selectedRequests = [
      ...approvedRequests.filter((request) => request.role === "PRIMARY"),
      ...approvedRequests.filter((request) => request.role === "SECONDARY"),
    ].slice(0, 4);
    const privateAssets = [];
    for (const request of selectedRequests) {
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) throw new Error("SLACK_BOT_TOKEN is not set");
      privateAssets.push(await assets.bufferReference(request, slackToken));
    }

    const generationState: PipelineState = {
      ...state,
      referenceApprovals: privateAssets.map(
        (asset) => asset.approvedReference
      ),
    };
    const generationRequest = await createGenerationRequest(generationState);
    const temporaryCandidates = await generateFalCandidates(
      generationRequest,
      privateAssets.map((asset) => asset.signedUrl)
    );
    const generatedCandidates = [];
    for (const candidate of temporaryCandidates) {
      const id = randomUUID();
      const buffer = await assets.downloadPublicImage(candidate.temporaryUrl);
      const publicUrl = await assets.bufferCandidate(buffer, state.runId, id);
      generatedCandidates.push({
        id,
        publicUrl,
        providerRequestId: candidate.providerRequestId,
        evaluation: null,
        qualified: false,
      });
    }

    return {
      referenceApprovals: generationState.referenceApprovals,
      generationRequest,
      generatedCandidates,
      generatedImageUrl: generatedCandidates[0]?.publicUrl ?? null,
    };
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error(`[imageGen] Failed: ${message}`);
    return {
      generatedCandidates: [],
      generatedImageUrl: null,
      errorLog: [`[imageGen] Failed: ${message}`],
    };
  }
}
