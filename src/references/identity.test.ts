import {
  IdentityDependencies,
  IdentitySearchResult,
  PersonIdentity,
  resolvePersonIdentity,
} from "./identity";

const mateusSearch: IdentitySearchResult = {
  id: "Q123",
  label: "Mateus Fernandes",
  aliases: ["Mateus Goncalo Espanha Fernandes"],
  description: "Portuguese association football player",
};

const mateusIdentity: PersonIdentity = {
  entityId: "Q123",
  canonicalName: "Mateus Fernandes",
  aliases: ["Mateus Goncalo Espanha Fernandes"],
  description: "Portuguese association football player",
  portraitUrl:
    "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mateus.jpg",
  officialDomains: ["whufc.com"],
};

function dependencies(
  results: IdentitySearchResult[],
  identities: Record<string, PersonIdentity | null>
): IdentityDependencies {
  return {
    search: async () => results,
    loadEntity: async (entityId) => identities[entityId] ?? null,
  };
}

async function run(): Promise<void> {
  const exact = await resolvePersonIdentity(
    "Mateus Fernandes",
    dependencies([mateusSearch], { Q123: mateusIdentity })
  );
  if (
    exact?.entityId !== "Q123" ||
    exact.officialDomains[0] !== "whufc.com"
  ) {
    throw new Error("Exact football identity should resolve");
  }

  const alias = await resolvePersonIdentity(
    "Mateus Goncalo Espanha Fernandes",
    dependencies([mateusSearch], { Q123: mateusIdentity })
  );
  if (alias?.entityId !== "Q123") {
    throw new Error("Exact full alias should resolve");
  }

  const surnameOnly = await resolvePersonIdentity(
    "Fernandes",
    dependencies([mateusSearch], { Q123: mateusIdentity })
  );
  if (surnameOnly !== null) {
    throw new Error("Surname-only input must not resolve");
  }

  const ambiguous = await resolvePersonIdentity(
    "Alex Smith",
    dependencies(
      [
        {
          id: "Q1",
          label: "Alex Smith",
          aliases: [],
          description: "English association football player",
        },
        {
          id: "Q2",
          label: "Alex Smith",
          aliases: [],
          description: "Scottish association football player",
        },
      ],
      {
        Q1: { ...mateusIdentity, entityId: "Q1", canonicalName: "Alex Smith" },
        Q2: { ...mateusIdentity, entityId: "Q2", canonicalName: "Alex Smith" },
      }
    )
  );
  if (ambiguous !== null) {
    throw new Error("Ambiguous exact football identities must fail closed");
  }

  const missingPortrait = await resolvePersonIdentity(
    "Mateus Fernandes",
    dependencies([mateusSearch], { Q123: null })
  );
  if (missingPortrait !== null) {
    throw new Error("Identity without a portrait must fail closed");
  }

  const nonFootball = await resolvePersonIdentity(
    "Mateus Fernandes",
    dependencies(
      [{ ...mateusSearch, description: "Portuguese software engineer" }],
      { Q123: mateusIdentity }
    )
  );
  if (nonFootball !== null) {
    throw new Error("Non-football identity must fail closed");
  }
}

run()
  .then(() => console.log("Reference identity tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
