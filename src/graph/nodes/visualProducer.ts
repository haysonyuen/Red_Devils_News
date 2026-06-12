import {
  GenerationRequest,
  CandidateEvaluation,
  CompositionMode,
  ReferenceRole,
  VisualBrief,
} from "../contracts";
import { PipelineState } from "../state";
import { callLlmJson, callLlmVisionJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";
import { assertVisualRequestAllowed } from "../../visual/certainty";
import {
  parseCandidateEvaluation,
  qualifiesCandidate,
  rankCandidates,
} from "../../visual/evaluation";
import { CloudinaryAssetService } from "../../visual/cloudinary";

const VISUAL_BRIEF_KEYS = [
  "storyHook",
  "emotionalGoal",
  "primaryCharacter",
  "secondaryCharacters",
  "compositionMode",
  "requiredSignals",
  "forbiddenImplications",
  "referenceRequirements",
  "searchInstructions",
  "generationPromptTemplate",
  "conceptualFallbackPrompt",
  "referenceWarning",
] as const;
const REFERENCE_REQUIREMENT_KEYS = [
  "person",
  "role",
  "required",
] as const;
const COMPOSITION_MODES: CompositionMode[] = [
  "PRIMARY_WITH_BACKGROUND",
  "PRIMARY_WITH_SECONDARIES",
  "CONCEPTUAL",
];
const REFERENCE_ROLES: ReferenceRole[] = ["PRIMARY", "SECONDARY"];
const GENERATION_REQUEST_KEYS = [
  "compositionMode",
  "includedPeople",
  "omittedPeople",
  "approvedReferenceIds",
  "generationPrompt",
  "candidateCount",
  "fallbackUsed",
] as const;

const VISUAL_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...VISUAL_BRIEF_KEYS],
  properties: {
    storyHook: { type: "string", minLength: 1 },
    emotionalGoal: { type: "string", minLength: 1 },
    primaryCharacter: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    secondaryCharacters: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    compositionMode: {
      type: "string",
      enum: [...COMPOSITION_MODES],
    },
    requiredSignals: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    forbiddenImplications: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    referenceRequirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...REFERENCE_REQUIREMENT_KEYS],
        properties: {
          person: { type: "string", minLength: 1 },
          role: { type: "string", enum: [...REFERENCE_ROLES] },
          required: { type: "boolean" },
        },
      },
    },
    searchInstructions: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    generationPromptTemplate: { type: "string", minLength: 1 },
    conceptualFallbackPrompt: { type: "string", minLength: 1 },
    referenceWarning: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
  },
};

const GENERATION_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...GENERATION_REQUEST_KEYS],
  properties: {
    compositionMode: { type: "string", enum: [...COMPOSITION_MODES] },
    includedPeople: { type: "array", items: { type: "string", minLength: 1 } },
    omittedPeople: { type: "array", items: { type: "string", minLength: 1 } },
    approvedReferenceIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    generationPrompt: { type: "string", minLength: 1 },
    candidateCount: { type: "number", const: 3 },
    fallbackUsed: { type: "boolean" },
  },
};

const CANDIDATE_EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidateId",
    "scores",
    "hardFailures",
    "warnings",
    "rationale",
    "recommended",
  ],
  properties: {
    candidateId: { type: "string" },
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "identityFidelity",
        "storyAlignment",
        "feedImpact",
        "composition",
        "captionComplement",
        "factualIntegrity",
      ],
      properties: {
        identityFidelity: {
          type: "object",
          additionalProperties: { type: "number", minimum: 0, maximum: 100 },
        },
        storyAlignment: { type: "number", minimum: 0, maximum: 100 },
        feedImpact: { type: "number", minimum: 0, maximum: 100 },
        composition: { type: "number", minimum: 0, maximum: 100 },
        captionComplement: { type: "number", minimum: 0, maximum: 100 },
        factualIntegrity: { type: "number", minimum: 0, maximum: 100 },
      },
    },
    hardFailures: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
    recommended: { type: "boolean" },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isNonEmptyString)
  ) {
    throw new Error(`Visual brief has an invalid ${field}`);
  }
  return value;
}

function normalizedPerson(person: string): string {
  return person.trim().toLocaleLowerCase();
}

function hasDuplicatePeople(people: string[]): boolean {
  const normalized = people.map(normalizedPerson);
  return new Set(normalized).size !== normalized.length;
}

function containsUrlLikeString(value: string): boolean {
  return /(?:https?:\/\/|www\.|data:|blob:|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/i.test(
    value
  );
}

export function parseVisualBrief(value: unknown): VisualBrief {
  if (!isRecord(value) || !hasExactKeys(value, VISUAL_BRIEF_KEYS)) {
    throw new Error("Visual brief must contain exactly the required keys");
  }
  if (
    !isNonEmptyString(value.storyHook) ||
    !isNonEmptyString(value.emotionalGoal) ||
    !(
      value.primaryCharacter === null ||
      isNonEmptyString(value.primaryCharacter)
    ) ||
    !Array.isArray(value.secondaryCharacters) ||
    !value.secondaryCharacters.every(isNonEmptyString) ||
    !COMPOSITION_MODES.includes(value.compositionMode as CompositionMode) ||
    !isNonEmptyString(value.generationPromptTemplate) ||
    !isNonEmptyString(value.conceptualFallbackPrompt) ||
    !(
      value.referenceWarning === null ||
      isNonEmptyString(value.referenceWarning)
    )
  ) {
    throw new Error("Visual brief is invalid");
  }

  const referenceRequirements = Array.isArray(value.referenceRequirements)
    ? value.referenceRequirements.map((requirement) => {
        if (
          !isRecord(requirement) ||
          !hasExactKeys(requirement, REFERENCE_REQUIREMENT_KEYS) ||
          !isNonEmptyString(requirement.person) ||
          !REFERENCE_ROLES.includes(requirement.role as ReferenceRole) ||
          requirement.required !== true
        ) {
          throw new Error("Visual brief contains an invalid reference requirement");
        }
        return {
          person: requirement.person,
          role: requirement.role as ReferenceRole,
          required: true,
        };
      })
    : null;
  if (!referenceRequirements) {
    throw new Error("Visual brief has invalid reference requirements");
  }

  const brief: VisualBrief = {
    storyHook: value.storyHook,
    emotionalGoal: value.emotionalGoal,
    primaryCharacter: value.primaryCharacter,
    secondaryCharacters: value.secondaryCharacters,
    compositionMode: value.compositionMode as CompositionMode,
    requiredSignals: parseStringArray(value.requiredSignals, "requiredSignals"),
    forbiddenImplications: parseStringArray(
      value.forbiddenImplications,
      "forbiddenImplications"
    ),
    referenceRequirements,
    searchInstructions: parseStringArray(
      value.searchInstructions,
      "searchInstructions"
    ),
    generationPromptTemplate: value.generationPromptTemplate,
    conceptualFallbackPrompt: value.conceptualFallbackPrompt,
    referenceWarning: value.referenceWarning,
  };

  if (containsUrlLikeString(brief.generationPromptTemplate)) {
    throw new Error("Visual brief generationPromptTemplate cannot contain URLs");
  }

  const cast = brief.primaryCharacter
    ? [brief.primaryCharacter, ...brief.secondaryCharacters]
    : [...brief.secondaryCharacters];
  if (
    hasDuplicatePeople(cast) ||
    hasDuplicatePeople(brief.referenceRequirements.map(({ person }) => person))
  ) {
    throw new Error("Visual brief cannot contain duplicate people");
  }
  if (cast.length > 3 && brief.referenceWarning === null) {
    throw new Error("Visual brief requires a reference warning for a large cast");
  }

  if (brief.compositionMode === "CONCEPTUAL") {
    if (
      brief.primaryCharacter !== null ||
      brief.secondaryCharacters.length !== 0 ||
      brief.referenceRequirements.length !== 0
    ) {
      throw new Error("Conceptual visual briefs cannot require people");
    }
    return brief;
  }

  if (!brief.primaryCharacter) {
    throw new Error("People-based visual briefs require a primary character");
  }
  if (
    brief.compositionMode === "PRIMARY_WITH_BACKGROUND" &&
    brief.secondaryCharacters.length !== 0
  ) {
    throw new Error("Background composition cannot include secondary characters");
  }
  if (
    brief.compositionMode === "PRIMARY_WITH_SECONDARIES" &&
    brief.secondaryCharacters.length === 0
  ) {
    throw new Error("Secondary composition requires a secondary character");
  }
  if (brief.referenceRequirements.length !== cast.length) {
    throw new Error("Visual brief references must exactly match the cast");
  }

  for (const person of cast) {
    const requirement = brief.referenceRequirements.find(
      (candidate) => normalizedPerson(candidate.person) === normalizedPerson(person)
    );
    const expectedRole: ReferenceRole =
      normalizedPerson(person) === normalizedPerson(brief.primaryCharacter)
        ? "PRIMARY"
        : "SECONDARY";
    if (!requirement || requirement.role !== expectedRole) {
      throw new Error("Visual brief reference role does not match the cast");
    }
  }

  return brief;
}

export function parseGenerationRequest(value: unknown): GenerationRequest {
  if (!isRecord(value) || !hasExactKeys(value, GENERATION_REQUEST_KEYS)) {
    throw new Error("Generation request must contain exactly the required keys");
  }
  if (
    !COMPOSITION_MODES.includes(value.compositionMode as CompositionMode) ||
    !isNonEmptyString(value.generationPrompt) ||
    value.candidateCount !== 3 ||
    typeof value.fallbackUsed !== "boolean"
  ) {
    throw new Error("Generation request is invalid");
  }
  const includedPeople = parseStringArrayAllowEmpty(
    value.includedPeople,
    "includedPeople"
  );
  const omittedPeople = parseStringArrayAllowEmpty(
    value.omittedPeople,
    "omittedPeople"
  );
  const approvedReferenceIds = parseStringArrayAllowEmpty(
    value.approvedReferenceIds,
    "approvedReferenceIds"
  );
  if (
    hasDuplicatePeople([...includedPeople, ...omittedPeople]) ||
    new Set(approvedReferenceIds).size !== approvedReferenceIds.length
  ) {
    throw new Error("Generation request contains duplicate people or references");
  }
  return {
    compositionMode: value.compositionMode as CompositionMode,
    includedPeople,
    omittedPeople,
    approvedReferenceIds,
    generationPrompt: value.generationPrompt,
    candidateCount: 3,
    fallbackUsed: value.fallbackUsed,
  };
}

function parseStringArrayAllowEmpty(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new Error(`Generation request has an invalid ${field}`);
  }
  return value;
}

export function prepareVisualBriefInput(state: PipelineState): {
  caption: string;
  story: {
    primaryStory: string;
    mainCharacters: string[];
    storyStatus: NonNullable<
      NonNullable<PipelineState["storySelection"]>["storyStatus"]
    >;
  };
  claims: NonNullable<PipelineState["factCheck"]>["claimChecks"];
  allowedImplications: string[];
  forbiddenImplications: string[];
} {
  if (
    state.factCheck?.status !== "PASS" ||
    state.producerDecision?.decision !== "ACCEPT" ||
    !state.draftCaption ||
    state.storySelection?.decision !== "SELECT" ||
    !state.storySelection.primaryStory ||
    !state.storySelection.storyStatus
  ) {
    throw new Error("Visual brief requires a fact-checked accepted story");
  }

  return {
    caption: state.draftCaption,
    story: {
      primaryStory: state.storySelection.primaryStory,
      mainCharacters: state.storySelection.mainCharacters,
      storyStatus: state.factCheck.storyStatus,
    },
    claims: state.factCheck.claimChecks,
    allowedImplications: state.factCheck.visualImplicationsAllowed,
    forbiddenImplications: state.factCheck.visualImplicationsForbidden,
  };
}

type VisualBriefInput = ReturnType<typeof prepareVisualBriefInput>;

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function requestsEmbeddedTextOrBranding(value: string): boolean {
  return /\b(?:add|include|show|display|render|with|featuring)\b[^.;,!?\n]*\b(?:text|logo|logos|crest|badge|watermark)\b/i.test(
    value
  );
}

export function validateVisualBriefAgainstInput(
  brief: VisualBrief,
  input: VisualBriefInput
): void {
  const suppliedCharacters = new Set(
    input.story.mainCharacters.map(normalizedText)
  );
  const cast = [
    ...(brief.primaryCharacter ? [brief.primaryCharacter] : []),
    ...brief.secondaryCharacters,
  ];

  for (const person of cast) {
    if (!suppliedCharacters.has(normalizedText(person))) {
      throw new Error(`Visual brief invented a cast member: ${person}`);
    }
  }

  for (const prompt of [
    brief.generationPromptTemplate,
    brief.conceptualFallbackPrompt,
  ]) {
    assertVisualRequestAllowed(
      input.story.storyStatus,
      prompt,
      input.forbiddenImplications
    );
    if (requestsEmbeddedTextOrBranding(prompt)) {
      throw new Error("Visual brief cannot request embedded text or branding");
    }
  }

  for (const person of input.story.mainCharacters) {
    if (
      normalizedText(brief.conceptualFallbackPrompt).includes(
        normalizedText(person)
      )
    ) {
      throw new Error(
        "Conceptual fallback cannot depict a recognizable supplied person"
      );
    }
  }
}

export async function createVisualBrief(
  state: PipelineState
): Promise<VisualBrief> {
  const input = prepareVisualBriefInput(state);
  const response = await callLlmJson(
    loadPrompt("visual-producer.v1.md"),
    JSON.stringify(input),
    {
      model: process.env.LLM_VISUAL_PRODUCER_MODEL,
      schemaName: "visual_brief",
      schema: VISUAL_BRIEF_SCHEMA,
    }
  );
  const brief = parseVisualBrief(response);

  if (
    JSON.stringify(brief.forbiddenImplications) !==
    JSON.stringify(input.forbiddenImplications)
  ) {
    throw new Error("Visual brief must copy forbidden implications exactly");
  }
  validateVisualBriefAgainstInput(brief, input);

  return brief;
}

export async function createGenerationRequest(
  state: PipelineState
): Promise<GenerationRequest> {
  if (!state.visualBrief || state.factCheck?.status !== "PASS") {
    throw new Error("Generation request requires a fact-checked visual brief");
  }

  const cast = [
    ...(state.visualBrief.primaryCharacter
      ? [state.visualBrief.primaryCharacter]
      : []),
    ...state.visualBrief.secondaryCharacters,
  ];
  const approvedPeople = state.referenceApprovals.map((reference) =>
    normalizedText(reference.person)
  );
  const includedPeople = cast.filter((person) =>
    approvedPeople.includes(normalizedText(person))
  );
  const omittedPeople = cast.filter(
    (person) => !approvedPeople.includes(normalizedText(person))
  );

  if (state.visualBrief.compositionMode === "CONCEPTUAL") {
    const generationPrompt =
      state.imagePrompt ?? state.visualBrief.conceptualFallbackPrompt;
    assertVisualRequestAllowed(
      state.factCheck.storyStatus,
      generationPrompt,
      state.factCheck.visualImplicationsForbidden
    );
    return {
      compositionMode: "CONCEPTUAL",
      includedPeople: [],
      omittedPeople,
      approvedReferenceIds: [],
      generationPrompt,
      candidateCount: 3,
      fallbackUsed: state.referenceRequests.length > 0,
    };
  }

  const response = await callLlmJson(
    loadPrompt("visual-producer.v1.md"),
    JSON.stringify({
      phase: "GENERATION_REQUEST",
      visualBrief: state.visualBrief,
      factCheck: state.factCheck,
      approvedReferences: state.referenceApprovals,
      includedPeople,
      omittedPeople,
    }),
    {
      model: process.env.LLM_VISUAL_PRODUCER_MODEL,
      schemaName: "generation_request",
      schema: GENERATION_REQUEST_SCHEMA,
    }
  );
  const request = parseGenerationRequest(response);
  const expectedReferenceIds = state.referenceApprovals.map(
    (reference) => reference.requestId
  );
  if (
    JSON.stringify(request.includedPeople) !== JSON.stringify(includedPeople) ||
    JSON.stringify(request.omittedPeople) !== JSON.stringify(omittedPeople) ||
    JSON.stringify(request.approvedReferenceIds) !==
      JSON.stringify(expectedReferenceIds)
  ) {
    throw new Error("Generation request changed the resolved cast or references");
  }
  assertVisualRequestAllowed(
    state.factCheck.storyStatus,
    request.generationPrompt,
    state.factCheck.visualImplicationsForbidden
  );
  if (requestsEmbeddedTextOrBranding(request.generationPrompt)) {
    throw new Error("Generation request cannot request embedded text or branding");
  }
  return request;
}

export async function evaluateCandidates(
  state: PipelineState
): Promise<CandidateEvaluation[]> {
  if (
    !state.visualBrief ||
    !state.generationRequest ||
    !state.factCheck ||
    state.generatedCandidates.length === 0
  ) {
    throw new Error("Candidate evaluation requires generated visual state");
  }
  const assets = new CloudinaryAssetService();
  const referenceUrls = state.referenceApprovals.map((reference) =>
    assets.signedReferenceUrl(reference.privateAssetId)
  );
  const evaluations: CandidateEvaluation[] = [];

  for (const candidate of state.generatedCandidates) {
    const response = await callLlmVisionJson(
      loadPrompt("visual-producer.v1.md"),
      JSON.stringify({
        phase: "CANDIDATE_EVALUATION",
        imageOrder:
          "The first image is the generated candidate. Remaining images are approved identity references in approvedReferences order.",
        candidateId: candidate.id,
        caption: state.draftCaption,
        visualBrief: state.visualBrief,
        generationRequest: state.generationRequest,
        factCheck: state.factCheck,
        identityThreshold: 90,
      }),
      [candidate.publicUrl, ...referenceUrls],
      {
        model: process.env.LLM_VISUAL_MODEL,
        schemaName: "candidate_evaluation",
        schema: CANDIDATE_EVALUATION_SCHEMA,
      }
    );
    const evaluation = parseCandidateEvaluation(response);
    if (evaluation.candidateId !== candidate.id) {
      throw new Error("Visual evaluation returned the wrong candidate ID");
    }
    const expectedPeople = state.generationRequest.includedPeople
      .map(normalizedText)
      .sort();
    const scoredPeople = Object.keys(evaluation.scores.identityFidelity)
      .map(normalizedText)
      .sort();
    if (JSON.stringify(expectedPeople) !== JSON.stringify(scoredPeople)) {
      throw new Error("Visual evaluation did not score every included person");
    }
    evaluations.push(evaluation);
  }
  return evaluations;
}

export async function visualEvaluationNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  try {
    const evaluations = await evaluateCandidates(state);
    const evaluated = rankCandidates(
      state.generatedCandidates.map((candidate) => {
        const evaluation = evaluations.find(
          (value) => value.candidateId === candidate.id
        ) as CandidateEvaluation;
        return {
          ...candidate,
          evaluation,
          qualified: qualifiesCandidate(evaluation),
        };
      })
    );
    const qualified = evaluated.filter((candidate) => candidate.qualified);
    if (qualified.length > 0) {
      return {
        generatedCandidates: evaluated,
        visualEvaluation: qualified[0].evaluation,
      };
    }

    const visualRegenerationCount = state.visualRegenerationCount + 1;
    const visualBrief = state.visualBrief;
    if (
      visualRegenerationCount === 2 &&
      visualBrief &&
      visualBrief.compositionMode !== "CONCEPTUAL"
    ) {
      return {
        generatedCandidates: evaluated,
        visualEvaluation: evaluated[0]?.evaluation ?? null,
        visualRegenerationCount,
        visualBrief: {
          ...visualBrief,
          primaryCharacter: null,
          secondaryCharacters: [],
          compositionMode: "CONCEPTUAL",
          referenceRequirements: [],
        },
        imagePrompt: visualBrief.conceptualFallbackPrompt,
      };
    }
    return {
      generatedCandidates: evaluated,
      visualEvaluation: evaluated[0]?.evaluation ?? null,
      visualRegenerationCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      generatedCandidates: [],
      visualRegenerationCount: 3,
      errorLog: [`[visualProducer:evaluation] ${message}`],
    };
  }
}

export async function visualBriefNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  try {
    const visualBrief = await createVisualBrief(state);
    return {
      visualBrief,
      imagePrompt:
        visualBrief.compositionMode === "CONCEPTUAL"
          ? visualBrief.generationPromptTemplate
          : null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      visualBrief: null,
      imagePrompt: null,
      errorLog: [`[visualProducer] ${message}`],
    };
  }
}
