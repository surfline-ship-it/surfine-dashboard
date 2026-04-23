import { verifyToken } from "@/lib/auth";
import {
  getPartnerContacts,
  getPartnerDeals,
  getInterestedCompanyCount,
  getTotalOutboundCalls,
  getSearchNamesFromContacts,
  computeMetrics,
} from "@/lib/hubspot";

const CACHE_TTL_MS = 15 * 60 * 1000;
const dashboardCache =
  globalThis.__surflineDashboardCache || new Map();
globalThis.__surflineDashboardCache = dashboardCache;

function cacheKey(partner, searchFilter) {
  return `${partner}::${searchFilter || "all"}`;
}

function searchPillsCacheKey(partner) {
  return `${partner}::__search_pills__`;
}

async function getPartnerSearchPillsList(partner, now) {
  const pillsKey = searchPillsCacheKey(partner);
  const hit = dashboardCache.get(pillsKey);
  if (hit && hit.expiresAt > now) return hit.searches;
  const allContacts = await getPartnerContacts(partner);
  const searches = getSearchNamesFromContacts(allContacts);
  dashboardCache.set(pillsKey, { expiresAt: now + CACHE_TTL_MS, searches });
  return searches;
}

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
    const key = cacheKey(partner, searchFilter);
    const now = Date.now();
    const cached = dashboardCache.get(key);

    let contacts;
    let deals;
    let interestedResponses;
    let callData;
    let generatedAt;
    let totalCalls = 0;

    if (cached && cached.expiresAt > now) {
      ({ contacts, deals, interestedResponses, callData, generatedAt } = cached.data);
    } else {
      [contacts, deals, interestedResponses, totalCalls] = await Promise.all([
        getPartnerContacts(partner, searchFilter || undefined),
        getPartnerDeals(partner, searchFilter || undefined),
        getInterestedCompanyCount(partner, searchFilter || undefined),
        getTotalOutboundCalls(partner, searchFilter || undefined),
      ]);
      callData = { total: totalCalls, connected: 0, calls: [] };
      generatedAt = new Date().toISOString();
      dashboardCache.set(key, {
        expiresAt: now + CACHE_TTL_MS,
        data: { contacts, deals, interestedResponses, callData, generatedAt },
      });
    }

    const searches = searchLocked
      ? getSearchNamesFromContacts(contacts)
      : await getPartnerSearchPillsList(partner, now);

    // Compute metrics
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
