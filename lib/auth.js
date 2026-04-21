import { SignJWT, jwtVerify } from "jose";

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
