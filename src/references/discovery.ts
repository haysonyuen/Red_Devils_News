import { randomUUID } from "node:crypto";
import axios from "axios";
import { ReferenceCandidate } from "../graph/contracts";
import {
  BraveImageResult,
  searchOfficialPlayerImages,
} from "./brave";
import {
  extractCandidateEvidence,
  validateCandidateEvidence,
} from "./evidence";
import {
  FaceVerificationDecision,
  verifyCandidateFace,
} from "./faceVerification";
import {
  PersonIdentity,
  resolvePersonIdentity,
} from "./identity";

const FIXED_OFFICIAL_DOMAINS = [
  "manutd.com",
  "premierleague.com",
  "thefa.com",
  "uefa.com",
  "fifa.com",
];
const MAX_FACE_COMPARISONS = 3;
const MAX_CANDIDATES = 3;

export interface DiscoveryInput {
  requestId: string;
  person: string;
  selectedArticleUrls?: string[];
  resolveIdentity?: (person: string) => Promise<PersonIdentity | null>;
  searchImages?: (input: {
    canonicalName: string;
    officialDomains: string[];
  }) => Promise<BraveImageResult[]>;
  fetchHtml?: (url: string) => Promise<string>;
  verifyFace?: (input: {
    anchorUrl: string;
    candidateUrl: string;
  }) => Promise<FaceVerificationDecision>;
  now?: Date;
}

async function defaultFetchHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ManUtdPipelineBot/1.0; +https://github.com/haysonyuen/Red_Devils_News)",
    },
    timeout: 15_000,
    responseType: "text",
    maxContentLength: 5 * 1024 * 1024,
  });
  return response.data;
}

function isPlayerProfile(urlValue: string): boolean {
  try {
    const path = new URL(urlValue).pathname.toLocaleLowerCase();
    return /\/(player|players|squad|team)\//.test(path);
  } catch {
    return false;
  }
}

export async function discoverReferenceCandidates({
  requestId,
  person,
  resolveIdentity = (name) => resolvePersonIdentity(name),
  searchImages = (input) => searchOfficialPlayerImages(input),
  fetchHtml = defaultFetchHtml,
  verifyFace = (input) => verifyCandidateFace(input),
  now = new Date(),
}: DiscoveryInput): Promise<ReferenceCandidate[]> {
  try {
    const identity = await resolveIdentity(person);
    if (!identity) return [];

    const officialDomains = [
      ...identity.officialDomains,
      ...FIXED_OFFICIAL_DOMAINS,
    ].filter((domain, index, values) => values.indexOf(domain) === index);
    const results = await searchImages({
      canonicalName: identity.canonicalName,
      officialDomains,
    });
    const evidenceQualified: Array<{
      result: BraveImageResult;
      evidenceSignalCount: number;
    }> = [];

    for (const result of results) {
      if (evidenceQualified.length >= MAX_FACE_COMPARISONS) break;
      try {
        const evidence = extractCandidateEvidence(
          result.sourcePageUrl,
          await fetchHtml(result.sourcePageUrl),
          result.imageUrl
        )[0];
        if (!evidence) continue;
        const decision = validateCandidateEvidence(
          identity.canonicalName,
          evidence
        );
        if (!decision.accepted) continue;
        evidenceQualified.push({
          result,
          evidenceSignalCount: decision.independentSignalCount,
        });
      } catch {
        continue;
      }
    }

    const verified: Array<{
      result: BraveImageResult;
      evidenceSignalCount: number;
      faceSimilarity: number;
    }> = [];
    for (const candidate of evidenceQualified) {
      const decision = await verifyFace({
        anchorUrl: identity.portraitUrl,
        candidateUrl: candidate.result.imageUrl,
      });
      if (!decision.accepted || decision.similarity === null) continue;
      verified.push({
        ...candidate,
        faceSimilarity: decision.similarity,
      });
    }

    return verified
      .sort(
        (left, right) =>
          Number(isPlayerProfile(right.result.sourcePageUrl)) -
            Number(isPlayerProfile(left.result.sourcePageUrl)) ||
          right.faceSimilarity - left.faceSimilarity ||
          right.evidenceSignalCount - left.evidenceSignalCount ||
          left.result.sourcePageUrl.localeCompare(right.result.sourcePageUrl)
      )
      .slice(0, MAX_CANDIDATES)
      .map((candidate, index) => ({
        id: randomUUID(),
        requestId,
        person,
        imageUrl: candidate.result.imageUrl,
        sourcePageUrl: candidate.result.sourcePageUrl,
        origin: "BRAVE_OFFICIAL",
        entityId: identity.entityId,
        evidenceSignalCount: candidate.evidenceSignalCount,
        faceSimilarity: candidate.faceSimilarity,
        verificationAnchorUrl: identity.portraitUrl,
        rank: index + 1,
        status: "AVAILABLE",
        discoveredAt: now.toISOString(),
      }));
  } catch {
    return [];
  }
}
