import { canonicalSearchName } from "@/lib/searchNames";
import { getCached, setCached, deleteCached } from "@/lib/dashboardCache";

const DASHBOARD_SUMMARY_SHEET_ID = "11AKMhaKyf0bUsFLRZ6LrU-uvi4Ag3W9w08MHA9lqJ9k";

function getDncSheetConfig() {
  const raw = process.env.DNC_SHEET_CONFIG || "{}";
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("DNC_SHEET_CONFIG is not valid JSON");
  }
}

export function getDncSheetIdForPartner(partner) {
  const config = getDncSheetConfig();
  if (config[partner]) return config[partner];
  return null;
}

/** True when `DNC_SHEET_CONFIG` includes a sheet id for this partner key. */
export function hasDncSheetForPartner(partner) {
  return Boolean(getDncSheetIdForPartner(partner));
}

function normalizeHeader(v) {
  return String(v || "").trim().toLowerCase();
}

function parseNumberLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findHeaderRow(values) {
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const normalized = row.map(normalizeHeader);
    if (normalized.includes("search name") && normalized.includes("company name")) {
      return i;
    }
  }
  return -1;
}

function toLeadRow(row, headerMap) {
  const get = (name) => {
    const idx = headerMap.get(name);
    return idx == null ? "" : String(row[idx] || "").trim();
  };
  const searchName = canonicalSearchName(get("search name"));
  const companyName = get("company name");
  const domain = get("domain").toLowerCase();
  if (!companyName && !domain) return null;
  return {
    searchName,
    companyName,
    domain,
    linkedinUrl: get("company linkedin url"),
    tier: get("tier"),
    dateSentForDnc: get("date sent for dnc"),
    dncStatus: get("dnc status") || "Go",
    dateConfirmed: get("date confirmed"),
  };
}

export async function readPartnerDncSheetRows(partner) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  const sheetId = getDncSheetIdForPartner(partner);
  if (!sheetId) {
    throw new Error(`No DNC sheet configured for partner: ${partner}`);
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:H5000?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets API failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const values = Array.isArray(data.values) ? data.values : [];
  const headerRowIndex = findHeaderRow(values);
  if (headerRowIndex < 0) {
    throw new Error("Could not find header row (Search Name / Company Name) in DNC sheet");
  }

  const headers = values[headerRowIndex].map(normalizeHeader);
  const headerMap = new Map();
  headers.forEach((h, idx) => {
    if (h) headerMap.set(h, idx);
  });

  const rows = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const parsed = toLeadRow(values[i] || [], headerMap);
    if (parsed) rows.push(parsed);
  }
  return { sheetId, rows };
}

/** Tab gid from sheet URL (All Campaigns - Instantly). */
const OUTREACH_CAMPAIGNS_GID = 10926545;
const OUTREACH_SHEET_CACHE_KEY = "__outreach_instantly_sheet_v3__";
/** Trailing metric columns on wide campaign rows (includes Positive Reply). */
const OUTREACH_METRIC_COLUMN_COUNT = 5;

function getGoogleApiKey() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  return apiKey;
}

function buildHeaderMap(headerRow) {
  const headerMap = new Map();
  (headerRow || []).map(normalizeHeader).forEach((h, idx) => {
    if (h) headerMap.set(h, idx);
  });
  return headerMap;
}

/** Campaign-level Instantly tab (wide rows, Internal Search Name column). */
function findCampaignOutreachHeaderRow(values) {
  for (let i = 0; i < values.length; i++) {
    const normalized = (values[i] || []).map(normalizeHeader);
    const hasPartner = normalized.includes("partner");
    const hasContacts = normalized.includes("total contacts");
    const hasCampaignSearch =
      normalized.includes("internal search name") ||
      normalized.includes("instantly search name");
    if (hasPartner && hasContacts && hasCampaignSearch) {
      return i;
    }
  }
  return -1;
}

/** Legacy summary tab (narrow rows: Partner + Search Name + metrics). */
function findLegacyOutreachHeaderRow(values) {
  for (let i = 0; i < values.length; i++) {
    const normalized = (values[i] || []).map(normalizeHeader);
    if (
      normalized.includes("partner") &&
      normalized.includes("search name") &&
      normalized.includes("total contacts") &&
      !normalized.includes("internal search name")
    ) {
      return i;
    }
  }
  return -1;
}

function headerColumnCount(headerMap) {
  let max = 0;
  headerMap.forEach((idx) => {
    if (idx > max) max = idx;
  });
  return max + 1;
}

function pickSearchName(row, headerMap, layout) {
  const cells = (Array.isArray(row) ? row : []).map((c) => String(c ?? "").trim());
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();

  const headerWidth = headerColumnCount(headerMap);
  if (
    layout === "campaign" &&
    cells.length > headerWidth + 1 &&
    cells.length >= OUTREACH_METRIC_COLUMN_COUNT + 2
  ) {
    const fromWide = canonicalSearchName(
      cells[cells.length - OUTREACH_METRIC_COLUMN_COUNT - 1]
    );
    if (fromWide) return fromWide;
  }

  const get = (key) => {
    const idx = headerMap.get(key);
    return idx == null ? "" : String(row[idx] || "").trim();
  };
  const fromInternal = canonicalSearchName(get("internal search name"));
  if (fromInternal) return fromInternal;
  const fromSearch = canonicalSearchName(get("search name"));
  if (fromSearch) return fromSearch;

  if (cells.length < OUTREACH_METRIC_COLUMN_COUNT + 2) return "";
  return canonicalSearchName(cells[cells.length - OUTREACH_METRIC_COLUMN_COUNT - 1]);
}

function toOutreachCampaignRow(row, headerMap, layout) {
  const cells = (Array.isArray(row) ? row : []).map((c) => String(c ?? "").trim());
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  if (cells.length < 3) return null;

  const get = (key) => {
    const idx = headerMap.get(key);
    return idx == null ? "" : String(row[idx] || "").trim();
  };

  const partner = get("partner") || cells[0];
  if (!partner) return null;

  const searchName = pickSearchName(row, headerMap, layout);
  if (!searchName) return null;

  const headerWidth = headerColumnCount(headerMap);
  const useWideMetrics =
    layout === "campaign" && cells.length > headerWidth + 1;

  if (useWideMetrics) {
    if (cells.length < OUTREACH_METRIC_COLUMN_COUNT + 2) return null;
    const metrics = cells.slice(-OUTREACH_METRIC_COLUMN_COUNT);
    return {
      partner,
      searchName,
      totalContacts: parseNumberLike(metrics[0]),
      uniqueCompanies: parseNumberLike(metrics[1]),
      emailsSent: parseNumberLike(metrics[2]),
      emailsOpened: 0,
      emailsReplied: parseNumberLike(metrics[3]),
    };
  }

  return {
    partner,
    searchName,
    totalContacts: parseNumberLike(get("total contacts")),
    uniqueCompanies: parseNumberLike(get("unique companies")),
    emailsSent: parseNumberLike(get("emails sent")),
    emailsOpened: parseNumberLike(get("emails opened")),
    emailsReplied: parseNumberLike(get("emails replied")),
  };
}

function parseOutreachValues(values) {
  let headerRowIndex = findCampaignOutreachHeaderRow(values);
  let layout = "campaign";
  if (headerRowIndex < 0) {
    headerRowIndex = findLegacyOutreachHeaderRow(values);
    layout = "legacy";
  }
  if (headerRowIndex < 0) return { rows: [], headerRowIndex: -1, layout: null };

  const headerMap = buildHeaderMap(values[headerRowIndex]);
  const rows = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const parsed = toOutreachCampaignRow(values[i] || [], headerMap, layout);
    if (parsed) rows.push(parsed);
  }
  return { rows, headerRowIndex, layout };
}

function sheetRangeA1(tabTitle, range = "A1:Z500") {
  const escaped = String(tabTitle).replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

async function fetchSheetValues(apiKey, tabTitle, range = "A1:Z500") {
  const rangeA1 = sheetRangeA1(tabTitle, range);
  const params = new URLSearchParams({ key: apiKey });
  params.append("ranges", rangeA1);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_SUMMARY_SHEET_ID}/values:batchGet?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets tab "${tabTitle}" failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const values = data?.valueRanges?.[0]?.values;
  return Array.isArray(values) ? values : [];
}

async function listSpreadsheetTabs(apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_SUMMARY_SHEET_ID}?fields=sheets.properties&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets metadata failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  return (data.sheets || []).map((s) => s.properties).filter(Boolean);
}

function buildOutreachTabCandidates(tabProperties) {
  const props = tabProperties || [];
  const titles = props.map((t) => String(t.title || "").trim()).filter(Boolean);
  const titleSet = new Set(titles);
  const out = [];
  const push = (title) => {
    const t = String(title || "").trim();
    if (t && titleSet.has(t) && !out.includes(t)) out.push(t);
  };

  const byGid = props.find((t) => Number(t.sheetId) === OUTREACH_CAMPAIGNS_GID);
  if (byGid?.title) out.push(byGid.title);

  push(process.env.OUTREACH_CAMPAIGNS_TAB?.trim());

  for (const t of props) {
    if (/instantly|campaign/i.test(String(t.title || ""))) push(t.title);
  }

  for (const title of titles) {
    if (title !== "Dashboard Stats") push(title);
  }
  push("Dashboard Stats");

  return out;
}

function evaluateOutreachSheet(tab, values) {
  const { rows, headerRowIndex, layout } = parseOutreachValues(values);
  if (headerRowIndex < 0) return null;
  const metricSum = rows.reduce((s, r) => s + r.totalContacts, 0);
  const rank =
    layout === "campaign" && metricSum > 0
      ? 1000 + metricSum
      : layout === "campaign"
        ? 500 + rows.length
        : metricSum > 0
          ? 100 + metricSum
          : rows.length;
  return { tab, layout, rows, metricSum, rank };
}

async function loadOutreachCampaignData(apiKey) {
  const tabProperties = await listSpreadsheetTabs(apiKey);
  console.info("Outreach spreadsheet tabs", {
    tabs: tabProperties.map((t) => ({ sheetId: t.sheetId, title: t.title })),
    targetGid: OUTREACH_CAMPAIGNS_GID,
  });
  const candidates = buildOutreachTabCandidates(tabProperties);

  let best = null;
  for (const title of candidates) {
    try {
      const values = await fetchSheetValues(apiKey, title);
      const evaluated = evaluateOutreachSheet(title, values);
      if (!evaluated) continue;
      if (!best || evaluated.rank > best.rank) best = evaluated;
      if (evaluated.layout === "campaign" && evaluated.metricSum > 0) {
        break;
      }
    } catch (error) {
      console.warn("Outreach tab fetch failed", {
        title,
        error: error?.message,
      });
    }
  }

  if (!best) {
    throw new Error(
      `Could not load outreach data from spreadsheet (tried: ${candidates.join(", ")})`
    );
  }

  if (best.rows.length === 0) {
    console.warn("Outreach tab parsed zero campaign rows", {
      tab: best.tab,
      layout: best.layout,
    });
  }

  return {
    sheetId: DASHBOARD_SUMMARY_SHEET_ID,
    tab: best.tab,
    layout: best.layout,
    rows: best.rows,
  };
}

export function invalidateOutreachSheetCache() {
  deleteCached(OUTREACH_SHEET_CACHE_KEY);
}

export async function readDashboardStatsRows() {
  const apiKey = getGoogleApiKey();
  const cached = getCached(OUTREACH_SHEET_CACHE_KEY);
  if (cached) return cached;

  const payload = await loadOutreachCampaignData(apiKey);
  setCached(OUTREACH_SHEET_CACHE_KEY, payload);
  return payload;
}
