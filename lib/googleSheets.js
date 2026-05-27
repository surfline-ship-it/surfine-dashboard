import { canonicalSearchName } from "@/lib/searchNames";

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
const OUTREACH_TAB_CANDIDATES = [
  "All Campaigns - Instantly",
  "All Instantly Leads",
];
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

function scoreOutreachTab(values) {
  const campaignHeader = findCampaignOutreachHeaderRow(values);
  if (campaignHeader >= 0) {
    const { rows } = parseOutreachValues(values);
    const metricSum = rows.reduce((s, r) => s + r.totalContacts, 0);
    return 1000 + rows.length + Math.min(metricSum, 500);
  }
  const legacyHeader = findLegacyOutreachHeaderRow(values);
  if (legacyHeader >= 0) {
    const { rows } = parseOutreachValues(values);
    const metricSum = rows.reduce((s, r) => s + r.totalContacts, 0);
    return 100 + rows.length + Math.min(metricSum, 100);
  }
  return -1;
}

async function fetchSheetValues(apiKey, tabTitle, range = "A1:Z500") {
  const rangeA1 = `'${tabTitle.replace(/'/g, "''")}'!${range}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_SUMMARY_SHEET_ID}/values/${encodeURIComponent(rangeA1)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets tab "${tabTitle}" failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data.values) ? data.values : [];
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

async function resolveOutreachTabTitle(apiKey) {
  const envTab = process.env.OUTREACH_CAMPAIGNS_TAB?.trim();
  if (envTab) return envTab;

  const tabs = await listSpreadsheetTabs(apiKey);
  const byGid = tabs.find((t) => Number(t.sheetId) === OUTREACH_CAMPAIGNS_GID);

  const candidates = [
    "All Campaigns - Instantly",
    byGid?.title,
    ...OUTREACH_TAB_CANDIDATES,
    ...tabs.map((t) => t.title).filter(Boolean),
  ];

  const seen = new Set();
  let bestTitle = null;
  let bestScore = -1;

  for (const title of candidates) {
    if (!title || seen.has(title)) continue;
    seen.add(title);
    try {
      const values = await fetchSheetValues(apiKey, title);
      const score = scoreOutreachTab(values);
      if (score > bestScore) {
        bestScore = score;
        bestTitle = title;
      }
    } catch {
      continue;
    }
  }

  if (bestTitle) return bestTitle;
  throw new Error("Could not find outreach campaigns tab in spreadsheet");
}

export async function readDashboardStatsRows() {
  const apiKey = getGoogleApiKey();
  const tab = await resolveOutreachTabTitle(apiKey);
  const values = await fetchSheetValues(apiKey, tab);
  const { rows, headerRowIndex, layout } = parseOutreachValues(values);
  if (headerRowIndex < 0) {
    throw new Error(`Could not find outreach header row in tab "${tab}"`);
  }
  if (rows.length === 0) {
    console.warn("Outreach tab parsed zero campaign rows", { tab, layout, valueRows: values.length });
  }
  return { sheetId: DASHBOARD_SUMMARY_SHEET_ID, tab, layout, rows };
}
