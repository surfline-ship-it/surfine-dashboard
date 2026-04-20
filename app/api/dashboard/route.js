import { verifyToken } from "@/lib/auth";
import {
  getPartnerContacts,
  getPartnerDeals,
  getCallEngagements,
  getSearchNamesFromContacts,
  computeMetrics,
} from "@/lib/hubspot";

export async function GET(request) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return Response.json(
      {
        error: "Failed to load dashboard data",
        details:
          "HUBSPOT_ACCESS_TOKEN is not set. Add it in Vercel Project → Settings → Environment Variables.",
      },
      { status: 500 }
    );
  }

  const { partner, label, search: jwtSearch } = payload;
  if (!partner || typeof partner !== "string") {
    return Response.json(
      { error: "Invalid session", details: "Missing partner in token. Sign out and sign in again." },
      { status: 401 }
    );
  }
  const { searchParams } = new URL(request.url);
  const searchFromJwt =
    typeof jwtSearch === "string" && jwtSearch.trim() !== "" ? jwtSearch.trim() : null;
  const searchFromQuery = searchParams.get("search");
  // Search-level JWT locks to one search; query param is ignored when JWT has search
  const searchFilter = searchFromJwt ?? (searchFromQuery || null);
  const searchLocked = Boolean(searchFromJwt);
  const startDate = searchParams.get("start") || null;
  const endDate = searchParams.get("end") || null;

  try {
    // Contacts + deals only (do not call getPartnerSearches — it duplicates contact search and spikes rate limits)
    const contacts = await getPartnerContacts(partner, searchFilter || undefined);
    const searches = getSearchNamesFromContacts(contacts);
    const deals = await getPartnerDeals(partner, searchFilter || undefined);

    // Get call data for partner's contacts
    const contactIds = contacts.map((c) => c.id);

    // For large contact lists, we'll limit call lookups to avoid rate limits
    // In production, this should be cached or pre-computed
    const callContactIds = contactIds.slice(0, 200); // cap at 200 for API rate limits
    let callData = { total: 0, connected: 0, calls: [] };

    try {
      callData = await getCallEngagements(callContactIds);
    } catch (e) {
      console.error("Call data fetch error:", e.message);
      // Continue without call data rather than failing the whole dashboard
    }

    // Compute metrics
    const metrics = computeMetrics(contacts, deals, callData, searchFilter, {
      start: startDate,
      end: endDate,
    });

    return Response.json({
      partner: label,
      partnerKey: partner,
      searches,
      searchFilter,
      searchLocked,
      dateFilter: { start: startDate, end: endDate },
      metrics,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return Response.json(
      { error: "Failed to load dashboard data", details: error.message },
      { status: 500 }
    );
  }
}
