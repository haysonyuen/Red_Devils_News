import { parseBbcFootballRss } from "./bbcRss";

const xml = `<?xml version="1.0"?>
<rss>
  <channel>
    <item>
      <title>Manchester United announce new signing</title>
      <description>The latest news from Old Trafford.</description>
      <link>https://www.bbc.co.uk/sport/football/articles/example</link>
      <pubDate>Wed, 10 Jun 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Arsenal prepare for next season</title>
      <description>Updates from north London.</description>
      <link>https://www.bbc.co.uk/sport/football/articles/other</link>
      <pubDate>Wed, 10 Jun 2026 11:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Manchester United announce new signing</title>
      <description>Duplicate feed entry.</description>
      <link>https://www.bbc.co.uk/sport/football/articles/example</link>
      <pubDate>Wed, 10 Jun 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const results = parseBbcFootballRss(xml, new Date("2026-06-10T13:00:00Z"));

if (results.length !== 1) {
  throw new Error(`Expected 1 Manchester United result, got ${results.length}`);
}
if (results[0].title !== "Manchester United announce new signing") {
  throw new Error(`Unexpected title: ${results[0].title}`);
}
if (results[0].source !== "BBC Sport") {
  throw new Error(`Unexpected source: ${results[0].source}`);
}

console.log("BBC RSS parser test passed");
