import "dotenv/config";
import { discoverReferenceCandidates } from "./discovery";

async function run(): Promise<void> {
  if (process.env.RUN_REFERENCE_INTEGRATION !== "1") {
    console.log(
      "Verified reference integration skipped; set RUN_REFERENCE_INTEGRATION=1"
    );
    return;
  }
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    throw new Error("BRAVE_SEARCH_API_KEY is required");
  }
  if (!process.env.AWS_REGION) {
    throw new Error("AWS_REGION is required");
  }

  const person =
    process.env.REFERENCE_INTEGRATION_PERSON ?? "Marcus Rashford";
  const candidates = await discoverReferenceCandidates({
    requestId: "integration-reference",
    person,
  });
  const summary = candidates.map((candidate) => ({
    sourceHost: new URL(candidate.sourcePageUrl).hostname,
    similarity: candidate.faceSimilarity,
    evidenceSignals: candidate.evidenceSignalCount,
  }));
  console.log(
    `Verified reference integration: person=${person} candidates=${candidates.length}`
  );
  console.log(JSON.stringify(summary, null, 2));
  if (candidates.length === 0) {
    throw new Error("No official candidate passed every verification gate");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
