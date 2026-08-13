import { SignJWT, jwtVerify } from "jose";
import { ADMIN_JWT_PARTNER } from "./adminSession";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");

export async function createToken(partner, label, search) {
  const claims = { partner, label };
  if (search) claims.search = search;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(secret);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export function getCredentials() {
  try {
    const parsed = JSON.parse(process.env.PARTNER_CREDENTIALS || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to parse PARTNER_CREDENTIALS env var:", error?.message || error);
    return {};
  }
}

/** Distinct HubSpot partner keys from credentials (excludes admin `ALL`). Sorted A–Z. */
export function getDistinctCredentialPartners() {
  const creds = getCredentials();
  const set = new Set();
  for (const v of Object.values(creds)) {
    if (!v || typeof v !== "object") continue;
    const p = v.partner;
    if (typeof p !== "string" || !p.trim() || p === ADMIN_JWT_PARTNER) continue;
    set.add(p.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Resolves which partner key(s) to use for HubSpot / sheet data.
 * Non-admin: always JWT `partner`.
 * Admin (`ALL` JWT): `selectedPartner` must be a credential partner, or `ALL` for every partner.
 */
export function resolveDataPartner(payload, selectedPartnerRaw) {
  const jwtPartner = payload?.partner;
  if (typeof jwtPartner !== "string" || !jwtPartner.trim()) {
    return {
      dataPartner: null,
      partnerList: [],
      allPartners: false,
      isAdmin: false,
      error: "Missing partner in token.",
    };
  }
  if (jwtPartner !== ADMIN_JWT_PARTNER) {
    const dataPartner = jwtPartner.trim();
    return {
      dataPartner,
      partnerList: [dataPartner],
      allPartners: false,
      isAdmin: false,
    };
  }
  const requested =
    typeof selectedPartnerRaw === "string" && selectedPartnerRaw.trim()
      ? selectedPartnerRaw.trim()
      : null;
  if (!requested) {
    return {
      dataPartner: null,
      partnerList: [],
      allPartners: false,
      isAdmin: true,
      error: "selectedPartner is required for admin sessions.",
    };
  }
  const allowed = getDistinctCredentialPartners();
  if (requested === ADMIN_JWT_PARTNER) {
    return {
      dataPartner: ADMIN_JWT_PARTNER,
      partnerList: allowed,
      allPartners: true,
      isAdmin: true,
    };
  }
  if (!allowed.includes(requested)) {
    return {
      dataPartner: null,
      partnerList: [],
      allPartners: false,
      isAdmin: true,
      error: "Invalid selectedPartner.",
    };
  }
  return {
    dataPartner: requested,
    partnerList: [requested],
    allPartners: false,
    isAdmin: true,
  };
}
