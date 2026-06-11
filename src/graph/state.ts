import { Annotation } from "@langchain/langgraph";

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

export interface ClaimCheck {
  claim: string;
  verdict: "SUPPORTED" | "UNSUPPORTED" | "OPINION";
  evidence: string;
  sourceUrl: string | null;
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
