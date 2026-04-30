/**
 * Legacy HubSpot search_name values merged into a canonical pill label.
 * Add entries here when a search is renamed in HubSpot but old records remain.
 */
export const SEARCH_NAME_LEGACY_MAP = {
  Fencing: "Residential Fencing",
  "Access Control": "Electronic Security Integration (ESI)",
};

export function canonicalSearchName(name) {
  if (name == null || typeof name !== "string") return name;
  const t = name.trim();
  if (!t) return t;
  return SEARCH_NAME_LEGACY_MAP[t] ?? t;
}

/** Distinct HubSpot search_name values to OR together for CRM filters (canonical + legacy). */
export function searchNameHubSpotEquivalents(canonicalOrRaw) {
  const canonical = canonicalSearchName(
    typeof canonicalOrRaw === "string" ? canonicalOrRaw.trim() : canonicalOrRaw
  );
  if (!canonical) return [];
  const out = new Set([canonical]);
  Object.entries(SEARCH_NAME_LEGACY_MAP).forEach(([legacy, c]) => {
    if (c === canonical) out.add(legacy);
  });
  return Array.from(out);
}
