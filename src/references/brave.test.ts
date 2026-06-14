import {
  BraveConfigurationError,
  BraveImageResult,
  searchOfficialPlayerImages,
} from "./brave";

async function run(): Promise<void> {
  const calls: Array<{ query: string; count: number }> = [];
  const result: BraveImageResult = {
    imageUrl: "https://cdn.whufc.com/mateus.jpg",
    sourcePageUrl: "https://www.whufc.com/player/mateus-fernandes",
    title: "Mateus Fernandes",
  };
  const results = await searchOfficialPlayerImages(
    {
      canonicalName: "Mateus Fernandes",
      officialDomains: ["whufc.com", "premierleague.com"],
    },
    {
      searchImages: async (query, count) => {
        calls.push({ query, count });
        return [result, result];
      },
    }
  );
  if (
    calls[0]?.query !== '"Mateus Fernandes" site:whufc.com' ||
    calls.length !== 2
  ) {
    throw new Error("Brave must query each official domain with the exact name");
  }
  if (results.length !== 1) {
    throw new Error("Duplicate image/source pairs should be removed");
  }

  const queriedDomains: string[] = [];
  await searchOfficialPlayerImages(
    {
      canonicalName: "Player One",
      officialDomains: [
        "one.example",
        "two.example",
        "three.example",
        "four.example",
        "five.example",
        "six.example",
      ],
    },
    {
      searchImages: async (query) => {
        queriedDomains.push(query);
        return [];
      },
    }
  );
  if (queriedDomains.length !== 5) {
    throw new Error("Brave discovery must query no more than five domains");
  }

  const many = await searchOfficialPlayerImages(
    {
      canonicalName: "Player One",
      officialDomains: ["official.example"],
    },
    {
      searchImages: async () =>
        Array.from({ length: 15 }, (_value, index) => ({
          imageUrl: `https://cdn.example/${index}.jpg`,
          sourcePageUrl: `https://official.example/players/${index}`,
          title: `Player One ${index}`,
        })),
    }
  );
  if (many.length !== 10) {
    throw new Error("Brave discovery must retain no more than ten raw results");
  }

  const offDomain = await searchOfficialPlayerImages(
    {
      canonicalName: "Player One",
      officialDomains: ["official.example"],
    },
    {
      searchImages: async () => [
        {
          imageUrl: "https://cdn.example/player.jpg",
          sourcePageUrl: "https://untrusted.example/player",
          title: "Player One",
        },
      ],
    }
  );
  if (offDomain.length !== 0) {
    throw new Error("Off-domain source pages must be rejected");
  }

  const previousKey = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    await searchOfficialPlayerImages({
      canonicalName: "Player One",
      officialDomains: ["official.example"],
    });
    throw new Error("Missing Brave key should throw");
  } catch (error) {
    if (!(error instanceof BraveConfigurationError)) {
      throw error;
    }
  } finally {
    if (previousKey === undefined) {
      delete process.env.BRAVE_SEARCH_API_KEY;
    } else {
      process.env.BRAVE_SEARCH_API_KEY = previousKey;
    }
  }
}

run()
  .then(() => console.log("Brave reference search tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
