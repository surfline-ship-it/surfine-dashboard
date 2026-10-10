/**
 * Investor access codes checked into the repo.
 * `partner` must match the HubSpot `pepartner` value.
 * Env `PARTNER_CREDENTIALS` is merged on top and overrides the same access code.
 * The Surfline admin login (`partner: "ALL"`) stays in that env var.
 */
export const BUILTIN_PARTNER_CREDENTIALS = {
  "sc-trivest-257c90-1676": {
    partner: "Trivest",
    label: "Trivest Partners",
  },
  "sc-incline-bf1e4b-2056": {
    partner: "Incline",
    label: "Incline Equity Partners",
  },
  "sc-alpine-6cf07e-7767": {
    partner: "Alpine",
    label: "Alpine Investors",
  },
  "sc-trinity-hunt-c3b926-9718": {
    partner: "Trinity Hunt",
    label: "Trinity Hunt Partners",
  },
  "sc-mscp-abe59c-5609": {
    partner: "MSCP",
    label: "MSCP",
  },
  "sc-sole-source-e8047e-7493": {
    partner: "Sole Source",
    label: "Sole Source Capital",
  },
  "sc-shore-capital-77ee81-9066": {
    partner: "Shore Capital",
    label: "Shore Capital",
  },
};
