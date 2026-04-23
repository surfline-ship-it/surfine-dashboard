# Surfline Capital — Partner Dashboard

Live partner-facing dashboard pulling real-time data from HubSpot. Password-protected per partner.

## Architecture

```
Browser → Next.js (Vercel)
              ├── /api/auth        → validates partner password, returns JWT
              └── /api/dashboard   → queries HubSpot API, computes metrics, returns JSON
```

**Security model:** HubSpot API token lives server-side only (Vercel env vars). Partner passwords map to HubSpot `partner` property values. JWT sessions expire after 8 hours.

## GO Metrics (from Metric Spec v1.0)

| Metric | HubSpot Source |
|--------|---------------|
| Unique companies in pipeline | Contacts where `partner` = X → dedup by `company` |
| Unique companies emailed | Same set (contacts uploaded = contacts emailed) |
| Interested replies | Deals where `pe_partner` = X at stage ≥ Prequalification Meeting |
| Qualification calls held | Deals at Prequalification Meeting + Disqualified |
| Introductions made | Deals at Intro to Partner or later |
| Total calls made | Outbound call engagements associated to partner's contacts |
| Connected calls | Subset with "Connected" disposition |

## Setup

### 1. Create a HubSpot Private App

Go to **Settings → Integrations → Private Apps → Create a private app**.

Scopes needed:
- `crm.objects.contacts.read`
- `crm.objects.deals.read`
- `crm.objects.companies.read`

Copy the access token.

### 2. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
HUBSPOT_ACCESS_TOKEN=pat-na2-your-token-here

# Generate with: openssl rand -hex 32
JWT_SECRET=your-random-64-char-hex-string

# Partner passwords → partner config mapping
PARTNER_CREDENTIALS={"trivest2026":{"partner":"Trivest","label":"Trivest Partners"},"incline2026":{"partner":"Incline","label":"Incline Equity Partners"}}
```

### 3. Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and enter a partner password.

### 4. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add HUBSPOT_ACCESS_TOKEN
vercel env add JWT_SECRET
vercel env add PARTNER_CREDENTIALS

# Deploy to production
vercel --prod
```

## Adding a New Partner

1. Add their contacts to HubSpot with the `partner` property set (e.g., "NewPartner")
2. Add a password entry to `PARTNER_CREDENTIALS`:
   ```json
   {"newpartner2026":{"partner":"NewPartner","label":"New Partner Fund"}}
   ```
3. Redeploy (Vercel picks up env var changes on next deploy)

## Manual Upload Workflow (Pre-Clay Sync)

Until Clay is upgraded to push to HubSpot automatically:

1. Export campaign contacts from Clay/Instantly
2. Import to HubSpot via CSV import
3. Ensure each contact has:
   - `partner` = partner name (e.g., "Trivest")
   - `search_name` = search identifier (e.g., "Residential Fencing", "Access Control")
   - `company` = company name (used for dedup)
4. Dashboard will reflect the data on next page load

## Deal Stage Mapping

| Stage ID | Label | Dashboard Category |
|----------|-------|--------------------|
| 3220310749 | Prequalification Meeting | Interested + Qual Calls |
| 3220310750 | Teaser | Interested + Qual Calls |
| 3220310751 | Intro to Partner | Introductions |
| 3220310752 | Intro Meeting Held | Introductions |
| 3253863102 | Disqualified | Qual Calls (revenue DQ) |
| closedwon | Closed Won | Introductions |

## Rate Limits

HubSpot API rate limits: 100 requests per 10 seconds for private apps.

The call engagement lookup is the most API-intensive query (one request per contact for association lookups). For partners with 200+ contacts, the app caps call lookups at 200 contacts per dashboard load. For production scale, consider:
- Caching call data with a 15-minute TTL
- Pre-computing call metrics via a scheduled job
- Using HubSpot webhooks to maintain a local call count
# surfine-dashboard
