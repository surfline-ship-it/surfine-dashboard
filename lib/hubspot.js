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
      "num_contacted_notes", "notes_last_contacted", "instantly_lead_status",
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
    if (c.properties?.search_name) searches.add(c.properties.search_name);
  });
  return Array.from(searches).sort();
}

// Get distinct search names for a partner (extra HubSpot search — prefer getSearchNamesFromContacts when you already have contacts)
export async function getPartnerSearches(partner) {
  const contacts = await getPartnerContacts(partner);
  return getSearchNamesFromContacts(contacts);
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
  const contactList = Array.isArray(contacts) ? contacts : [];
  const dealList = Array.isArray(deals) ? deals : [];
  const calls =
    callData && typeof callData === "object"
      ? callData
      : { total: 0, connected: 0, calls: [] };

  // Filter contacts by search if needed
  const filtered = searchFilter
    ? contactList.filter((c) => c.properties?.search_name === searchFilter)
    : contactList;

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
    ? dealList.filter((d) => d.properties?.search_name === searchFilter)
    : dealList;

  // Interested replies from contact-level property (Instantly reply classification)
  const interestedContacts = filtered.filter(
    (c) => c.properties?.instantly_lead_status === "Interested"
  );

  // Interested replies from deal pipeline (Prequalification Meeting stage or beyond)
  const interestedStages = ["3220310749", "3220310750", "3220310751", "3220310752", "closedwon"];
  const interestedDeals = filteredDeals.filter((d) =>
    interestedStages.includes(d.properties?.dealstage)
  );

  // Use the higher count — contacts catch replies before deals are created
  const interested = interestedContacts.length >= interestedDeals.length
    ? interestedContacts
    : interestedDeals;

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
    totalCalls: calls.total,
    connectedCalls: calls.connected,
    pipelineDeals,
    totalContacts: filtered.length,
  };
}
