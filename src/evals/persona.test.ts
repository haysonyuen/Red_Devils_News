import fixtures from "./persona.fixtures.json";
import { validateCaption } from "../validation/caption";

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

console.log("Persona evaluation fixtures passed");
