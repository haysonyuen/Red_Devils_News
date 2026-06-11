import { fal } from "@fal-ai/client";
import { v2 as cloudinary } from "cloudinary";
import axios from "axios";
import { PipelineState } from "../state";
import { addImageSafetyConstraints } from "../../validation/imagePrompt";

// ── Cloudinary config ─────────────────────────────────────────────────────────
// The CLOUDINARY_URL env var is auto-parsed by the Cloudinary SDK
// Format: cloudinary://api_key:api_secret@cloud_name

// ── FAL.ai image generation ───────────────────────────────────────────────────

async function generateImage(prompt: string): Promise<string> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("FAL_KEY is not set");

  fal.config({ credentials: falKey });

  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt,
      image_size: "square_hd",
      num_images: 1,
      num_inference_steps: 4,
    },
    logs: false,
  });

  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error("FAL.ai returned no image URL");

  console.log(`[imageGen] ✔ FAL image generated: ${imageUrl.slice(0, 60)}…`);
  return imageUrl;
}

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail =
      typeof err.response?.data === "string"
        ? err.response.data
        : JSON.stringify(err.response?.data);
    return [
      err.message,
      err.response?.status ? `HTTP ${err.response.status}` : "",
      detail && detail !== "undefined" ? detail : "",
    ]
      .filter(Boolean)
      .join(" - ");
  }

  if (err instanceof Error) {
    const apiError = err as Error & {
      status?: number;
      body?: unknown;
    };
    const details = [
      apiError.status ? `HTTP ${apiError.status}` : "",
      apiError.body ? JSON.stringify(apiError.body) : "",
    ].filter(Boolean);
    if (details.length > 0) {
      return `${err.message} - ${details.join(" - ")}`;
    }

    const cause =
      typeof err.cause === "object" && err.cause !== null
        ? JSON.stringify(err.cause)
        : "";
    return cause ? `${err.message} - ${cause}` : err.message;
  }

  return String(err);
}

// ── Download + upload to Cloudinary for a stable public URL ──────────────────

async function bufferToCloudinary(tempUrl: string, runId: string): Promise<string> {
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  if (!cloudinaryUrl) throw new Error("CLOUDINARY_URL is not set");

  // Download image as a buffer
  const response = await axios.get(tempUrl, {
    responseType: "arraybuffer",
    timeout: 30_000,
  });
  const buffer = Buffer.from(response.data as ArrayBuffer);

  // Upload to Cloudinary
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: `man-utd-pipeline/${runId}`,
        folder: "man-utd-pipeline",
        resource_type: "image",
        overwrite: true,
      },
      (error, uploadResult) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        if (!uploadResult?.secure_url) return reject(new Error("Cloudinary returned no URL"));
        console.log(`[imageGen] ✔ Buffered to Cloudinary: ${uploadResult.secure_url}`);
        resolve(uploadResult.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}

// ── Node ──────────────────────────────────────────────────────────────────────

export async function imageGenNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  if (!state.imagePrompt) {
    console.warn("[imageGen] No imagePrompt in state — skipping image generation");
    return {};
  }

  console.log(`[imageGen] Generating image for prompt: "${state.imagePrompt.slice(0, 80)}…"`);

  const errorLog: string[] = [];

  try {
    const tempUrl = await generateImage(
      addImageSafetyConstraints(state.imagePrompt)
    );
    const generatedImageUrl = await bufferToCloudinary(tempUrl, state.runId);

    return { generatedImageUrl, errorLog };
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    errorLog.push(`[imageGen] Failed: ${msg}`);
    console.error(`[imageGen] ✖ ${msg}`);
    return { generatedImageUrl: null, errorLog };
  }
}
