import { verifyToken, resolveDataPartner } from "@/lib/auth";
import { canonicalSearchName } from "@/lib/searchNames";
import { readPartnerDncSheetRows, hasDncSheetForPartner } from "@/lib/googleSheets";
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
  const forceRefresh =
    searchParams.get("refresh") === "1" ||
    searchParams.get("refresh") === "true";

  try {
    const key = buildLeadsCacheKey(dataPartner, searchFilter);
    if (forceRefresh) {
      deleteCached(key);
      invalidatePartnerCaches(dataPartner);
      console.info("CACHE BUSTED", { scope: "leads", partner: dataPartner, key });
    }

    const cached = forceRefresh ? null : getCached(key);
    if (cached) {
      return Response.json(cached);
    }

    if (!hasDncSheetForPartner(dataPartner)) {
      const generatedAt = new Date().toISOString();
      return Response.json({
        partner: label,
        partnerKey: dataPartner,
        isAdmin: resolved.isAdmin,
        searchFilter,
        searchLocked,
        searches: [],
        generatedAt,
        leads: [],
        noDncSheet: true,
        noDncSheetMessage: "No DNC list configured for this partner.",
      });
    }

    const { rows } = await readPartnerDncSheetRows(dataPartner);
    const searches = Array.from(
      new Set(
        rows
          .map((r) => canonicalSearchName(r.searchName))
          .map((s) => String(s || "").trim())
          .filter(Boolean)
      )
    ).sort();

    const scopedRows = searchFilter
      ? rows.filter((r) => canonicalSearchName(r.searchName) === canonicalSearchName(searchFilter))
      : rows;

    const leads = scopedRows.map((r, idx) => {
      const dom = r.domain.toLowerCase();
      return {
        id: `${dom || "row"}-${idx}`,
        companyName: r.companyName,
        domain: dom,
        searchName: r.searchName,
        linkedinUrl: r.linkedinUrl,
        tier: r.tier,
        pipelineStage: "-",
        dncStatus: normalizeDncStatus(r.dncStatus),
        dateSentForDnc: r.dateSentForDnc,
        dateConfirmed: r.dateConfirmed,
        comments: "",
      };
    });

    const generatedAt = new Date().toISOString();
    const response = {
      partner: label,
      partnerKey: dataPartner,
      isAdmin: resolved.isAdmin,
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
