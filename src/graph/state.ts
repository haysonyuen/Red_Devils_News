import { Annotation } from "@langchain/langgraph";
import {
  ApprovedReference,
  CandidateEvaluation,
  ClaimCheck,
  FactCheckOutput,
  GeneratedCandidate,
  GenerationRequest,
  ProducerOutput,
  ReferenceRequest,
  StorySelection,
  VisualBrief,
} from "./contracts";

export type { ClaimCheck } from "./contracts";

// ── Raw hit returned by the MCP search tool ──────────────────────────────────
export interface SearchResult {
  url: string;
  title: string;
  source: string; // e.g. "BBC Sport"
  publishedAt: string; // ISO timestamp
}

// ── Scraped article after allowlist validation ────────────────────────────────
export interface ArticleContent {
  url: string;
  title: string;
  source: string;
  bodyText: string; // full plain-text body from Cheerio
}

export interface EditorialBrief {
  narrative: string;
  facts: Array<{
    claim: string;
    sourceUrl: string;
  }>;
  context: string;
}

export interface ScoutBrief {
  selectedArticleUrls: string[];
  selectionReason: string;
  confidence: number;
}

// ── Core pipeline state ───────────────────────────────────────────────────────
export const PipelineStateAnnotation = Annotation.Root({
  runId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  triggerTime: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  rawSearchHits: Annotation<SearchResult[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  filteredArticles: Annotation<ArticleContent[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  storySelection: Annotation<StorySelection | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  producerDecision: Annotation<ProducerOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  producerRejectionCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  rejectedStoryUrls: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  factCheck: Annotation<FactCheckOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  visualBrief: Annotation<VisualBrief | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  referenceRequests: Annotation<ReferenceRequest[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  referenceApprovals: Annotation<ApprovedReference[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  generationRequest: Annotation<GenerationRequest | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  generatedCandidates: Annotation<GeneratedCandidate[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  selectedCandidate: Annotation<GeneratedCandidate | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  visualEvaluation: Annotation<CandidateEvaluation | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  visualRegenerationCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  scoutBrief: Annotation<ScoutBrief | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  editorialBrief: Annotation<EditorialBrief | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  draftCaption: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  imagePrompt: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  producerValidationIssues: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  factCheckStatus: Annotation<"PENDING" | "PASS" | "REVISE" | "REJECT">({
    reducer: (_, next) => next,
    default: () => "PENDING",
  }),
  factCheckIssues: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  factCheckClaims: Annotation<ClaimCheck[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  revisionFeedback: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  revisionCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  generatedImageUrl: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  approvalStatus: Annotation<"PENDING" | "APPROVED" | "REJECTED">({
    reducer: (_, next) => next,
    default: () => "PENDING",
  }),
  publishStatus: Annotation<"SUCCESS" | "FAILED" | "UNPUBLISHED">({
    reducer: (_, next) => next,
    default: () => "UNPUBLISHED",
  }),
  errorLog: Annotation<string[]>({
    reducer: (existing, next) => [...existing, ...next],
    default: () => [],
  }),
});

export type PipelineState = typeof PipelineStateAnnotation.State;
