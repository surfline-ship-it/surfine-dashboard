import { verifyToken, resolveDataPartner } from "@/lib/auth";
import { canonicalSearchName } from "@/lib/searchNames";
import {
  getPartnerContacts,
  getPartnerDeals,
  getOutboundCallsForContacts,
  getSearchNamesFromContacts,
  computeMetrics,
} from "@/lib/hubspot";
import { readDashboardStatsRows } from "@/lib/googleSheets";
import {
  getCached,
  getCacheMeta,
  deleteCached,
  setCached,
  invalidatePartnerCaches,
} from "@/lib/dashboardCache";

const CACHE_VERSION =
  process.env.CACHE_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "v1";

function cacheKey(partner, searchFilter, startDate, endDate) {
  const searchPart = searchFilter || "all";
  const startPart = startDate || "any";
  const endPart = endDate || "any";
  return `${CACHE_VERSION}::${partner}::${searchPart}::${startPart}::${endPart}`;
}

function searchPillsCacheKey(partner) {
  return `${CACHE_VERSION}::${partner}::__search_pills__`;
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

function aggregateOutreachFromSummary(rows, partner, searchFilter) {
  const canonicalFilter = searchFilter ? canonicalSearchName(searchFilter) : null;
  const filtered = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (String(r.partner || "").trim() !== String(partner || "").trim()) return false;
    if (!canonicalFilter) return true;
    return canonicalSearchName(r.searchName) === canonicalFilter;
  });
  return filtered.reduce(
    (acc, r) => {
      acc.totalContacts += Number(r.totalContacts || 0);
      acc.uniqueCompanies += Number(r.uniqueCompanies || 0);
      acc.emailsSent += Number(r.emailsSent || 0);
      acc.emailsOpened += Number(r.emailsOpened || 0);
      acc.emailsReplied += Number(r.emailsReplied || 0);
      return acc;
    },
    {
      totalContacts: 0,
      uniqueCompanies: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsReplied: 0,
    }
  );
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
  const selectedPartnerParam = searchParams.get("selectedPartner") || undefined;
  const resolved = resolveDataPartner(payload, selectedPartnerParam);
  if (resolved.error) {
    return Response.json(
      { error: resolved.isAdmin ? "Bad request" : "Invalid session", details: resolved.error },
      { status: resolved.isAdmin ? 400 : 401 }
    );
  }
  const dataPartner = resolved.dataPartner;
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
    const key = cacheKey(dataPartner, searchFilter, startDate, endDate);
    const pillsKey = searchPillsCacheKey(dataPartner);
    const metaBefore = getCacheMeta(key);

    if (forceRefresh) {
      const deletedCurrent = deleteCached(key);
      const deletedPills = deleteCached(pillsKey);
      invalidatePartnerCaches(dataPartner);
      console.info("CACHE BUSTED", {
        partner: dataPartner,
        key,
        deletedCurrent,
        deletedPills,
        metaBefore,
      });
    }

    let contacts;
    let deals;
    let callData;
    let outreachStats;
    let generatedAt;

    const cached = forceRefresh ? null : getCached(key);
    if (cached) {
      ({ contacts, deals, callData, outreachStats, generatedAt } = cached);
      console.info("Dashboard cache HIT", {
        key,
        cacheTimestamp: generatedAt,
        cacheMeta: getCacheMeta(key),
        dealsCount: Array.isArray(deals) ? deals.length : 0,
      });
    } else {
      const [{ rows: summaryRows }, contactsResult, dealsResult] = await Promise.all([
        readDashboardStatsRows().catch((error) => {
          console.warn("Dashboard Stats sheet fetch failed; defaulting outreach stats to zero", {
            partner: dataPartner,
            error: error?.message,
          });
          return { rows: [] };
        }),
        getPartnerContacts(dataPartner, searchFilter || undefined),
        getPartnerDeals(dataPartner, searchFilter || undefined),
      ]);
      contacts = contactsResult;
      deals = dealsResult;
      outreachStats = aggregateOutreachFromSummary(summaryRows, dataPartner, searchFilter);
      try {
        callData = await getOutboundCallsForContacts(contacts.map((c) => c.id));
      } catch (error) {
        console.warn("Cold calls fetch failed; continuing without calls metric", {
          partner: dataPartner,
          error: error?.message,
        });
        callData = { total: 0, connected: 0, calls: [], unavailable: true };
      }
      generatedAt = new Date().toISOString();
      setCached(key, {
        contacts,
        deals,
        callData,
        outreachStats,
        generatedAt,
      });
      console.info("Dashboard cache MISS (fresh HubSpot fetch)", {
        key,
        cacheTimestamp: generatedAt,
        dealsCount: Array.isArray(deals) ? deals.length : 0,
      });
    }

    const searches = searchLocked
      ? getSearchNamesFromContacts(contacts)
      : await getPartnerSearchPillsList(dataPartner);

    const metrics = computeMetrics(contacts, deals, callData, searchFilter, {
      start: startDate,
      end: endDate,
    }, outreachStats);

    return Response.json({
      partner: label,
      partnerKey: dataPartner,
      isAdmin: resolved.isAdmin,
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
