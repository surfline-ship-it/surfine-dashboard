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

  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 13, color: "var(--gray-500)",
      }}>
        <span>{contacts.toLocaleString()} companies contacted</span>
        <span style={{ color: "var(--green)", fontWeight: 600 }}>{interested} interested</span>
      </div>
    </div>
  );
}
