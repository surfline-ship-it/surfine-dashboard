"use client";

import { useEffect, useMemo, useState } from "react";
import LeadsTable from "./LeadsTable";

const PAGE_SIZE = 50;

function normalizeTier(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "Tier 3";
  if (v.includes("top account") || v === "top" || v === "ta") return "Top Accounts";
  if (v.includes("tier 1") || v === "1" || v.includes(">5")) return "Tier 1";
  if (v.includes("tier 2") || v === "2" || v.includes("2-5")) return "Tier 2";
  if (v.includes("tier 3") || v === "3" || v.includes("500")) return "Tier 3";
  return "Tier 3";
}

function sortRows(rows, sortBy, sortDir) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = String(a?.[sortBy] || "").toLowerCase();
    const bv = String(b?.[sortBy] || "").toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export default function LeadsView({
  token,
  leadsData,
  searchLocked,
  searchFilter,
  onSearchFilterChange,
  apiSelectedPartner,
}) {
  const [dncFilter, setDncFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortBy, setSortBy] = useState("companyName");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [stageByLeadId, setStageByLeadId] = useState({});
  const [stagesLoading, setStagesLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const leads = Array.isArray(leadsData?.leads) ? leadsData.leads : [];
  const scopedBySearch = useMemo(() => {
    if (!searchFilter) return leads;
    return leads.filter((r) => String(r.searchName || "").trim() === String(searchFilter || "").trim());
  }, [leads, searchFilter]);

  useEffect(() => {
    let active = true;
    async function loadStages() {
      if (leadsData?.noDncSheet) {
        if (active) {
          setStageByLeadId({});
          setStagesLoading(false);
        }
        return;
      }
      // Render leads immediately; fill stages asynchronously.
      const payloadLeads = scopedBySearch.map((r) => ({
        id: r.id,
        companyName: r.companyName,
        domain: r.domain,
        searchName: r.searchName,
      }));
      if (payloadLeads.length === 0) {
        if (active) setStageByLeadId({});
        if (active) setStagesLoading(false);
        return;
      }
      if (active) setStagesLoading(true);
      try {
        const res = await fetch("/api/leads/stages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            leads: payloadLeads,
            ...(apiSelectedPartner ? { selectedPartner: apiSelectedPartner } : {}),
          }),
        });
        if (!res.ok) throw new Error("Failed to hydrate stages");
        const data = await res.json();
        if (active) setStageByLeadId(data?.stageByLeadId || {});
      } catch {
        // Graceful fallback: leave dashes in Pipeline Stage.
        if (active) setStageByLeadId({});
      } finally {
        if (active) setStagesLoading(false);
      }
    }
    loadStages();
    return () => {
      active = false;
    };
  }, [token, scopedBySearch, leadsData?.noDncSheet, apiSelectedPartner]);

  const filtered = useMemo(() => {
    let out = scopedBySearch.map((r) => ({
      ...r,
      tier: normalizeTier(r.tier),
      pipelineStage: stageByLeadId[r.id] || "-",
    }));
    if (dncFilter !== "all") {
      out = out.filter((r) => (dncFilter === "go" ? r.dncStatus !== "No Go" : r.dncStatus === "No Go"));
    }
    if (tierFilter !== "all") {
      out = out.filter((r) => normalizeTier(r.tier) === tierFilter);
    }
    if (stageFilter !== "all") {
      out = out.filter((r) => {
        if (stageFilter === "No Deal") return !r.pipelineStage;
        return r.pipelineStage === stageFilter;
      });
    }
    if (debouncedQuery) {
      out = out.filter((r) =>
        String(r.companyName || "").toLowerCase().includes(debouncedQuery) ||
        String(r.domain || "").toLowerCase().includes(debouncedQuery)
      );
    }
    return sortRows(out, sortBy, sortDir);
  }, [scopedBySearch, stageByLeadId, dncFilter, tierFilter, stageFilter, debouncedQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const goCount = filtered.filter((r) => r.dncStatus !== "No Go").length;
  const noGoCount = filtered.filter((r) => r.dncStatus === "No Go").length;
  const stageOptions = [
    "Engaged & In Pursuit",
    "Engaged - Longterm",
    "Qualification Call Booking",
    "Teaser Sent",
    "Partner Discussions",
    "Partner Discussions - Longterm",
    "Passed",
    "Closed Won",
    "No Deal",
  ];

  const onSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  if (leadsData?.noDncSheet) {
    return (
      <div className="leads-view">
        <div className="leads-no-dnc">
          {leadsData.noDncSheetMessage || "No DNC list configured for this partner."}
        </div>
      </div>
    );
  }

  return (
    <div className="leads-view">
      {!searchLocked && (leadsData?.searches?.length || 0) > 1 && (
        <div className="pills pills-left" style={{ marginBottom: 10 }}>
          <span
            className={`pill ${!searchFilter ? "active" : ""}`}
            onClick={() => {
              onSearchFilterChange(null);
              setPage(1);
            }}
          >
            All searches
          </span>
          {[...new Set((leadsData.searches || []).map((s) => String(s || "").trim()).filter(Boolean))].map((s) => (
            <span
              key={s}
              className={`pill ${searchFilter === s ? "active" : ""}`}
              onClick={() => {
                onSearchFilterChange(searchFilter === s ? null : s);
                setPage(1);
              }}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="leads-filters">
        <select value={dncFilter} onChange={(e) => { setDncFilter(e.target.value); setPage(1); }}>
          <option value="all">All DNC</option>
          <option value="go">Go only</option>
          <option value="no-go">No Go only</option>
        </select>
        <select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); setPage(1); }}>
          <option value="all">All tiers</option>
          <option value="Top Accounts">Top Accounts</option>
          <option value="Tier 1">Tier 1</option>
          <option value="Tier 2">Tier 2</option>
          <option value="Tier 3">Tier 3</option>
        </select>
        <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
          <option value="all">All stages</option>
          {stageOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Search company or domain"
        />
      </div>

      <div className="leads-stats">
        Showing {filtered.length.toLocaleString()} companies · {goCount.toLocaleString()} Go · {noGoCount.toLocaleString()} No Go
        {searchFilter ? ` · Filtered by: ${searchFilter}` : ""}
        {stagesLoading ? (
          <>
            {" · "}
            <span className="leads-stage-loading" aria-live="polite">
              <span className="spinner leads-stage-spinner" />
              Loading stages...
            </span>
          </>
        ) : ""}
      </div>

      <LeadsTable rows={pageRows} sortBy={sortBy} sortDir={sortDir} onSort={onSort} />

      <div className="leads-pagination">
        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1}>
          Prev
        </button>
        <span>Page {pageSafe} / {totalPages}</span>
        <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}
