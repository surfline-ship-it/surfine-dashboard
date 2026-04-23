import { verifyToken } from "@/lib/auth";
import {
  getPartnerContacts,
  getPartnerDeals,
  getInterestedCompanyCount,
  getTotalOutboundCalls,
  getSearchNamesFromContacts,
  computeMetrics,
} from "@/lib/hubspot";
import {
  getCached,
  setCached,
  invalidatePartnerCaches,
} from "@/lib/dashboardCache";

function cacheKey(partner, searchFilter) {
  return `${partner}::${searchFilter || "all"}`;
}

function searchPillsCacheKey(partner) {
  return `${partner}::__search_pills__`;
}

async function getPartnerSearchPillsList(partner) {
  const pillsKey = searchPillsCacheKey(partner);
  const hit = getCached(pillsKey);
  if (hit) return hit.searches;
  const allContacts = await getPartnerContacts(partner);
  const searches = getSearchNamesFromContacts(allContacts);
  setCached(pillsKey, { searches });
  return searches;
}

export async function GET(request) {
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
  const searchFilter = searchFromJwt ?? (searchFromQuery || null);
  const searchLocked = Boolean(searchFromJwt);
  const startDate = searchParams.get("start") || null;
  const endDate = searchParams.get("end") || null;
  const forceRefresh =
    searchParams.get("refresh") === "1" ||
    searchParams.get("refresh") === "true";

  try {
    if (forceRefresh) {
      invalidatePartnerCaches(partner);
    }

    const key = cacheKey(partner, searchFilter);

    let contacts;
    let deals;
    let interestedResponses;
    let callData;
    let generatedAt;
    let totalCalls = 0;

    const cached = forceRefresh ? null : getCached(key);
    if (cached) {
      ({ contacts, deals, interestedResponses, callData, generatedAt } = cached);
    } else {
      [contacts, deals, interestedResponses, totalCalls] = await Promise.all([
        getPartnerContacts(partner, searchFilter || undefined),
        getPartnerDeals(partner, searchFilter || undefined),
        getInterestedCompanyCount(partner, searchFilter || undefined),
        getTotalOutboundCalls(partner, searchFilter || undefined),
      ]);
      callData = { total: totalCalls, connected: 0, calls: [] };
      generatedAt = new Date().toISOString();
      setCached(key, {
        contacts,
        deals,
        interestedResponses,
        callData,
        generatedAt,
      });
    }

    const searches = searchLocked
      ? getSearchNamesFromContacts(contacts)
      : await getPartnerSearchPillsList(partner);

    const metrics = computeMetrics(contacts, deals, callData, searchFilter, {
      start: startDate,
      end: endDate,
    }, interestedResponses);

    return Response.json({
      partner: label,
      partnerKey: partner,
      searches,
      searchFilter,
      searchLocked,
      dateFilter: { start: startDate, end: endDate },
      metrics,
      /** ISO time when HubSpot data for this view was last fetched (cache write time). */
      generatedAt,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return Response.json(
      { error: "Failed to load dashboard data", details: error.message },
      { status: 500 }
    );
  }
}
