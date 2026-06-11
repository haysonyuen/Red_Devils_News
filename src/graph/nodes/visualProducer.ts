import {
  CompositionMode,
  ReferenceRole,
  VisualBrief,
} from "../contracts";
import { PipelineState } from "../state";
import { callLlmJson } from "../../llm/client";
import { loadPrompt } from "../../prompts/load";

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
      storyStatus: state.storySelection.storyStatus,
    },
    claims: state.factCheck.claimChecks,
    allowedImplications: state.factCheck.visualImplicationsAllowed,
    forbiddenImplications: state.factCheck.visualImplicationsForbidden,
  };
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

  return brief;
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
