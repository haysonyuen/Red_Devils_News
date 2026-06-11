export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function mapToSuppliedUrl(
  candidate: string,
  suppliedUrls: string[]
): string | null {
  let canonicalCandidate: string;
  try {
    canonicalCandidate = canonicalizeUrl(candidate);
  } catch {
    return null;
  }

  return (
    suppliedUrls.find((url) => {
      try {
        return canonicalizeUrl(url) === canonicalCandidate;
      } catch {
        return false;
      }
    }) ?? null
  );
}
