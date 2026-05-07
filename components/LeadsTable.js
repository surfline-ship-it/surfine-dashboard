"use client";

const COLUMNS = [
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

export default function LeadsTable({ rows, sortBy, sortDir, onSort }) {
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
              <td className="pinned-col">{row.companyName || "—"}</td>
              <td>{row.domain || "—"}</td>
              <td>{row.searchName || "—"}</td>
              <td>
                {row.linkedinUrl ? (
                  <a href={row.linkedinUrl} target="_blank" rel="noreferrer" title={row.linkedinUrl}>
                    🔗
                  </a>
                ) : "—"}
              </td>
              <td>{row.tier || "—"}</td>
              <td>{row.pipelineStage || "—"}</td>
              <td>
                <button
                  type="button"
                  disabled
                  title="Editing coming soon."
                  className={`dnc-pill dnc-disabled ${row.dncStatus === "No Go" ? "no-go" : "go"}`}
                >
                  {row.dncStatus || "Go"}
                </button>
              </td>
              <td>{row.dateSentForDnc || "—"}</td>
              <td>{row.dateConfirmed || "—"}</td>
              <td className="comment-cell">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
