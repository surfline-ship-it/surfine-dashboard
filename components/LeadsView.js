"use client";

import { useEffect, useMemo, useState } from "react";
import LeadsTable from "./LeadsTable";

const PAGE_SIZE = 50;

function normalizeTier(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "Untiered";
  if (v.includes("tier 1") || v.includes(">5")) return "Tier 1 (>5M)";
  if (v.includes("tier 2") || v.includes("2-5")) return "Tier 2 (2-5M)";
  if (v.includes("tier 3") || v.includes("500")) return "Tier 3 (500k-2M)";
  return "Untiered";
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

export default function LeadsView({ leadsData, searchLocked, searchFilter, onSearchFilterChange }) {
  const [dncFilter, setDncFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortBy, setSortBy] = useState("companyName");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const leads = Array.isArray(leadsData?.leads) ? leadsData.leads : [];
  const filtered = useMemo(() => {
    let out = leads;
    if (searchFilter) {
      out = out.filter((r) => r.searchName === searchFilter);
    }
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
  }, [leads, searchFilter, dncFilter, tierFilter, stageFilter, debouncedQuery, sortBy, sortDir]);

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
          {leadsData.searches.map((s) => (
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
          <option value="Tier 1 (>5M)">Tier 1 (&gt;5M)</option>
          <option value="Tier 2 (2-5M)">Tier 2 (2-5M)</option>
          <option value="Tier 3 (500k-2M)">Tier 3 (500k-2M)</option>
          <option value="Untiered">Untiered</option>
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
