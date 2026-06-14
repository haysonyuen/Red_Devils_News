import {
  CompareFacesCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import axios from "axios";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface FaceComparisonResult {
  sourceFaceDetected: boolean;
  targetFaceDetected: boolean;
  similarities: number[];
}

export interface FaceVerificationDecision {
  accepted: boolean;
  similarity: number | null;
  reason:
    | "MATCH"
    | "BELOW_THRESHOLD"
    | "SOURCE_FACE_MISSING"
    | "TARGET_FACE_MISSING"
    | "NO_MATCH"
    | "VERIFICATION_ERROR";
}

export interface FaceVerificationDependencies {
  downloadImage: (url: string) => Promise<Buffer>;
  compareFaces: (
    source: Buffer,
    target: Buffer,
    threshold: number
  ) => Promise<FaceComparisonResult>;
}

function thresholdValue(value?: number): number {
  const configured =
    value ??
    Number.parseFloat(
      process.env.REFERENCE_FACE_SIMILARITY_THRESHOLD ?? "95"
    );
  if (!Number.isFinite(configured)) return 95;
  return Math.min(99, Math.max(90, configured));
}

async function defaultDownloadImage(urlValue: string): Promise<Buffer> {
  const url = new URL(urlValue);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Reference image URL must use HTTP(S)");
  }
  const response = await axios.get<ArrayBuffer>(url.toString(), {
    responseType: "arraybuffer",
    timeout: 10_000,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
  });
  const bytes = Buffer.from(response.data);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Reference image size is invalid");
  }
  return bytes;
}

async function defaultCompareFaces(
  source: Buffer,
  target: Buffer,
  threshold: number
): Promise<FaceComparisonResult> {
  const client = new RekognitionClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
  const response = await client.send(
    new CompareFacesCommand({
      SourceImage: { Bytes: source },
      TargetImage: { Bytes: target },
      SimilarityThreshold: threshold,
      QualityFilter: "AUTO",
    })
  );
  const matches = response.FaceMatches ?? [];
  return {
    sourceFaceDetected: Boolean(response.SourceImageFace),
    targetFaceDetected:
      matches.some((match) => Boolean(match.Face)) ||
      (response.UnmatchedFaces?.length ?? 0) > 0,
    similarities: matches
      .map((match) => match.Similarity)
      .filter((similarity): similarity is number => similarity !== undefined),
  };
}

export async function verifyCandidateFace(
  input: {
    anchorUrl: string;
    candidateUrl: string;
    threshold?: number;
  },
  dependencies: Partial<FaceVerificationDependencies> = {}
): Promise<FaceVerificationDecision> {
  const downloadImage = dependencies.downloadImage ?? defaultDownloadImage;
  const compareFaces = dependencies.compareFaces ?? defaultCompareFaces;
  const threshold = thresholdValue(input.threshold);

  try {
    const [source, target] = await Promise.all([
      downloadImage(input.anchorUrl),
      downloadImage(input.candidateUrl),
    ]);
    const result = await compareFaces(source, target, threshold);
    if (!result.sourceFaceDetected) {
      return {
        accepted: false,
        similarity: null,
        reason: "SOURCE_FACE_MISSING",
      };
    }
    if (!result.targetFaceDetected) {
      return {
        accepted: false,
        similarity: null,
        reason: "TARGET_FACE_MISSING",
      };
    }
    const similarity =
      result.similarities.length > 0
        ? Math.max(...result.similarities)
        : null;
    if (similarity === null) {
      return { accepted: false, similarity: null, reason: "NO_MATCH" };
    }
    return {
      accepted: similarity >= threshold,
      similarity,
      reason: similarity >= threshold ? "MATCH" : "BELOW_THRESHOLD",
    };
  } catch {
    return {
      accepted: false,
      similarity: null,
      reason: "VERIFICATION_ERROR",
    };
  }
}
