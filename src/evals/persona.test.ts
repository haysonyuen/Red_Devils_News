import fixtures from "./persona.fixtures.json";
import { validateCaption } from "../validation/caption";
import {
  addImageSafetyConstraints,
  validateImagePrompt,
} from "../validation/imagePrompt";

const validIssues = validateCaption(fixtures.validCaption, fixtures.sourceTexts);
if (validIssues.length > 0) {
  throw new Error(`Valid supporter caption failed: ${validIssues.join(" ")}`);
}

for (const caption of fixtures.invalidCaptions) {
  const issues = validateCaption(caption, fixtures.sourceTexts);
  if (issues.length === 0) {
    throw new Error(`Invalid caption unexpectedly passed: ${caption}`);
  }
}

const validImagePrompt =
  "Photorealistic editorial still life of an unsigned contract folder beside red and black football boots in a dim generic stadium tunnel, dramatic side lighting, shallow depth of field.";
if (validateImagePrompt(validImagePrompt).length > 0) {
  throw new Error("Valid conceptual image prompt failed validation");
}

const invalidImagePrompt =
  "Portrait of a Manchester United player wearing the home jersey at Old Trafford.";
if (validateImagePrompt(invalidImagePrompt).length === 0) {
  throw new Error("Synthetic player portrait unexpectedly passed validation");
}

const constrainedPrompt = addImageSafetyConstraints(validImagePrompt);
if (!constrainedPrompt.includes("No people") || !constrainedPrompt.includes("No football kits")) {
  throw new Error("Image safety constraints were not appended");
}

console.log("Persona evaluation fixtures passed");
