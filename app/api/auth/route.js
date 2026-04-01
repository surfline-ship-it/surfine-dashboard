import { createToken, getCredentials } from "@/lib/auth";

export async function POST(request) {
  const { password } = await request.json();

  if (!password) {
    return Response.json({ error: "Password required" }, { status: 400 });
  }

  const credentials = getCredentials();
  const match = credentials[password];

  if (!match) {
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createToken(match.partner, match.label);

  return Response.json({
    token,
    partner: match.partner,
    label: match.label,
  });
}
