"use client";

export default function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Dashboard view toggle">
      {["dashboard", "leads"].map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          className={`view-toggle-btn ${value === id ? "active" : ""}`}
          onClick={() => onChange(id)}
          type="button"
        >
          {id === "dashboard" ? "Dashboard" : "Leads"}
        </button>
      ))}
    </div>
  );
}
