import crypto from "node:crypto";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import {
  ApprovedReference,
  ReferenceCandidate,
  ReferenceRequest,
} from "../graph/contracts";

interface UploadResult {
  publicId: string;
  secureUrl: string;
}

interface CloudinaryAssetDependencies {
  download: (
    url: string,
    options: { headers?: Record<string, string> }
  ) => Promise<Buffer>;
  upload: (
    buffer: Buffer,
    options: Record<string, unknown>
  ) => Promise<UploadResult>;
  signedUrl: (publicId: string) => string;
}

export interface PrivateReferenceAsset {
  approvedReference: ApprovedReference;
  signedUrl: string;
}

function defaultDependencies(): CloudinaryAssetDependencies {
  return {
    download: async (url, options) => {
      const response = await axios.get(url, {
        headers: options.headers,
        responseType: "arraybuffer",
        timeout: 30_000,
      });
      return Buffer.from(response.data as ArrayBuffer);
    },
    upload: (buffer, options) =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          options,
          (error, result) => {
            if (error) {
              reject(new Error(`Cloudinary upload failed: ${error.message}`));
              return;
            }
            if (!result?.public_id || !result.secure_url) {
              reject(new Error("Cloudinary returned incomplete upload data"));
              return;
            }
            resolve({
              publicId: result.public_id,
              secureUrl: result.secure_url,
            });
          }
        );
        stream.end(buffer);
      }),
    signedUrl: (publicId) =>
      cloudinary.url(publicId, {
        type: "authenticated",
        sign_url: true,
        secure: true,
      }),
  };
}

export class CloudinaryAssetService {
  constructor(
    private readonly dependencies: CloudinaryAssetDependencies =
      defaultDependencies()
  ) {}

  async bufferDiscoveredReference(
    request: ReferenceRequest,
    candidate: ReferenceCandidate
  ): Promise<PrivateReferenceAsset> {
    if (
      request.status !== "APPROVED" ||
      candidate.status !== "APPROVED" ||
      request.activeCandidateId !== candidate.id ||
      candidate.requestId !== request.id
    ) {
      throw new Error("Only approved discovered references can be buffered");
    }
    const buffer = await this.dependencies.download(candidate.imageUrl, {});
    const publicId = `man-utd-pipeline/references/${request.runId}/${request.id}`;
    const uploaded = await this.dependencies.upload(buffer, {
      public_id: publicId,
      resource_type: "image",
      type: "authenticated",
      overwrite: true,
    });
    return {
      approvedReference: {
        requestId: request.id,
        person: request.person,
        role: request.role,
        privateAssetId: uploaded.publicId,
        sourcePageUrl: candidate.sourcePageUrl,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      },
      signedUrl: this.dependencies.signedUrl(uploaded.publicId),
    };
  }

  async downloadPublicImage(url: string): Promise<Buffer> {
    return this.dependencies.download(url, {});
  }

  signedReferenceUrl(privateAssetId: string): string {
    return this.dependencies.signedUrl(privateAssetId);
  }

  async bufferCandidate(
    buffer: Buffer,
    runId: string,
    candidateId: string
  ): Promise<string> {
    const uploaded = await this.dependencies.upload(buffer, {
      public_id: `man-utd-pipeline/candidates/${runId}/${candidateId}`,
      resource_type: "image",
      overwrite: true,
    });
    return uploaded.secureUrl;
  }
}
