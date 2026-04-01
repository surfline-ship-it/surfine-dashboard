const HUBSPOT_BASE = "https://api.hubapi.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Generic CRM search with auto-pagination
async function searchAll(objectType, body, maxPages = 5) {
  let results = [];
  let after = undefined;

  for (let i = 0; i < maxPages; i++) {
    const payload = { ...body, limit: 100 };
    if (after) payload.after = after;

    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HubSpot search ${objectType} failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    results = results.concat(data.results || []);

    if (data.paging?.next?.after) {
      after = data.paging.next.after;
    } else {
      break;
    }
  }

  return results;
}

// Get contacts for a partner, optionally filtered by search_name
export async function getPartnerContacts(partner, searchName) {
  const filters = [
    { propertyName: "partner", operator: "EQ", value: partner },
  ];
  if (searchName) {
    filters.push({ propertyName: "search_name", operator: "EQ", value: searchName });
  }

  return searchAll("contacts", {
    filterGroups: [{ filters }],
    properties: [
      "firstname", "lastname", "company", "partner", "search_name",
      "campaign_source", "email", "hs_email_sends_since_last_engagement",
      "num_contacted_notes", "notes_last_contacted",
    ],
  }, 10); // up to 1000 contacts
}

// Get deals for a partner
export async function getPartnerDeals(partner, searchName) {
  const filters = [
    { propertyName: "pe_partner", operator: "EQ", value: partner },
  ];
  if (searchName) {
    filters.push({ propertyName: "search_name", operator: "EQ", value: searchName });
  }

  return searchAll("deals", {
    filterGroups: [{ filters }],
    properties: [
      "dealname", "dealstage", "pe_partner", "search_name",
      "hubspot_owner_id", "createdate", "notes_last_updated",
    ],
  });
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

  // Connected = disposition indicates a live conversation
  // HubSpot dispositions vary, but common connected values:
  const connectedDispositions = [
    "connected", "f240bbac-87c9-4f06-8571-b1093b7c3f95", // default "Connected" GUID
  ];

  const connected = outboundCalls.filter((c) => {
    const disp = (c.properties?.hs_call_disposition || "").toLowerCase();
    return connectedDispositions.some((d) => disp.includes(d));
  });

  return {
    total: outboundCalls.length,
    connected: connected.length,
    calls: outboundCalls,
  };
}

// Get distinct search names for a partner
export async function getPartnerSearches(partner) {
  const contacts = await getPartnerContacts(partner);
  const searches = new Set();
  contacts.forEach((c) => {
    if (c.properties?.search_name) searches.add(c.properties.search_name);
  });
  return Array.from(searches).sort();
}

// Deal stage mapping
export const DEAL_STAGES = {
  "3220310749": { label: "Prequalification Meeting", order: 1 },
  "3220310750": { label: "Teaser", order: 2 },
  "3220310751": { label: "Intro to Partner", order: 3 },
  "3220310752": { label: "Intro Meeting Held", order: 4 },
  "3253863102": { label: "Disqualified", order: -1 },
  "3253863103": { label: "Passed", order: -2 },
  "closedwon": { label: "Closed Won", order: 5 },
  "3253863104": { label: "Closed Lost", order: -3 },
};

// Aggregate dashboard metrics from raw data
export function computeMetrics(contacts, deals, callData, searchFilter) {
  // Filter contacts by search if needed
  const filtered = searchFilter
    ? contacts.filter((c) => c.properties?.search_name === searchFilter)
    : contacts;

  // Unique companies = deduplicated by company name (lowercase, trimmed)
  const companySet = new Set();
  filtered.forEach((c) => {
    const co = (c.properties?.company || "").toLowerCase().trim();
    if (co) companySet.add(co);
  });

  // Unique companies emailed = contacts with any email engagement
  const emailedCompanies = new Set();
  filtered.forEach((c) => {
    const co = (c.properties?.company || "").toLowerCase().trim();
    const contacted = parseInt(c.properties?.num_contacted_notes || "0");
    if (co && contacted > 0) emailedCompanies.add(co);
  });

  // Deal-based metrics
  const filteredDeals = searchFilter
    ? deals.filter((d) => d.properties?.search_name === searchFilter)
    : deals;

  // Interested replies = deals at Prequalification Meeting stage or beyond
  const interestedStages = ["3220310749", "3220310750", "3220310751", "3220310752", "closedwon"];
  const interested = filteredDeals.filter((d) =>
    interestedStages.includes(d.properties?.dealstage)
  );

  // Qualification calls held = deals at Prequalification Meeting + Disqualified (caught at qual stage)
  const qualStages = ["3220310749", "3220310750", "3220310751", "3220310752", "closedwon", "3253863102"];
  const qualCalls = filteredDeals.filter((d) =>
    qualStages.includes(d.properties?.dealstage)
  );

  // Introductions made = deals at Intro to Partner or later
  const introStages = ["3220310751", "3220310752", "closedwon"];
  const introductions = filteredDeals.filter((d) =>
    introStages.includes(d.properties?.dealstage)
  );

  // Pipeline detail = all non-Passed, non-Closed Lost deals
  const activeStages = ["3220310749", "3220310750", "3220310751", "3220310752", "closedwon"];
  const pipelineDeals = filteredDeals
    .filter((d) => activeStages.includes(d.properties?.dealstage))
    .map((d) => ({
      id: d.id,
      name: d.properties?.dealname || "Unknown",
      stage: DEAL_STAGES[d.properties?.dealstage]?.label || "Unknown",
      stageOrder: DEAL_STAGES[d.properties?.dealstage]?.order || 0,
      search: d.properties?.search_name || "",
      created: d.properties?.createdate || "",
    }))
    .sort((a, b) => b.stageOrder - a.stageOrder);

  return {
    uniqueCompaniesInPipeline: companySet.size,
    uniqueCompaniesEmailed: emailedCompanies.size || companySet.size, // fallback if no engagement data
    interestedReplies: interested.length,
    qualCallsHeld: qualCalls.length,
    introductionsMade: introductions.length,
    totalCalls: callData.total,
    connectedCalls: callData.connected,
    pipelineDeals,
    totalContacts: filtered.length,
  };
}
