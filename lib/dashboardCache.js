/** 15 minutes — HubSpot dashboard payload cache */
export const DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000;

const store =
  globalThis.__surflineDashboardCacheStore || new Map();
globalThis.__surflineDashboardCacheStore = store;

/**
 * @template T
 * @param {string} key
 * @returns {T | null}
 */
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age > DASHBOARD_CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Lightweight metadata for debugging cache behavior.
 * @param {string} key
 */
export function getCacheMeta(key) {
  const entry = store.get(key);
  if (!entry) {
    return { exists: false, expired: false, timestamp: null, ageMs: null };
  }
  const ageMs = Date.now() - entry.timestamp;
  return {
    exists: true,
    expired: ageMs > DASHBOARD_CACHE_TTL_MS,
    timestamp: entry.timestamp,
    ageMs,
  };
}

/**
 * @template T
 * @param {string} key
 * @param {T} data
 */
export function setCached(key, data) {
  store.set(key, { data, timestamp: Date.now() });
}

/** Delete one cache entry by key. */
export function deleteCached(key) {
  return store.delete(key);
}

/** Drop every cached entry for this partner (all search keys + search pills). */
export function invalidatePartnerCaches(partner) {
  const token = `::${partner}::`;
  for (const k of [...store.keys()]) {
    if (k.includes(token)) store.delete(k);
  }
}
