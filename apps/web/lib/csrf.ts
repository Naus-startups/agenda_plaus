// The session cookie is SameSite=Lax, which already keeps it off cross-site form posts. This
// is the second lock: a request that changes something (anything but GET/HEAD/OPTIONS) must
// come from this site's own pages. Browsers say where a request came from in Sec-Fetch-Site
// (or, older ones, in Origin), and a page on another site can't forge either. Requests with
// neither header don't come from a browser — no cookie is sent on anyone's behalf there.
// A plain module (no Next imports), so the API's test suite can exercise it.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteMutation(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;

  const fetchSite = headers.get("sec-fetch-site");
  // "none": typed in the address bar or opened from a bookmark — the user's own action.
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).host !== headers.get("host");
  } catch {
    return true;
  }
}
