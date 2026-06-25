import {
  createToken,
  getCredentials,
  getDistinctCredentialPartners,
} from "@/lib/auth";
import { ADMIN_JWT_PARTNER } from "@/lib/adminSession";
import {
  normalizeAccessCode,
  resolveAccessCredential,
} from "@/lib/searchCredentials";

export async function POST(request) {
  const { password } = await request.json();
  const normalizedPassword = normalizeAccessCode(password);

  if (!normalizedPassword) {
    return Response.json({ error: "Password required" }, { status: 400 });
  }

  const match = resolveAccessCredential(normalizedPassword, getCredentials());

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
