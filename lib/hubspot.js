import {
  canonicalSearchName,
  searchNameHubSpotEquivalents,
} from "@/lib/searchNames";

const HUBSPOT_BASE = "https://api.hubapi.com";

/** Small gap between paginated search calls to stay under HubSpot's per-second limits */
const SEARCH_PAGE_GAP_MS = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/**
 * POST to CRM search with 429 retries (secondly / rate limits).
 */
async function searchPage(objectType, payload) {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      const waitMs = ra
        ? Math.min(parseInt(ra, 10) * 1000, 20000)
        : Math.min(400 * 2 ** attempt, 20000);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HubSpot search ${objectType} failed: ${res.status} ${err}`);
    }

    return res.json();
  }

  throw new Error(
    `HubSpot search ${objectType} failed: 429 rate limit after ${maxAttempts} retries`
  );
}

// Generic CRM search with auto-pagination
async function searchAll(objectType, body, maxPages = 5) {
  let results = [];
  let after = undefined;

  for (let i = 0; i < maxPages; i++) {
    const payload = { ...body, limit: 100 };
    if (after) payload.after = after;

    const data = await searchPage(objectType, payload);
    results = results.concat(data.results || []);

    if (data.paging?.next?.after) {
      after = data.paging.next.after;
      await sleep(SEARCH_PAGE_GAP_MS);
    } else {
      break;
    }
  }

  return results;
}

function contactPartnerSearchFilterGroups(partner, searchName) {
  const partnerEq = { propertyName: "partner", operator: "EQ", value: partner };
  if (!searchName) {
    return [{ filters: [partnerEq] }];
  }
  const values = searchNameHubSpotEquivalents(searchName);
  return values.map((v) => ({
    filters: [partnerEq, { propertyName: "search_name", operator: "EQ", value: v }],
  }));
}

function dealPartnerSearchFilterGroups(partner, searchName) {
  const partnerEq = { propertyName: "pe_partner", operator: "EQ", value: partner };
  if (!searchName) {
    return [{ filters: [partnerEq] }];
  }
  const values = searchNameHubSpotEquivalents(searchName);
  return values.map((v) => ({
    filters: [partnerEq, { propertyName: "search_name", operator: "EQ", value: v }],
  }));
}

function callPartnerSearchFilterGroups(partner, searchName) {
  const directionEq = { propertyName: "hs_call_direction", operator: "EQ", value: "OUTBOUND" };
  const partnerEq = { propertyName: "partner", operator: "EQ", value: partner };
  if (!searchName) {
    return [{ filters: [directionEq, partnerEq] }];
  }
  const values = searchNameHubSpotEquivalents(searchName);
  return values.map((v) => ({
    filters: [
      directionEq,
      partnerEq,
      { propertyName: "search_name", operator: "EQ", value: v },
    ],
  }));
}

// Get contacts for a partner, optionally filtered by search_name
export async function getPartnerContacts(partner, searchName) {
  return searchAll("contacts", {
    filterGroups: contactPartnerSearchFilterGroups(partner, searchName),
    properties: [
      "firstname",
      "lastname",
      "email",
      "company",
      "partner",
      "search_name",
      "campaign_source",
      "hs_email_sends_since_last_engagement",
      "num_contacted_notes",
      "notes_last_contacted",
      "instantly_lead_status",
      "hs_lead_status",
      "createdate",
    ],
  }, 10); // up to 1000 contacts
}

// Get deals for a partner
export async function getPartnerDeals(partner, searchName) {
  const properties = [
    "dealname", "dealstage", "pe_partner", "search_name",
    "hubspot_owner_id", "createdate", "notes_last_updated",
    "teaser_sent", "teaser_sent_date",
    "intro_meeting_status", "intro_meeting_date",
    "partner_passed_stage", "passed_reason",
  ];

  try {
    return await searchAll("deals", {
      filterGroups: dealPartnerSearchFilterGroups(partner, searchName),
      properties,
    });
  } catch (primaryError) {
    try {
      // HubSpot can reject OR filter payloads. Fall back to a simple partner filter.
      const deals = await searchAll("deals", {
        filterGroups: [{ filters: [{ propertyName: "pe_partner", operator: "EQ", value: partner }] }],
        properties,
      });
      if (!searchName) return deals;
      const canonical = canonicalSearchName(searchName);
      return deals.filter(
        (d) => canonicalSearchName(d.properties?.search_name) === canonical
      );
    } catch (secondaryError) {
      try {
        // Last-resort fallback: broad fetch (no filterGroups), then constrain in-app.
        // This prevents total dashboard failure if HubSpot rejects deal filter payloads.
        const broadDeals = await searchAll("deals", { properties }, 10);
        const byPartner = broadDeals.filter((d) => d.properties?.pe_partner === partner);
        if (!searchName) return byPartner;
        const canonical = canonicalSearchName(searchName);
        return byPartner.filter(
          (d) => canonicalSearchName(d.properties?.search_name) === canonical
        );
      } catch (tertiaryError) {
        console.error("getPartnerDeals failed across all fallbacks", {
          primary: primaryError?.message,
          secondary: secondaryError?.message,
          tertiary: tertiaryError?.message,
        });
        // Never hard-fail dashboard because of deal search errors.
        return [];
      }
    }
  }
}

export async function getTotalOutboundCalls(partner, searchName) {
  try {
    const calls = await searchAll("calls", {
      filterGroups: callPartnerSearchFilterGroups(partner, searchName),
      properties: ["hs_call_direction"],
    }, 10);
    return calls.length;
  } catch (e) {
    return 0;
  }
}

// Get call engagements for a list of contact IDs
export async function getCallsForContacts(contactIds) {
  if (!contactIds.length) return [];

  // HubSpot engagements search - batch by 100 contact IDs
  const allCalls = [];
  const batches = [];
  for (let i = 0; i < contactIds.length; i += 100) {
    batches.push(contactIds.slice(i, i + 100));
  }

  for (const batch of batches) {
    // Use associations search: calls associated with these contacts
    const calls = await searchAll("calls", {
      filterGroups: [{ filters: [] }],
      properties: [
        "hs_call_direction", "hs_call_disposition", "hs_call_status",
        "hs_call_duration", "hs_timestamp", "hs_call_title",
      ],
    }, 5);

    // Note: HubSpot search doesn't support filtering calls by associated contact IDs directly
    // in the search API. We'll use a different approach below.
    allCalls.push(...calls);
  }

  return allCalls;
}

// Get call engagements via the associations API (more reliable)
export async function getCallEngagements(contactIds) {
  if (!contactIds.length) return { total: 0, connected: 0, calls: [] };

  // Use the engagements v2 search endpoint filtered by type=CALL
  // and associated with the partner's contacts
  const allCalls = [];

  // Batch contacts in groups of 50 for association lookups
  const batches = [];
  for (let i = 0; i < contactIds.length; i += 50) {
    batches.push(contactIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    for (const contactId of batch) {
      try {
        const res = await fetch(
          `${HUBSPOT_BASE}/crm/v4/objects/contacts/${contactId}/associations/calls`,
          { headers: headers() }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const callIds = (data.results || []).map((r) => r.toObjectId);

        if (callIds.length > 0) {
          // Fetch call details in batches of 100
          for (let j = 0; j < callIds.length; j += 100) {
            const callBatch = callIds.slice(j, j + 100);
            const callRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/calls/batch/read`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({
                inputs: callBatch.map((id) => ({ id: String(id) })),
                properties: [
                  "hs_call_direction", "hs_call_disposition",
                  "hs_call_status", "hs_call_duration", "hs_timestamp",
                ],
              }),
            });
            if (callRes.ok) {
              const callData = await callRes.json();
              // Tag each call with its contact ID for dedup
              (callData.results || []).forEach((c) => {
                c._contactId = contactId;
                allCalls.push(c);
              });
            }
          }
        }
      } catch (e) {
        // Skip individual contact failures
        continue;
      }
    }
  }

  // Deduplicate calls by call ID (same call can be associated with multiple contacts)
  const seen = new Set();
  const uniqueCalls = allCalls.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Only count outbound calls
  const outboundCalls = uniqueCalls.filter(
    (c) => c.properties?.hs_call_direction === "OUTBOUND"
  );

  // Connected disposition GUID from HubSpot account 245305969
  // Full disposition map:
  //   f240bbac-87c9-4f6e-bf70-924b57d47db7 = Connected
  //   73a0d17f-1163-4015-bdd5-ec830791da20 = No answer
  //   17b47fee-58de-441e-a44c-c6300d46f273 = Wrong number
  //   a4c4c377-d246-4b32-a13b-75a56a4cd0ff = Left live message
  //   b2cf5968-551e-4856-9783-52b3da59a7d0 = Left voicemail
  //   9d9162e7-6cf3-4944-bf63-4dff82258764 = Busy
  const CONNECTED_GUID = "f240bbac-87c9-4f6e-bf70-924b57d47db7";

  const connected = outboundCalls.filter((c) => {
    return c.properties?.hs_call_disposition === CONNECTED_GUID;
  });

  return {
    total: outboundCalls.length,
    connected: connected.length,
    calls: outboundCalls,
  };
}

/** Distinct search_name values from an already-fetched contact list (avoids duplicate CRM searches). */
export function getSearchNamesFromContacts(contacts) {
  const searches = new Set();
  contacts.forEach((c) => {
    const raw = c.properties?.search_name;
    if (raw) searches.add(canonicalSearchName(raw));
  });
  return Array.from(searches).sort();
}

// Get distinct search names for a partner (extra HubSpot search — prefer getSearchNamesFromContacts when you already have contacts)
export async function getPartnerSearches(partner) {
  const contacts = await getPartnerContacts(partner);
  return getSearchNamesFromContacts(contacts);
}

function createInDateRange(dateFilter = null) {
  const startMs = dateFilter?.start ? Date.parse(dateFilter.start) : null;
  const endMsRaw = dateFilter?.end ? Date.parse(dateFilter.end) : null;
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw + (24 * 60 * 60 * 1000 - 1) : null;

  return (value) => {
    if (!startMs && !endMs) return true;
    const ts = Date.parse(value || "");
    if (!Number.isFinite(ts)) return false;
    if (startMs && ts < startMs) return false;
    if (endMs && ts > endMs) return false;
    return true;
  };
}

// Deal stage mapping
export const DEAL_STAGES = {
  // Investor Matching Pipeline (ordered)
  "3471208176": { label: "Re-Engage Lead", order: 1 },
  "3501326047": { label: "Deferred Interest", order: 2 },
  "3471208175": { label: "Pre-Qual Booking/Hunting Lead", order: 3 },
  "3220310749": { label: "Prequalification Meeting", order: 4 },
  "3471215350": { label: "Active Research", order: 5 },
  "3471215351": { label: "Partner Identified", order: 6 },
  "3220310750": { label: "Teaser Sent", order: 7 },
  "3220310751": { label: "Intro Booking/Intro to Partner", order: 8 },
  "3220310752": { label: "Intro Meeting Held", order: 9 },
  "3253863104": { label: "Partner Discussions", order: 10 },
  "3253863103": { label: "Passed", order: -1 },
  "closedwon": { label: "Closed Won", order: 11 },
  closedlost: { label: "Closed Lost", order: -2 },
};

/**
 * Pipeline UI: ordered rows — permanent rows always render (count may be 0);
 * transient rows render only when they have ≥1 deal.
 * Stages not on their own row roll into "Engaged & In Pursuit" so no deal is invisible.
 */
export const PIPELINE_PROGRESSION_ROW_ORDER = [
  {
    rowId: "engaged-in-pursuit",
    label: "Engaged & In Pursuit",
    /** Primary stages for this row + roll-ups for stages without their own row */
    matchStageIds: [
      "3471208175",
      "3471215350",
      "3471215351",
      "3471208176",
      "3501326047",
      "closedlost",
    ],
    rowClass: "pipeline-row-early",
    alwaysVisible: true,
  },
  {
    rowId: "qual-call-booking",
    label: "Qualification Call Booking",
    matchStageIds: ["3220310749"],
    rowClass: "pipeline-row-early",
    alwaysVisible: false,
  },
  {
    rowId: "teaser-sent",
    label: "Teaser Sent",
    matchStageIds: ["3220310750", "3220310751"],
    rowClass: "pipeline-row-mid",
    alwaysVisible: false,
  },
  {
    rowId: "partner-discussions",
    label: "Partner Discussions",
    matchStageIds: ["3220310752", "3253863104"],
    rowClass: "pipeline-row-late",
    alwaysVisible: true,
  },
  {
    rowId: "passed",
    label: "Passed",
    matchStageIds: ["3253863103"],
    rowClass: "pipeline-row-passed",
    alwaysVisible: true,
    isPassedRow: true,
  },
  {
    rowId: "closed-won",
    label: "Closed Won",
    matchStageIds: ["closedwon"],
    rowClass: "pipeline-row-won",
    alwaysVisible: true,
  },
];

function isTruthyBoolean(val) {
  if (val === true || val === "true" || val === "True" || val === "TRUE") return true;
  if (val === "yes" || val === "Yes" || val === "Y" || val === "1") return true;
  return false;
}

const STAGES_AT_OR_PAST_TEASER = [
  "3220310750",
  "3220310751",
  "3220310752",
  "3253863104",
  "3253863103",
  "closedwon",
];
const PARTNER_PASSED_AFTER_TEASER = [
  "After Teaser",
  "After Intro Meeting",
  "After IRL Analysis",
  "After LOI",
];

const STAGES_AT_OR_PAST_INTRO_HELD = ["3220310752", "3253863104", "3253863103", "closedwon"];
const PARTNER_PASSED_AFTER_INTRO = ["After Intro Meeting", "After IRL Analysis", "After LOI"];

const ACTIVE_DEAL_STAGES = ["3220310752", "3253863104", "closedwon"];

function qualifiesTeaserSent(deal) {
  const p = deal.properties || {};
  const ps = (p.partner_passed_stage || "").trim();
  if (isTruthyBoolean(p.teaser_sent)) return true;
  if (PARTNER_PASSED_AFTER_TEASER.includes(ps)) return true;
  const stage = p.dealstage;
  if (!STAGES_AT_OR_PAST_TEASER.includes(stage)) return false;
  if (stage === "3253863103") {
    return PARTNER_PASSED_AFTER_TEASER.includes(ps);
  }
  return true;
}

function qualifiesIntroMade(deal) {
  const p = deal.properties || {};
  const ps = (p.partner_passed_stage || "").trim();
  if (p.intro_meeting_status === "Completed") return true;
  if (PARTNER_PASSED_AFTER_INTRO.includes(ps)) return true;
  const stage = p.dealstage;
  if (!STAGES_AT_OR_PAST_INTRO_HELD.includes(stage)) return false;
  if (stage === "3253863103") {
    return PARTNER_PASSED_AFTER_INTRO.includes(ps);
  }
  return true;
}

function dealDisplayLine(d) {
  const p = d.properties || {};
  const company = p.dealname || "Unknown";
  const partnerName = p.pe_partner || "";
  const search = canonicalSearchName(p.search_name) || p.search_name || "";
  const mid = partnerName ? ` - ${partnerName}` : "";
  const tail = search ? ` · ${search}` : "";
  return `${company}${mid}${tail}`;
}

/** Lowercased email domain for deduping companies (requires a valid `@` address). */
export function emailDomainFromContact(contact) {
  const email = (contact?.properties?.email || "").trim();
  const at = email.lastIndexOf("@");
  if (at < 1 || at >= email.length - 1) return "";
  return email.slice(at + 1).toLowerCase();
}

function pipelineStageToRowId(stage) {
  const s = stage == null ? "" : String(stage).trim();
  if (!s) return "engaged-in-pursuit";
  if (s === "3220310749") return "qual-call-booking";
  if (s === "3220310750" || s === "3220310751") return "teaser-sent";
  if (s === "3220310752" || s === "3253863104") return "partner-discussions";
  if (s === "3253863103") return "passed";
  if (s === "closedwon") return "closed-won";
  const engagedRollup = new Set([
    "3471208175",
    "3471215350",
    "3471215351",
    "3471208176",
    "3501326047",
    "closedlost",
  ]);
  if (engagedRollup.has(s)) return "engaged-in-pursuit";
  return "engaged-in-pursuit";
}

function buildPipelineProgression(filteredDeals) {
  const list = Array.isArray(filteredDeals) ? filteredDeals : [];
  const buckets = {};
  PIPELINE_PROGRESSION_ROW_ORDER.forEach((def) => {
    buckets[def.rowId] = [];
  });

  list.forEach((d) => {
    const rowId = pipelineStageToRowId(d.properties?.dealstage);
    if (!buckets[rowId]) buckets["engaged-in-pursuit"].push(d);
    else buckets[rowId].push(d);
  });

  const dealPayload = (d) => ({
    id: d.id,
    displayLine: dealDisplayLine(d),
    partnerPassedStage: d.properties?.partner_passed_stage || "",
    passedReason: d.properties?.passed_reason || "",
  });

  const out = [];
  PIPELINE_PROGRESSION_ROW_ORDER.forEach((def) => {
    const deals = buckets[def.rowId] || [];
    const count = deals.length;
    if (!def.alwaysVisible && count === 0) return;
    out.push({
      rowId: def.rowId,
      label: def.label,
      rowClass: def.rowClass,
      isPassedRow: Boolean(def.isPassedRow),
      count,
      deals: deals.map(dealPayload),
    });
  });
  return out;
}

// Aggregate dashboard metrics from raw data
export function computeMetrics(
  contacts,
  deals,
  callData,
  searchFilter,
  dateFilter = null
) {
  const contactList = Array.isArray(contacts) ? contacts : [];
  const dealList = Array.isArray(deals) ? deals : [];
  const calls =
    callData && typeof callData === "object"
      ? callData
      : { total: 0, connected: 0, calls: [] };
  const callList = Array.isArray(calls.calls) ? calls.calls : [];

  const inDateRange = createInDateRange(dateFilter);

  // Filter contacts by search if needed (canonical match merges legacy HubSpot values)
  const bySearch = searchFilter
    ? contactList.filter(
        (c) =>
          canonicalSearchName(c.properties?.search_name) ===
          canonicalSearchName(searchFilter)
      )
    : contactList;
  const filtered = bySearch.filter((c) => inDateRange(c.properties?.createdate));

  // Unique companies = deduplicated by email domain (per partner / search scope)
  const pipelineDomains = new Set();
  filtered.forEach((c) => {
    const dom = emailDomainFromContact(c);
    if (dom) pipelineDomains.add(dom);
  });

  const emailedDomains = new Set();
  filtered.forEach((c) => {
    const dom = emailDomainFromContact(c);
    const contacted = parseInt(c.properties?.num_contacted_notes || "0", 10);
    if (dom && contacted > 0) emailedDomains.add(dom);
  });

  // Deal-based metrics
  const dealsBySearch = searchFilter
    ? dealList.filter(
        (d) =>
          canonicalSearchName(d.properties?.search_name) ===
          canonicalSearchName(searchFilter)
      )
    : dealList;
  const filteredDeals = dealsBySearch.filter((d) => inDateRange(d.properties?.createdate));

  const filteredCalls = callList.filter((c) => inDateRange(c.properties?.hs_timestamp));

  const interestedFromCallsDomains = new Set();
  filtered.forEach((c) => {
    if (c.properties?.hs_lead_status !== "interested") return;
    const dom = emailDomainFromContact(c);
    if (dom) interestedFromCallsDomains.add(dom);
  });

  // Headline deal metrics (cumulative vs current-state per product spec)
  const teasersSentDeals = filteredDeals.filter(qualifiesTeaserSent);
  const introductionsMadeDeals = filteredDeals.filter(qualifiesIntroMade);
  const activeDealsNow = filteredDeals.filter((d) =>
    ACTIVE_DEAL_STAGES.includes(d.properties?.dealstage)
  );

  const pipelineProgression = buildPipelineProgression(filteredDeals);

  return {
    uniqueCompaniesInPipeline: pipelineDomains.size,
    uniqueCompaniesEmailed: emailedDomains.size,
    interestedFromCalls: interestedFromCallsDomains.size,
    teasersSent: teasersSentDeals.length,
    introductionsMade: introductionsMadeDeals.length,
    totalActiveDeals: activeDealsNow.length,
    totalCalls: Number.isFinite(calls.total) ? calls.total : filteredCalls.length,
    connectedCalls: Number.isFinite(calls.connected) ? calls.connected : filteredCalls.filter(
      (c) => c.properties?.hs_call_disposition === "f240bbac-87c9-4f6e-bf70-924b57d47db7"
    ).length,
    pipelineProgression,
    totalContacts: filtered.length,
  };
}
