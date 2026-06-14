import axios from "axios";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_ENTITY_DATA =
  "https://www.wikidata.org/wiki/Special:EntityData";

export interface IdentitySearchResult {
  id: string;
  label: string;
  aliases: string[];
  description: string;
}

export interface PersonIdentity {
  entityId: string;
  canonicalName: string;
  aliases: string[];
  description: string;
  portraitUrl: string;
  officialDomains: string[];
}

export interface IdentityDependencies {
  search: (name: string) => Promise<IdentitySearchResult[]>;
  loadEntity: (entityId: string) => Promise<PersonIdentity | null>;
}

type WikidataValue = {
  value?: {
    id?: string;
    time?: string;
    text?: string;
  } | string;
};

type WikidataStatement = {
  mainsnak?: { datavalue?: WikidataValue };
  qualifiers?: Record<string, Array<{ datavalue?: WikidataValue }>>;
};

type WikidataEntity = {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WikidataStatement[]>;
};

export function normalizePersonName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isFullName(value: string): boolean {
  return normalizePersonName(value).split(" ").length >= 2;
}

function isFootballDescription(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  return (
    normalized.includes("football") ||
    normalized.includes("soccer") ||
    normalized.includes("footballer")
  );
}

function statementString(statement: WikidataStatement): string | null {
  const value = statement.mainsnak?.datavalue?.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return value.id ?? value.text ?? null;
  }
  return null;
}

function hasEnded(statement: WikidataStatement): boolean {
  const endTime = statement.qualifiers?.P582?.[0]?.datavalue?.value;
  if (!endTime || typeof endTime === "string") return false;
  if (!endTime.time) return false;
  return Date.parse(endTime.time.replace(/^\+/, "")) < Date.now();
}

async function fetchEntity(entityId: string): Promise<WikidataEntity | null> {
  const response = await axios.get<{ entities?: Record<string, WikidataEntity> }>(
    `${WIKIDATA_ENTITY_DATA}/${encodeURIComponent(entityId)}.json`,
    { timeout: 10_000 }
  );
  return response.data.entities?.[entityId] ?? null;
}

async function defaultSearch(name: string): Promise<IdentitySearchResult[]> {
  const response = await axios.get<{
    search?: Array<{
      id: string;
      label?: string;
      aliases?: string[];
      description?: string;
    }>;
  }>(WIKIDATA_API, {
    params: {
      action: "wbsearchentities",
      search: name,
      language: "en",
      uselang: "en",
      format: "json",
      limit: 10,
      type: "item",
    },
    timeout: 10_000,
  });
  return (response.data.search ?? []).map((result) => ({
    id: result.id,
    label: result.label ?? "",
    aliases: result.aliases ?? [],
    description: result.description ?? "",
  }));
}

async function defaultLoadEntity(
  entityId: string
): Promise<PersonIdentity | null> {
  const entity = await fetchEntity(entityId);
  if (!entity) return null;

  const canonicalName = entity.labels?.en?.value ?? "";
  const aliases = (entity.aliases?.en ?? []).map((alias) => alias.value);
  const description = entity.descriptions?.en?.value ?? "";
  const portraitFilename = entity.claims?.P18?.map(statementString).find(Boolean);
  if (
    !canonicalName ||
    !portraitFilename ||
    !isFootballDescription(description)
  ) {
    return null;
  }

  const clubIds = (entity.claims?.P54 ?? [])
    .filter((statement) => !hasEnded(statement))
    .map(statementString)
    .filter((value): value is string => Boolean(value));
  const clubEntities = await Promise.all(clubIds.map(fetchEntity));
  const officialDomains = clubEntities
    .flatMap((club) => club?.claims?.P856 ?? [])
    .map(statementString)
    .flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, "")];
      } catch {
        return [];
      }
    })
    .filter((domain, index, domains) => domains.indexOf(domain) === index);

  return {
    entityId,
    canonicalName,
    aliases,
    description,
    portraitUrl: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(
      portraitFilename
    )}`,
    officialDomains,
  };
}

export async function resolvePersonIdentity(
  requestedName: string,
  dependencies: Partial<IdentityDependencies> = {}
): Promise<PersonIdentity | null> {
  if (!isFullName(requestedName)) return null;

  const search = dependencies.search ?? defaultSearch;
  const loadEntity = dependencies.loadEntity ?? defaultLoadEntity;
  const requested = normalizePersonName(requestedName);
  const searchResults = await search(requestedName);
  const matchingResults = searchResults.filter((result) => {
    if (!isFootballDescription(result.description)) return false;
    return [result.label, ...result.aliases].some(
      (name) => normalizePersonName(name) === requested
    );
  });

  const loaded = (
    await Promise.all(matchingResults.map((result) => loadEntity(result.id)))
  ).filter((identity): identity is PersonIdentity => {
    if (!identity?.portraitUrl || !isFootballDescription(identity.description)) {
      return false;
    }
    return [identity.canonicalName, ...identity.aliases].some(
      (name) => normalizePersonName(name) === requested
    );
  });

  return loaded.length === 1 ? loaded[0] : null;
}
