import {
  discoverReferenceCandidates,
  extractPageMetadata,
  isApprovedOfficialHost,
} from "./discovery";

async function run(): Promise<void> {
  const articleUrl =
    "https://www.bbc.com/sport/football/articles/example";
  const articleHtml = `
    <html>
      <head>
        <meta property="og:image" content="/images/player.jpg">
        <meta name="twitter:image" content="https://cdn.example/player.jpg">
      </head>
      <body>
        <a href="https://www.manutd.com/en/players-and-staff/detail/player-one">
          Player One profile
        </a>
        <a href="https://random.example/player-one">Untrusted profile</a>
      </body>
    </html>`;
  const officialHtml = `
    <html>
      <head>
        <meta property="og:image" content="https://assets.manutd.com/player-one.jpg">
      </head>
    </html>`;

  const metadata = extractPageMetadata(articleUrl, articleHtml);
  if (metadata.imageUrls[0] !== "https://www.bbc.com/images/player.jpg") {
    throw new Error("Relative metadata images should resolve against the page");
  }
  if (!isApprovedOfficialHost("https://www.manutd.com/en/players")) {
    throw new Error("Known official football domains should be accepted");
  }
  if (isApprovedOfficialHost("https://random.example/player-one")) {
    throw new Error("Unknown domains should not be crawled");
  }

  const fetched: string[] = [];
  const candidates = await discoverReferenceCandidates({
    requestId: "request-1",
    person: "Player One",
    selectedArticleUrls: [articleUrl],
    fetchHtml: async (url) => {
      fetched.push(url);
      if (url === articleUrl) return articleHtml;
      if (url.startsWith("https://www.manutd.com/")) return officialHtml;
      throw new Error(`Unexpected fetch: ${url}`);
    },
    now: new Date("2026-06-13T12:00:00.000Z"),
  });

  if (
    candidates.length !== 3 ||
    candidates[0].origin !== "SELECTED_ARTICLE" ||
    candidates[2].origin !== "OFFICIAL_LINK"
  ) {
    throw new Error("Article images should rank before official linked pages");
  }
  if (fetched.includes("https://random.example/player-one")) {
    throw new Error("Discovery must not fetch unknown linked domains");
  }

  const duplicateHtml = `
    <meta property="og:image" content="https://cdn.example/player.jpg#fragment">
    <meta name="twitter:image" content="https://cdn.example/player.jpg">`;
  const deduplicated = extractPageMetadata(articleUrl, duplicateHtml);
  if (deduplicated.imageUrls.length !== 1) {
    throw new Error("Canonical image URLs should be deduplicated");
  }
}

run()
  .then(() => console.log("Reference discovery tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
