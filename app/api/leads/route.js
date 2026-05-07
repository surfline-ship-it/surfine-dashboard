import { verifyToken } from "@/lib/auth";
import { canonicalSearchName } from "@/lib/searchNames";
import { readPartnerDncSheetRows } from "@/lib/googleSheets";
import {
  getPartnerContacts,
  getSearchNamesFromContacts,
  getCompanyCommentsAndStageByDomain,
} from "@/lib/hubspot";
import {
  getCached,
  setCached,
  deleteCached,
  invalidatePartnerCaches,
  buildLeadsCacheKey,
} from "@/lib/dashboardCache";

function normalizeDncStatus(raw) {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "no go" || val === "no") return "No Go";
  return "Go";
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

  if (!process.env.GOOGLE_API_KEY) {
    return Response.json(
      {
        error: "Failed to load leads",
        details:
          "GOOGLE_API_KEY is not set. Add it in Vercel Project → Settings → Environment Variables.",
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
  const forceRefresh =
    searchParams.get("refresh") === "1" ||
    searchParams.get("refresh") === "true";

  try {
    const key = buildLeadsCacheKey(partner, searchFilter);
    if (forceRefresh) {
      deleteCached(key);
      invalidatePartnerCaches(partner);
      console.info("CACHE BUSTED", { scope: "leads", partner, key });
    }

    const cached = forceRefresh ? null : getCached(key);
    if (cached) {
      return Response.json(cached);
    }

    const [{ rows }, contacts] = await Promise.all([
      readPartnerDncSheetRows(partner),
      getPartnerContacts(partner),
    ]);

    const sheetSearches = Array.from(new Set(rows.map((r) => r.searchName).filter(Boolean))).sort();
    const contactSearches = getSearchNamesFromContacts(contacts);
    const searches = Array.from(new Set([...sheetSearches, ...contactSearches])).sort();

    const scopedRows = searchFilter
      ? rows.filter((r) => canonicalSearchName(r.searchName) === canonicalSearchName(searchFilter))
      : rows;

    const domains = scopedRows.map((r) => r.domain).filter(Boolean);
    const hubspotByDomain = await getCompanyCommentsAndStageByDomain(
      partner,
      domains,
      searchFilter || undefined
    );

    const leads = scopedRows.map((r, idx) => {
      const dom = r.domain.toLowerCase();
      const hs = hubspotByDomain.get(dom);
      return {
        id: `${dom || "row"}-${idx}`,
        companyName: r.companyName,
        domain: dom,
        searchName: r.searchName,
        linkedinUrl: r.linkedinUrl,
        tier: r.tier,
        pipelineStage: hs?.pipelineStage || "",
        dncStatus: normalizeDncStatus(r.dncStatus),
        dateSentForDnc: r.dateSentForDnc,
        dateConfirmed: r.dateConfirmed,
        comments: hs?.comments || "",
      };
    });

    const generatedAt = new Date().toISOString();
    const response = {
      partner: label,
      partnerKey: partner,
      searchFilter,
      searchLocked,
      searches,
      generatedAt,
      leads,
    };
    setCached(key, response);
    return Response.json(response);
  } catch (error) {
    console.error("Leads error:", error);
    return Response.json(
      { error: "Failed to load leads", details: error.message },
      { status: 500 }
    );
  }
}
