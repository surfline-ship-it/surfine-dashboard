import { verifyToken, resolveDataPartner } from "@/lib/auth";
import { canonicalSearchName } from "@/lib/searchNames";
import {
  getPartnerContacts,
  getPartnerDeals,
  getOutboundCallsForContacts,
  getSearchNamesFromContacts,
  computeMetrics,
} from "@/lib/hubspot";
import { readDashboardStatsRows, invalidateOutreachSheetCache } from "@/lib/googleSheets";
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
const CALLS_REFRESH_TTL_MS = 2 * 60 * 1000;

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

function normalizePartnerKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLooseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function keysLikelyMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function aggregateOutreachFromSummary(rows, partner, searchFilter) {
  const partnerKey = normalizePartnerKey(partner);
  const partnerLoose = normalizeLooseKey(partner);
  const canonicalFilter = searchFilter ? canonicalSearchName(searchFilter) : null;
  const allRows = Array.isArray(rows) ? rows : [];
  const filtered = allRows.filter((r) => {
    if (normalizePartnerKey(r.partner) !== partnerKey) return false;
    if (!canonicalFilter) return true;
    return canonicalSearchName(r.searchName) === canonicalFilter;
  });
  const fallbackFiltered =
    filtered.length > 0
      ? filtered
      : allRows.filter((r) => {
          const rowPartnerLoose = normalizeLooseKey(r.partner);
          if (!keysLikelyMatch(rowPartnerLoose, partnerLoose)) return false;
          if (!canonicalFilter) return true;
          const rowSearchLoose = normalizeLooseKey(canonicalSearchName(r.searchName));
          const filterLoose = normalizeLooseKey(canonicalFilter);
          return keysLikelyMatch(rowSearchLoose, filterLoose);
        });
  const usedFallback = filtered.length === 0 && fallbackFiltered.length > 0;
  if (usedFallback) {
    console.warn("Outreach stats used fallback matching", {
      partner,
      searchFilter: searchFilter || "all",
      fallbackMatchCount: fallbackFiltered.length,
    });
  }
  if (filtered.length === 0 && fallbackFiltered.length === 0 && allRows.length > 0) {
    const sheetPartners = Array.from(
      new Set(allRows.map((r) => String(r.partner || "").trim()).filter(Boolean))
    ).slice(0, 20);
    console.warn("Outreach stats matched zero rows", {
      partner,
      searchFilter: searchFilter || "all",
      sampleSheetPartners: sheetPartners,
    });
  }
  return fallbackFiltered.reduce(
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

  if (!process.env.GOOGLE_API_KEY) {
    return Response.json(
      {
        error: "Failed to load dashboard data",
        details:
          "GOOGLE_API_KEY is not set. Email outreach metrics require it in Vercel Project → Settings → Environment Variables.",
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
      invalidateOutreachSheetCache();
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
    let generatedAt;
    let callsGeneratedAt = null;
    let outreachMeta = { tab: null, layout: null, campaignRows: 0 };

    const cached = forceRefresh ? null : getCached(key);
    if (cached) {
      ({ contacts, deals, callData, generatedAt, callsGeneratedAt } = cached);
      console.info("Dashboard cache HIT", {
        key,
        cacheTimestamp: generatedAt,
        cacheMeta: getCacheMeta(key),
        dealsCount: Array.isArray(deals) ? deals.length : 0,
      });

      const callsAgeMs = callsGeneratedAt ? Date.now() - Date.parse(callsGeneratedAt) : Number.POSITIVE_INFINITY;
      const callsStale = !Number.isFinite(callsAgeMs) || callsAgeMs > CALLS_REFRESH_TTL_MS;
      if (callsStale) {
        try {
          callData = await getOutboundCallsForContacts((contacts || []).map((c) => c.id));
          callsGeneratedAt = new Date().toISOString();
          setCached(key, {
            contacts,
            deals,
            callData,
            generatedAt,
            callsGeneratedAt,
          });
          console.info("Cold calls refreshed from HubSpot", {
            key,
            callsGeneratedAt,
            callsAgeMs: Number.isFinite(callsAgeMs) ? callsAgeMs : null,
            totalCalls: callData?.total,
          });
        } catch (error) {
          console.warn("Cold calls refresh failed; using cached call stats", {
            partner: dataPartner,
            key,
            callsGeneratedAt,
            error: error?.message,
          });
        }
      }
    } else {
      const [contactsResult, dealsResult] = await Promise.all([
        getPartnerContacts(dataPartner, searchFilter || undefined),
        getPartnerDeals(dataPartner, searchFilter || undefined),
      ]);
      contacts = contactsResult;
      deals = dealsResult;
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
      callsGeneratedAt = generatedAt;
      setCached(key, {
        contacts,
        deals,
        callData,
        generatedAt,
        callsGeneratedAt,
      });
      console.info("Dashboard cache MISS (fresh HubSpot fetch)", {
        key,
        cacheTimestamp: generatedAt,
        dealsCount: Array.isArray(deals) ? deals.length : 0,
      });
    }

    // Always load outreach from Google Sheets (not cached with HubSpot — avoids stale zeros).
    let outreachStats = {
      totalContacts: 0,
      uniqueCompanies: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsReplied: 0,
    };
    try {
      const { rows: summaryRows, tab, layout } = await readDashboardStatsRows();
      outreachMeta = { tab, layout, campaignRows: summaryRows.length };
      outreachStats = aggregateOutreachFromSummary(summaryRows, dataPartner, searchFilter);
      console.info("Outreach stats from sheet", {
        partner: dataPartner,
        searchFilter: searchFilter || "all",
        tab,
        campaignRows: summaryRows.length,
        matched: outreachStats,
      });
    } catch (error) {
      console.error("Outreach sheet load failed", {
        partner: dataPartner,
        error: error?.message,
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
      outreachSource: outreachMeta,
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
