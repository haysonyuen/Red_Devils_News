export type StoryStatus =
  | "CONFIRMED"
  | "ADVANCED"
  | "INTEREST"
  | "SPECULATION";

export type ProducerDecision =
  | "ACCEPT"
  | "REJECT_AND_RESCOUT"
  | "REJECT_AND_END";

export type CompositionMode =
  | "PRIMARY_WITH_BACKGROUND"
  | "PRIMARY_WITH_SECONDARIES"
  | "CONCEPTUAL";

export type ReferenceRole = "PRIMARY" | "SECONDARY";

export type ReferenceStatus =
  | "AWAITING_UPLOAD"
  | "AWAITING_SOURCE"
  | "AWAITING_DECISION"
  | "APPROVED"
  | "REJECTED"
  | "OMITTED"
  | "TIMED_OUT";

export interface StorySelection {
  decision: "SELECT" | "NO_STORY";
  primaryStory: string | null;
  supportingSourceUrls: string[];
  mainCharacters: string[];
  storyStatus: StoryStatus | null;
  visualPotential: number;
  selectionReason: string;
  confidence: number;
}

export interface ProducerOutput {
  decision: ProducerDecision;
  decisionReason: string;
  angle: string | null;
  facts: Array<{ claim: string; sourceUrl: string }>;
  supporterOpinion: string | null;
  caption: string | null;
  headlineOptions: string[];
}

export interface ClaimCheck {
  claim: string;
  verdict: "SUPPORTED" | "UNSUPPORTED" | "OPINION";
  evidence: string;
  sourceUrl: string | null;
}

export interface FactCheckOutput {
  status: "PASS" | "REVISE" | "REJECT";
  storyStatus: StoryStatus;
  claimChecks: ClaimCheck[];
  visualImplicationsAllowed: string[];
  visualImplicationsForbidden: string[];
  issues: string[];
  revisionFeedback: string | null;
}

export interface VisualBrief {
  storyHook: string;
  emotionalGoal: string;
  primaryCharacter: string | null;
  secondaryCharacters: string[];
  compositionMode: CompositionMode;
  requiredSignals: string[];
  forbiddenImplications: string[];
  referenceRequirements: Array<{
    person: string;
    role: ReferenceRole;
    required: boolean;
  }>;
  searchInstructions: string[];
  generationPromptTemplate: string;
  conceptualFallbackPrompt: string;
  referenceWarning: string | null;
}

export interface ReferenceRequest {
  id: string;
  runId: string;
  threadTs: string;
  person: string;
  role: ReferenceRole;
  required: boolean;
  status: ReferenceStatus;
  attempt: number;
  slackFileId: string | null;
  privateDownloadUrl: string | null;
  sourcePageUrl: string | null;
  uploaderId: string | null;
  approverId: string | null;
  decisionAt: string | null;
  deadlineAt: string;
}

export interface ApprovedReference {
  requestId: string;
  person: string;
  role: ReferenceRole;
  privateAssetId: string;
  sourcePageUrl: string;
  sha256: string;
}

export interface GenerationRequest {
  compositionMode: CompositionMode;
  includedPeople: string[];
  omittedPeople: string[];
  approvedReferenceIds: string[];
  generationPrompt: string;
  candidateCount: 3;
  fallbackUsed: boolean;
}

export interface VisualScores {
  identityFidelity: Record<string, number>;
  storyAlignment: number;
  feedImpact: number;
  composition: number;
  captionComplement: number;
  factualIntegrity: number;
}

export interface CandidateEvaluation {
  candidateId: string;
  scores: VisualScores;
  hardFailures: string[];
  warnings: string[];
  rationale: string;
  recommended: boolean;
}

export interface GeneratedCandidate {
  id: string;
  publicUrl: string;
  providerRequestId: string;
  evaluation: CandidateEvaluation | null;
  qualified: boolean;
}
