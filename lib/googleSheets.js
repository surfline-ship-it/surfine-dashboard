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

const OUTREACH_CAMPAIGNS_TAB = "All Campaigns - Instantly";
/** Trailing metric columns: Total Contacts, Unique Companies, Emails Sent, Emails Replied, Positive Reply */
const OUTREACH_METRIC_COLUMN_COUNT = 5;

function findOutreachCampaignsHeaderRow(values) {
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const normalized = row.map(normalizeHeader);
    if (
      normalized.includes("partner") &&
      normalized.includes("total contacts") &&
      normalized.includes("emails sent")
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Campaign rows may include extra label columns before metrics.
 * Metrics are always the last five numeric columns; internal search name is the
 * text cell immediately before that block.
 */
function toOutreachCampaignRow(row) {
  const cells = (Array.isArray(row) ? row : []).map((c) => String(c ?? "").trim());
  while (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }

  if (cells.length < OUTREACH_METRIC_COLUMN_COUNT + 2) return null;

  const partner = cells[0];
  if (!partner) return null;

  const metrics = cells.slice(-OUTREACH_METRIC_COLUMN_COUNT);
  if (metrics.some((v) => !String(v).trim())) return null;

  const searchNameRaw = cells[cells.length - OUTREACH_METRIC_COLUMN_COUNT - 1];
  const searchName = canonicalSearchName(searchNameRaw);
  if (!searchName) return null;

  const [
    totalContacts,
    uniqueCompanies,
    emailsSent,
    emailsReplied,
  ] = metrics.map(parseNumberLike);

  return {
    partner,
    searchName,
    totalContacts,
    uniqueCompanies,
    emailsSent,
    emailsOpened: 0,
    emailsReplied,
  };
}

export async function readDashboardStatsRows() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  const range = `${OUTREACH_CAMPAIGNS_TAB}!A1:Z200`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_SUMMARY_SHEET_ID}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets outreach campaigns API failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const values = Array.isArray(data.values) ? data.values : [];
  const headerRowIndex = findOutreachCampaignsHeaderRow(values);
  if (headerRowIndex < 0) {
    throw new Error(`Could not find ${OUTREACH_CAMPAIGNS_TAB} header row`);
  }

  const rows = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const parsed = toOutreachCampaignRow(values[i] || []);
    if (parsed) rows.push(parsed);
  }
  return { sheetId: DASHBOARD_SUMMARY_SHEET_ID, tab: OUTREACH_CAMPAIGNS_TAB, rows };
}
