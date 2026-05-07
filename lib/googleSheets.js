import { google } from "googleapis";
import { canonicalSearchName } from "@/lib/searchNames";

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not set");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not valid JSON");
  }
}

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
  return config[partner] || null;
}

async function createSheetsClient() {
  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

function normalizeHeader(v) {
  return String(v || "").trim().toLowerCase();
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
  const sheetId = getDncSheetIdForPartner(partner);
  if (!sheetId) {
    throw new Error(`No DNC sheet configured for partner: ${partner}`);
  }
  const sheets = await createSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const firstSheetTitle = meta.data?.sheets?.[0]?.properties?.title;
  if (!firstSheetTitle) {
    throw new Error("Google Sheet has no tabs");
  }
  const range = `'${firstSheetTitle}'!A:Z`;
  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  const values = valuesRes.data.values || [];
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
