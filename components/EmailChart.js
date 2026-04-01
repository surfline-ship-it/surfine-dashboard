"use client";

export default function EmailChart({ contacts, interested }) {
  if (contacts === 0) {
    return (
      <div style={{
        textAlign: "center", padding: "1.5rem 0",
        color: "var(--gray-400)", fontSize: 13,
      }}>
        No email data available yet
      </div>
    );
  }

  // Visual bar showing proportion of interested out of total
  const pct = contacts > 0 ? ((interested / contacts) * 100).toFixed(1) : 0;

  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: 8, fontSize: 12, color: "var(--gray-500)",
      }}>
        <span>Response rate</span>
        <span style={{ fontWeight: 600, color: "var(--green)", fontSize: 16 }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        width: "100%", height: 8, background: "var(--gray-100)",
        borderRadius: 4, overflow: "hidden",
      }}>
        <div style={{
          width: `${Math.max(2, parseFloat(pct))}%`,
          height: "100%",
          background: "var(--green)",
          borderRadius: 4,
          transition: "width 0.5s ease",
        }} />
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 8, fontSize: 11, color: "var(--gray-400)",
      }}>
        <span>{contacts.toLocaleString()} companies contacted</span>
        <span>{interested} interested</span>
      </div>
    </div>
  );
}
