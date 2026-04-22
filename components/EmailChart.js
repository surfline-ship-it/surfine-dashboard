"use client";

export default function EmailChart({ uniqueCompanies, interestedCompanies }) {
  if (!uniqueCompanies) {
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
        <span>{uniqueCompanies.toLocaleString()} unique companies (by domain)</span>
        <span style={{ color: "var(--green)", fontWeight: 600 }}>
          {interestedCompanies.toLocaleString()} interested
        </span>
      </div>
    </div>
  );
}
