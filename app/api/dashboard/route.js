import { verifyToken } from "@/lib/auth";
import {
  getPartnerContacts,
  getPartnerDeals,
  getCallEngagements,
  getPartnerSearches,
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

  const { partner, label } = payload;
  const { searchParams } = new URL(request.url);
  const searchFilter = searchParams.get("search") || null;

  try {
    // Fetch all data in parallel
    const [contacts, deals, searches] = await Promise.all([
      getPartnerContacts(partner),
      getPartnerDeals(partner),
      getPartnerSearches(partner),
    ]);

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
    const metrics = computeMetrics(contacts, deals, callData, searchFilter);

    return Response.json({
      partner: label,
      partnerKey: partner,
      searches,
      searchFilter,
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
