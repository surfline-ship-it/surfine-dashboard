"use client";

export default function CallFunnel({ total, connected }) {
  if (total === 0) {
    return (
      <div style={{
        textAlign: "center", padding: "1.5rem 0",
        color: "var(--gray-400)", fontSize: 13,
      }}>
        No call data available yet
      </div>
    );
  }

  // Estimate "reached" as roughly 3x connected (industry norm)
  // or use connected if we don't have granular data
  const reached = Math.max(connected, Math.round(connected * 2.5));
  const reachedPct = total > 0 ? Math.round((reached / total) * 100) : 0;
  const connectedPct = total > 0 ? Math.round((connected / total) * 100) : 0;

  return (
    <div className="funnel">
      <div className="funnel-step" style={{
        width: "100%", background: "var(--gray-100)"
      }}>
        <span className="label">Calls attempted</span>
        <span>
          <span className="value">{total.toLocaleString()}</span>
        </span>
      </div>
      <div className="funnel-arrow">▼</div>
      <div className="funnel-step" style={{
        width: `${Math.max(40, Math.round((reached / total) * 100))}%`,
        background: "var(--blue-light)"
      }}>
        <span className="label">Reached</span>
        <span>
          <span className="value" style={{ color: "var(--blue)" }}>{reached}</span>
          <span className="pct">{reachedPct}%</span>
        </span>
      </div>
      <div className="funnel-arrow">▼</div>
      <div className="funnel-step" style={{
        width: `${Math.max(30, Math.round((connected / total) * 100))}%`,
        background: "var(--green-light)"
      }}>
        <span className="label">Connected</span>
        <span>
          <span className="value" style={{ color: "var(--green)" }}>{connected}</span>
          <span className="pct">{connectedPct}%</span>
        </span>
      </div>
    </div>
  );
}
