"use client";

import { useState, useEffect, useCallback } from "react";
import CallFunnel from "./CallFunnel";
import EmailChart from "./EmailChart";

export default function Dashboard({ token, partnerInfo, onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchFilter, setSearchFilter] = useState(null);

  const fetchDashboard = useCallback(async (search) => {
    setLoading(true);
    setError(null);

    try {
      const url = search
        ? `/api/dashboard?search=${encodeURIComponent(search)}`
        : "/api/dashboard";

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        onLogout();
        return;
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

      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchDashboard(searchFilter);
  }, [fetchDashboard, searchFilter]);

  if (loading && !data) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="loading" style={{ flexDirection: "column", gap: 8 }}>
        <div style={{ color: "var(--red)" }}>Error: {error}</div>
        <button onClick={() => fetchDashboard(searchFilter)} style={{
          padding: "8px 16px", border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius)", background: "#fff", cursor: "pointer",
          fontSize: 13
        }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { metrics, searches, partner, generatedAt } = data;
  const genDate = new Date(generatedAt);
  const dateStr = genDate.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const stageClass = (stage) => {
    if (stage.includes("Intro") || stage.includes("Partner Discussions")) return "intro";
    if (stage.includes("Prequalification") || stage.includes("Teaser")) return "qual";
    if (stage.includes("Closed Won")) return "intro";
    return "interested";
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-header-left">
          <h1>{partner}</h1>
          <span>Outbound activity report</span>
        </div>
        <div className="dash-header-right">
          <div>Data as of {dateStr}</div>
          {searches.length > 1 && (
            <div className="pills">
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
          {searches.length === 1 && (
            <div style={{ marginTop: 4, fontSize: 12 }}>Search: {searches[0]}</div>
          )}
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

      {/* Pipeline at a glance */}
      <div className="section-label">Pipeline at a glance</div>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label">Unique companies in pipeline</div>
          <div className="kpi-value" style={{ color: "var(--blue)" }}>
            {metrics.uniqueCompaniesInPipeline.toLocaleString()}
          </div>
          <div className="kpi-sub">Deduplicated across all lists</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Interested replies</div>
          <div className="kpi-value" style={{ color: "var(--green)" }}>
            {metrics.interestedReplies}
          </div>
          <div className="kpi-sub">Email + call interest</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total active deals</div>
          <div className="kpi-value" style={{ color: "var(--amber)" }}>
            {metrics.totalActiveDeals}
          </div>
          <div className="kpi-sub">Open pipeline only</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Teasers sent</div>
          <div className="kpi-value" style={{ color: "var(--amber)" }}>
            {metrics.teasersSent}
          </div>
          <div className="kpi-sub">All-time</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Introductions made</div>
          <div className="kpi-value" style={{ color: "var(--purple)" }}>
            {metrics.introductionsMade}
          </div>
          <div className="kpi-sub">All-time</div>
        </div>
      </div>

      {/* Email + Calling side by side */}
      <div className="card-row">
        <div className="card">
          <div className="card-title">Email outreach</div>
          <div className="kpi-grid kpi-grid-3" style={{ marginBottom: 14 }}>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Unique companies emailed</div>
              <div className="kpi-value sm">{metrics.uniqueCompaniesEmailed.toLocaleString()}</div>
            </div>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Interested replies</div>
              <div className="kpi-value sm" style={{ color: "var(--green)" }}>
                {metrics.interestedReplies}
              </div>
            </div>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Total contacts</div>
              <div className="kpi-value sm">{metrics.totalContacts.toLocaleString()}</div>
            </div>
          </div>
          <EmailChart contacts={metrics.totalContacts} interested={metrics.interestedReplies} />
        </div>

        <div className="card">
          <div className="card-title">Cold calling</div>
          <div className="kpi-grid kpi-grid-3" style={{ marginBottom: 14 }}>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Total calls made</div>
              <div className="kpi-value sm">{metrics.totalCalls.toLocaleString()}</div>
            </div>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Connected calls</div>
              <div className="kpi-value sm" style={{ color: "var(--green)" }}>
                {metrics.connectedCalls}
              </div>
            </div>
            <div className="kpi" style={{ padding: "0.5rem 0.75rem" }}>
              <div className="kpi-label">Interested from calls</div>
              <div className="kpi-value sm" style={{ color: "var(--green)" }}>
                {metrics.interestedFromCalls}
              </div>
            </div>
          </div>
          <CallFunnel
            total={metrics.totalCalls}
            connected={metrics.connectedCalls}
          />
        </div>
      </div>

      {/* Pipeline detail */}
      {metrics.pipelineDeals.length > 0 && (
        <>
          <div className="section-label">Pipeline progression</div>
          <div className="pipeline-card">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Search</th>
                  <th>Stage</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {metrics.pipelineDeals.map((deal) => (
                  <tr key={deal.id}>
                    <td className="company">{deal.name}</td>
                    <td className="muted">{deal.search}</td>
                    <td>
                      <span className={`status-badge ${stageClass(deal.stage)}`}>
                        {deal.stage}
                      </span>
                    </td>
                    <td className="muted">
                      {deal.created
                        ? new Date(deal.created).toLocaleDateString("en-US", {
                            month: "short", day: "numeric",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {metrics.pipelineDeals.length === 0 && (
        <div className="empty-state" style={{ marginTop: "1rem" }}>
          <h3>No active deals yet</h3>
          <p>Deals will appear here as prospects move through the pipeline.</p>
        </div>
      )}

      {/* Footer */}
      <div className="dash-footer">
        Data as of {dateStr} · Companies deduplicated by domain across all search lists · Prepared by Surfline Capital
        <div style={{ marginTop: 6 }}>
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
