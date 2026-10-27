# Regolith Index

A searchable index and dashboard of ~1,000 presentations from the Space Resources Roundtable (1999–2024).
It holds only titles, presenters and conference metadata. Every entry links out to the original on isruinfo.com or LPI/USRA, and no presentation files are hosted here.

It is independent and not affiliated with the Space Resources Roundtable, the Colorado School of Mines, LPI/USRA or isruinfo.com.

## Structure
- `index.html`: the whole front end (search, dashboard, browse, about). D3 is loaded from a CDN.
- `data/parts/*.txt`: the dataset, split into chunks. The build step `scripts/assemble-data.js` joins them into `data/index-data.json`.
- `scripts/build-data.js`: optional rebuild of the dataset from the public Google Sheet (`SHEET_ID`).
- `api/search.js`: server-side search. Rate-limited, and snippets are hard-capped at 300 characters in `api/_lib.js`.
- `api/sources.js`: "Find other public sources", using Claude with web search. It is off unless `ANTHROPIC_API_KEY` is set.
- `api/contact.js`: the corrections and takedown form, relayed via FormSubmit to `CONTACT_EMAIL`.
- `api/health.js`: liveness check.

## Environment variables (Vercel)
| Name | Required | Purpose |
|---|---|---|
| `CONTACT_EMAIL` | yes | Recipient of contact-form messages. Never exposed to the browser. |
| `ANTHROPIC_API_KEY` | no | Enables the source finder. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. |
| `SOURCES_DAILY_CAP` | no | Daily source-finder call cap, default 300. |

Deploys automatically on every push to `main`.
