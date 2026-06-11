import fs from "node:fs";
import path from "node:path";

export function loadPrompt(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), "prompts", fileName), "utf8");
}
