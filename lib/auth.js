import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");

export async function createToken(partner, label) {
  return new SignJWT({ partner, label })
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
    return JSON.parse(process.env.PARTNER_CREDENTIALS || "{}");
  } catch {
    return {};
  }
}
