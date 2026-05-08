"use client";

import { useState, useEffect, useCallback } from "react";
import { canonicalSearchName } from "@/lib/searchNames";
import ViewToggle from "./ViewToggle";
import LeadsView from "./LeadsView";

const SESSION_VIEW_KEY = "surfline_view_mode";

export default function Dashboard({ token, partnerInfo, onLogout }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [leadsData, setLeadsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchFilter, setSearchFilter] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [viewMode, setViewMode] = useState("dashboard");

  const searchLocked = Boolean(partnerInfo?.search);
  const lockedSearchName =
    typeof partnerInfo?.search === "string" && partnerInfo.search.trim()
      ? partnerInfo.search.trim()
      : null;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_VIEW_KEY);
      if (saved === "leads" || saved === "dashboard") setViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_VIEW_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  const fetchDashboard = useCallback(async (search, start, end, forceRefresh = false) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (forceRefresh) params.set("refresh", "1");
    const query = params.toString();
    const url = query ? `/api/dashboard?${query}` : "/api/dashboard";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      onLogout();
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      let message = "Failed to load dashboard";
      try {
        const err = JSON.parse(text);
        message = err.details
          ? `${err.error || "Error"}: ${err.details}`
          : err.error || message;
      } catch {
        message = text?.slice(0, 300) || `HTTP ${res.status}`;
      }
      throw new Error(message);
    }
    return res.json();
  }, [token, onLogout]);

  const fetchLeads = useCallback(async (search, forceRefresh = false) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (forceRefresh) params.set("refresh", "1");
    const query = params.toString();
    const url = query ? `/api/leads?${query}` : "/api/leads";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      onLogout();
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      let message = "Failed to load leads";
      try {
        const err = JSON.parse(text);
        message = err.details
          ? `${err.error || "Error"}: ${err.details}`
          : err.error || message;
      } catch {
        message = text?.slice(0, 300) || `HTTP ${res.status}`;
      }
      throw new Error(message);
    }
    return res.json();
  }, [token, onLogout]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const apiSearch = searchLocked ? null : searchFilter;
        const result = await fetchDashboard(apiSearch, startDate, endDate);
        if (active && result) setDashboardData(result);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [fetchDashboard, searchLocked, searchFilter, startDate, endDate]);

  useEffect(() => {
    if (viewMode !== "leads") return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const apiSearch = searchLocked ? null : searchFilter;
        const result = await fetchLeads(apiSearch, false);
        if (active && result) setLeadsData(result);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [viewMode, fetchLeads, searchLocked, searchFilter]);

  const onForceRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const apiSearch = searchLocked ? null : searchFilter;
      if (viewMode === "leads") {
        const result = await fetchLeads(apiSearch, true);
        if (result) setLeadsData(result);
      } else {
        const result = await fetchDashboard(apiSearch, startDate, endDate, true);
        if (result) setDashboardData(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const activeData = viewMode === "leads" ? leadsData : dashboardData;

  if (loading && !activeData) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading {viewMode}...
      </div>
    );
  }

  if (error && !activeData) {
    return (
      <div className="loading" style={{ flexDirection: "column", gap: 8 }}>
        <div style={{ color: "var(--red)" }}>Error: {error}</div>
        <button onClick={onForceRefresh} style={{
          padding: "8px 16px", border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius)", background: "#fff", cursor: "pointer",
          fontSize: 13
        }}>
          Retry
        </button>
      </div>
    );
  }

  if (!activeData) return null;

  const { metrics, partner, generatedAt } = dashboardData || activeData;
  const searches = leadsData?.searches || dashboardData?.searches || [];
  const dateFilter = dashboardData?.dateFilter || { start: null, end: null };
  const hasDateFilter = Boolean(dateFilter?.start || dateFilter?.end);
  const genDate = new Date(generatedAt);
  const dateStr = genDate.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const dateTimeStr = genDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div className="dash-header-left">
          <h1>{partner}</h1>
          {searchLocked && lockedSearchName ? (
            <div className="dash-subtitle">{canonicalSearchName(lockedSearchName)}</div>
          ) : null}
          {!searchLocked && searches.length === 1 ? (
            <div className="dash-subtitle">{searches[0]}</div>
          ) : null}
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {viewMode === "dashboard" && !searchLocked && searches.length > 1 && (
            <div className="pills pills-left">
              <span
                className={`pill ${!searchFilter ? "active" : ""}`}
                onClick={() => setSearchFilter(null)}
              >
                All searches
              </span>
              {searches.map((s) => (
                <span
                  key={s}
                  className={`pill ${searchFilter === s ? "active" : ""}`}
                  onClick={() => setSearchFilter(searchFilter === s ? null : s)}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="dash-header-right">
          <div>Data as of {dateStr}</div>
          {viewMode === "dashboard" ? (
            <>
              <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--gray-200)", borderRadius: 6 }}
                />
                <span style={{ fontSize: 12, color: "var(--gray-500)" }}>to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--gray-200)", borderRadius: 6 }}
                />
                {(startDate || endDate) && (
                  <button
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                    }}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      border: "1px solid var(--gray-200)",
                      borderRadius: 6,
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {hasDateFilter && (
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  Filtered: {dateFilter?.start || "Any"} to {dateFilter?.end || "Any"}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {loading && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          fontSize: 12, color: "var(--gray-500)"
        }}>
          <div className="spinner" style={{ width: 14, height: 14 }} />
          Refreshing...
        </div>
      )}

      {viewMode === "leads" ? (
        <LeadsView
          token={token}
          leadsData={leadsData}
          searchLocked={searchLocked}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
        />
      ) : (
        <>
          <div className="section-label">Overview</div>
          <div className="kpi-grid kpi-grid-deal-milestones">
            <div className="kpi">
              <div className="kpi-label">Teasers sent</div>
              <div className="kpi-value" style={{ color: "var(--amber)" }}>
                {metrics.teasersSent.toLocaleString()}
              </div>
              <div className="kpi-sub">Stage ≥ Teaser Sent, teaser_sent flag, or passed after teaser</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Introductions made</div>
              <div className="kpi-value" style={{ color: "var(--purple)" }}>
                {metrics.introductionsMade.toLocaleString()}
              </div>
              <div className="kpi-sub">Intro held+, intro completed, or passed after intro</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Total active deals</div>
              <div className="kpi-value" style={{ color: "var(--green)" }}>
                {metrics.totalActiveDeals.toLocaleString()}
              </div>
              <div className="kpi-sub">Intro Meeting Held, Partner Discussions, or Closed Won</div>
            </div>
          </div>

          <div className="section-label">Activity Report</div>
          <div className="card-row">
            <div className="card">
              <div className="card-title">Email outreach</div>
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
                <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
                  <div className="kpi-label">Unique companies in pipeline</div>
                  <div className="kpi-value sm" style={{ color: "var(--blue)" }}>
                    {metrics.uniqueCompaniesInPipeline.toLocaleString()}
                  </div>
                </div>
                <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
                  <div className="kpi-label">Unique companies emailed</div>
                  <div className="kpi-value sm">{metrics.uniqueCompaniesEmailed.toLocaleString()}</div>
                </div>
                <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
                  <div className="kpi-label">Total contacts</div>
                  <div className="kpi-value sm">{metrics.totalContacts.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Cold calling</div>
              <div className="kpi-grid" style={{ gridTemplateColumns: "1fr", marginBottom: 14 }}>
                <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
                  <div className="kpi-label">Total calls made</div>
                  <div className="kpi-value sm">{metrics.totalCalls.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="section-label">Pipeline progression</div>
          <div className="pipeline-card pipeline-progression">
            {(metrics.pipelineProgression || []).map((row) => (
              <div key={row.rowId} className={`pipeline-stage-block ${row.rowClass}`}>
                <div className="pipeline-stage-header">
                  <span className="pipeline-stage-title">{row.label}</span>
                  <span className="pipeline-stage-count">{row.count}</span>
                </div>
                {row.deals.length > 0 && (
                  <ul className="pipeline-deal-list">
                    {row.deals.map((d) => (
                      <li key={d.id} className="pipeline-deal-item">
                        {row.isPassedRow ? (
                          <details className="pipeline-passed-details">
                            <summary className="pipeline-deal-line">{d.displayLine}</summary>
                            {d.partnerPassedStage ? (
                              <div className="pipeline-deal-meta">Passed: {d.partnerPassedStage}</div>
                            ) : null}
                            {d.passedReason ? (
                              <div className="pipeline-deal-meta">Reason: {d.passedReason}</div>
                            ) : null}
                          </details>
                        ) : (
                          <div className="pipeline-deal-line">{d.displayLine}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="dash-footer">
        Data as of {dateTimeStr} (last {viewMode === "leads" ? "Google Sheet + HubSpot" : "HubSpot"} refresh for this view) · Companies deduplicated by domain across all search lists · Prepared by Surfline Capital
        <div className="dash-footer-actions">
          <button
            type="button"
            className="dash-footer-refresh"
            onClick={onForceRefresh}
            disabled={loading}
          >
            Force refresh
          </button>
          <span>·</span>
          <span
            onClick={onLogout}
            style={{ cursor: "pointer", textDecoration: "underline" }}
          >
            Sign out
          </span>
        </div>
      </div>
    </div>
  );
}
