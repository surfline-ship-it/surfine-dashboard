"use client";

const BASE_COLUMNS = [
  { key: "companyName", label: "Company Name" },
  { key: "domain", label: "Domain" },
  { key: "searchName", label: "Search Name" },
  { key: "linkedinUrl", label: "LinkedIn" },
  { key: "tier", label: "Tier" },
  { key: "pipelineStage", label: "Pipeline Stage" },
  { key: "dncStatus", label: "DNC Status" },
  { key: "dateSentForDnc", label: "Date Sent for DNC" },
  { key: "dateConfirmed", label: "Date Confirmed" },
  { key: "comments", label: "Comments" },
];

export default function LeadsTable({ rows, sortBy, sortDir, onSort, showPartner = false }) {
  const COLUMNS = showPartner
    ? [
        BASE_COLUMNS[0],
        { key: "partner", label: "Partner" },
        ...BASE_COLUMNS.slice(1),
      ]
    : BASE_COLUMNS;

  const sortArrow = (key) => {
    if (sortBy !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  return (
    <div className="leads-table-wrap">
      <table className="leads-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.key === "companyName" ? "pinned-col" : ""}
                onClick={() => onSort(col.key)}
                role="button"
                tabIndex={0}
              >
                <span>{col.label}</span>
                <span className="sort-arrow">{sortArrow(col.key)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {COLUMNS.map((col) => {
                if (col.key === "companyName") {
                  return (
                    <td key={col.key} className="pinned-col">
                      {row.companyName || "—"}
                    </td>
                  );
                }
                if (col.key === "linkedinUrl") {
                  return (
                    <td key={col.key}>
                      {row.linkedinUrl ? (
                        <a href={row.linkedinUrl} target="_blank" rel="noreferrer" title={row.linkedinUrl}>
                          🔗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                }
                if (col.key === "dncStatus") {
                  return (
                    <td key={col.key}>
                      <button
                        type="button"
                        disabled
                        title="Editing coming soon."
                        className={`dnc-pill dnc-disabled ${row.dncStatus === "No Go" ? "no-go" : "go"}`}
                      >
                        {row.dncStatus || "Go"}
                      </button>
                    </td>
                  );
                }
                if (col.key === "comments") {
                  return (
                    <td key={col.key} className="comment-cell">
                      <input
                        type="text"
                        value={row.comments || ""}
                        readOnly
                        disabled
                        placeholder="—"
                        title="Editing coming soon."
                        className="comments-disabled-input"
                      />
                    </td>
                  );
                }
                return <td key={col.key}>{row[col.key] || "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
