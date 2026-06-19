import { PipelineState } from "../state";
import { ingestNode } from "./ingest";

const baseState = {
  runId: "fixture-run",
  triggerTime: "2026-06-19T12:00:00.000Z",
} as PipelineState;

const articleHtml = `
  <html>
    <head>
      <meta property="og:title" content="Marcus Rashford transfer latest">
      <meta property="og:site_name" content="BBC Sport">
    </head>
    <body>
      <article>
        Manchester United are monitoring Marcus Rashford's situation.
        The club are waiting on a decision before pre-season.
      </article>
    </body>
  </html>`;

async function run(): Promise<void> {
  const fixtureUrl =
    "https://www.bbc.com/sport/football/articles/rashford-fixture";
  const fixtureResult = await ingestNode(baseState, {
    fixtureArticleUrl: fixtureUrl,
    fetchNews: async () => {
      throw new Error("BBC RSS should not run when fixture URL is set");
    },
    fetchHtml: async (url) => {
      if (url !== fixtureUrl) {
        throw new Error(`Unexpected fixture fetch: ${url}`);
      }
      return articleHtml;
    },
  });

  if (
    fixtureResult.rawSearchHits?.length !== 1 ||
    fixtureResult.filteredArticles?.[0]?.url !== fixtureUrl ||
    !fixtureResult.filteredArticles[0].bodyText.includes("Marcus Rashford")
  ) {
    throw new Error("Allowlisted fixture URL should be scraped as the only hit");
  }

  const rejectedResult = await ingestNode(baseState, {
    fixtureArticleUrl: "https://example.com/not-allowlisted",
    fetchNews: async () => {
      throw new Error("BBC RSS should not run for rejected fixtures");
    },
    fetchHtml: async () => articleHtml,
  });

  if (
    rejectedResult.rawSearchHits?.length !== 1 ||
    rejectedResult.filteredArticles?.length !== 0
  ) {
    throw new Error("Non-allowlisted fixture URL should be rejected");
  }
}

run()
  .then(() => console.log("Ingest fixture tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
