/**
 * Built-in search-level credentials for renamed access codes.
 * Env `PARTNER_CREDENTIALS` overrides these when the same key exists.
 */
export const BUILTIN_SEARCH_CREDENTIALS = {
  "sc-trivest-esi-5f3e": {
    partner: "Trivest",
    search: "Electronic Security Integration (ESI)",
    label: "Trivest — Electronic Security Integration (ESI)",
  },
  "sc-trivest-residential-fencing-1aa5": {
    partner: "Trivest",
    search: "Residential Fencing",
    label: "Trivest — Residential Fencing",
  },
};

/** Legacy access codes that should resolve to a current credential key. */
export const ACCESS_CODE_ALIASES = {
  "sc-trivest-access-control-5f3e": "sc-trivest-esi-5f3e",
  "sc-trivest-electronic-security-integration-5f3e": "sc-trivest-esi-5f3e",
  "sc-trivest-fencing-1aa5": "sc-trivest-residential-fencing-1aa5",
};

export function normalizeAccessCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .trim()
    .toLowerCase();
}

export function resolveAccessCredential(normalizedCode, envCredentials = {}) {
  const code = normalizeAccessCode(normalizedCode);
  if (!code) return null;

  const merged = new Map();
  for (const [key, value] of Object.entries(BUILTIN_SEARCH_CREDENTIALS)) {
    merged.set(normalizeAccessCode(key), value);
  }
  for (const [key, value] of Object.entries(envCredentials)) {
    if (value && typeof value === "object") {
      merged.set(normalizeAccessCode(key), value);
    }
  }

  if (merged.has(code)) return merged.get(code);

  const aliasTarget = ACCESS_CODE_ALIASES[code];
  if (aliasTarget) {
    const target = normalizeAccessCode(aliasTarget);
    if (merged.has(target)) return merged.get(target);
    return BUILTIN_SEARCH_CREDENTIALS[target] || null;
  }

  return null;
}
