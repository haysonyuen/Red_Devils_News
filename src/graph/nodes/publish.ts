import axios from "axios";
import { PipelineState } from "../state";

const META_API_BASE = "https://graph.facebook.com/v21.0";

// ── Meta Graph API — Instagram two-step publish ───────────────────────────────
//
// Step 1: Create media container
//   POST /{ig-user-id}/media
//   → returns creation_id
//
// Step 2: Publish container
//   POST /{ig-user-id}/media_publish
//   → returns media_id

async function createMediaContainer(
  igAccountId: string,
  token: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const response = await axios.post(
    `${META_API_BASE}/${igAccountId}/media`,
    null,
    {
      params: {
        image_url: imageUrl,
        caption,
        access_token: token,
      },
    }
  );

  const creationId: string = response.data?.id;
  if (!creationId) {
    throw new Error(`Meta API returned no creation_id. Response: ${JSON.stringify(response.data)}`);
  }

  return creationId;
}

async function publishMediaContainer(
  igAccountId: string,
  token: string,
  creationId: string
): Promise<string> {
  const response = await axios.post(
    `${META_API_BASE}/${igAccountId}/media_publish`,
    null,
    {
      params: {
        creation_id: creationId,
        access_token: token,
      },
    }
  );

  const mediaId: string = response.data?.id;
  if (!mediaId) {
    throw new Error(`Meta API returned no media_id. Response: ${JSON.stringify(response.data)}`);
  }

  return mediaId;
}

// ── Node ──────────────────────────────────────────────────────────────────────

export async function publishNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  // Guard: only publish if explicitly approved
  if (state.approvalStatus !== "APPROVED") {
    console.log(`[publish] approvalStatus=${state.approvalStatus} — skipping publish`);
    return { publishStatus: "UNPUBLISHED" };
  }

  const token = process.env.META_GRAPH_TOKEN;
  const igAccountId = process.env.META_IG_ACCOUNT_ID;

  if (!token || !igAccountId) {
    const msg = "META_GRAPH_TOKEN or META_IG_ACCOUNT_ID not set";
    console.error(`[publish] ✖ ${msg}`);
    return { publishStatus: "FAILED", errorLog: [`[publish] ${msg}`] };
  }

  if (!state.generatedImageUrl) {
    const msg = "No generatedImageUrl in state — cannot publish";
    console.error(`[publish] ✖ ${msg}`);
    return { publishStatus: "FAILED", errorLog: [`[publish] ${msg}`] };
  }

  if (!state.draftCaption) {
    const msg = "No draftCaption in state — cannot publish";
    console.error(`[publish] ✖ ${msg}`);
    return { publishStatus: "FAILED", errorLog: [`[publish] ${msg}`] };
  }

  console.log(`[publish] Creating Instagram media container…`);
  console.log(`[publish]   image: ${state.generatedImageUrl}`);
  console.log(`[publish]   caption: "${state.draftCaption.slice(0, 60)}…"`);

  try {
    // Step 1
    const creationId = await createMediaContainer(
      igAccountId,
      token,
      state.generatedImageUrl,
      state.draftCaption
    );
    console.log(`[publish] ✔ Container created  creation_id=${creationId}`);

    // Step 2
    const mediaId = await publishMediaContainer(igAccountId, token, creationId);
    console.log(`[publish] ✔ Published to Instagram  media_id=${mediaId}`);

    return { publishStatus: "SUCCESS" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[publish] ✖ Meta API error: ${msg}`);
    return {
      publishStatus: "FAILED",
      errorLog: [`[publish] Meta API error: ${msg}`],
    };
  }
}
