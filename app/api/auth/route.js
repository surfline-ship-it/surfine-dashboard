import {
  createToken,
  getCredentials,
  getDistinctCredentialPartners,
} from "@/lib/auth";
import { ADMIN_JWT_PARTNER } from "@/lib/adminSession";

function normalizeAccessCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .trim()
    .toLowerCase();
}

export async function POST(request) {
  const { password } = await request.json();
  const normalizedPassword = normalizeAccessCode(password);

  if (!normalizedPassword) {
    return Response.json({ error: "Password required" }, { status: 400 });
  }

  const credentials = getCredentials();
  const normalizedCredentials = Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [normalizeAccessCode(key), value])
  );
  const match = normalizedCredentials[normalizedPassword];

  if (!match) {
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createToken(match.partner, match.label, match.search);

  const adminPartnerOptions =
    match.partner === ADMIN_JWT_PARTNER ? getDistinctCredentialPartners() : undefined;

  return Response.json({
    token,
    partner: match.partner,
    label: match.label,
    ...(match.search && { search: match.search }),
    ...(adminPartnerOptions && { adminPartnerOptions }),
  });
}
