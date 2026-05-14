import { verifyToken, resolveDataPartner } from "@/lib/auth";
import { canonicalSearchName } from "@/lib/searchNames";
import { getPartnerDeals, pipelineStageLabel } from "@/lib/hubspot";

function normalizeText(v) {
  return String(v || "").toLowerCase().trim();
}

function stageForLead(lead, partnerDeals) {
  const leadSearch = canonicalSearchName(lead.searchName);
  const leadCompany = normalizeText(lead.companyName);
  const leadDomain = normalizeText(lead.domain);

  const sameSearchDeals = partnerDeals.filter(
    (d) => canonicalSearchName(d.properties?.search_name) === leadSearch
  );
  const candidates = sameSearchDeals.length ? sameSearchDeals : partnerDeals;
  if (candidates.length === 0) return "-";

  const byMatch = candidates.filter((d) => {
    const dealname = normalizeText(d.properties?.dealname);
    if (!dealname) return false;
    return (
      (leadCompany && dealname.includes(leadCompany)) ||
      (leadDomain && dealname.includes(leadDomain))
    );
  });
  const pool = byMatch.length ? byMatch : candidates;
  pool.sort((a, b) => {
    const ta = Date.parse(a.properties?.createdate || "");
    const tb = Date.parse(b.properties?.createdate || "");
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  const stage = pool[0]?.properties?.dealstage;
  return pipelineStageLabel(stage) || "-";
}

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { partner } = payload;
  if (!partner || typeof partner !== "string") {
    return Response.json(
      { error: "Invalid session", details: "Missing partner in token." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const resolved = resolveDataPartner(payload, body?.selectedPartner);
    if (resolved.error || !resolved.dataPartner) {
      return Response.json(
        { error: "Bad request", details: resolved.error || "Missing partner scope." },
        { status: 400 }
      );
    }
    const dataPartner = resolved.dataPartner;

    const leads = Array.isArray(body?.leads) ? body.leads : [];
    if (leads.length === 0) {
      return Response.json({ stageByLeadId: {} });
    }

    // Single HubSpot deals fetch for the partner, then in-memory matching.
    const partnerDeals = await getPartnerDeals(dataPartner);
    const stageByLeadId = {};
    leads.forEach((lead) => {
      const id = String(lead?.id || "");
      if (!id) return;
      stageByLeadId[id] = stageForLead(lead, partnerDeals);
    });
    return Response.json({ stageByLeadId });
  } catch (error) {
    console.error("Leads stages error:", error);
    return Response.json(
      { error: "Failed to load lead stages", details: error.message },
      { status: 500 }
    );
  }
}
