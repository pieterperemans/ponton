# Ponton

Personal finance tracking for KBC (Belgium) customers. You drop in a statement export and the app does the rest: it categorises every transaction, learns from your corrections, and shows you what's worth acting on.

**Design goal: as little effort from you as possible.** Connect your KBC account once (PSD2), or do one CSV export a month. Then answer a short review list, which shrinks every month because each answer is remembered for that merchant.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser, rules and insights tests
npm run build    # static site in dist/ (works from any static host or file server)

npm run sync:mock   # live bank sync helper with a fake bank (demo)
npm run sync        # live bank sync helper for your real KBC account: see server/README.md
```

## How it works

| Step | What happens | Where |
|---|---|---|
| Live sync | Optional. A local helper (`server/ponton-sync.mjs`, no dependencies) connects to KBC through Enable Banking's free personal PSD2 tier. Ponton syncs when you open it, and pending card payments count towards budgets straight away. Bank and CSV data are merged without double counting. | `server/`, `src/lib/psd2.ts`, `merge.ts`, `sync.ts` |
| Import | Reads KBC CSV exports in Dutch, French or English. Columns are matched by header name, not position. Handles `;`, decimal commas, dd/mm/yyyy dates and Windows-1252 encoding. Overlapping exports are de-duplicated. | `src/lib/kbc.ts` |
| Categorise | 1. Transfers between your own accounts are marked internal. 2. Merchants you (or Claude) categorised before are applied from memory. 3. Built-in rules recognise common Belgian merchants (Colruyt, Proximus, NMBS…). 4. Only the remaining unknown merchants go to Claude, one entry per merchant. | `src/lib/pipeline.ts`, `rules.ts`, `ai.ts` |
| Review | Low-confidence guesses are grouped by merchant. One tap confirms or corrects all of a merchant's payments and teaches the app for future imports. | `src/views/Transactions.tsx` |
| Insights | Budget pace, projected from your usual end-of-month pattern rather than straight-line extrapolation. Also: category changes vs. your 3-month average, unusual payments, subscription price increases, recurring costs and savings rate. | `src/lib/insights.ts` |
| Budgets | Start automatically at the median of your last 3 months. Override any of them to turn it into a target. | `src/views/Budgets.tsx` |

## Privacy

- Without a bank connection there is no backend: data lives in the browser's IndexedDB. With one, the sync helper runs on your own computer and holds the Enable Banking key plus ~90 days of raw bank data (`server/data/`, git-ignored). Enable Banking, a licensed PSD2 provider, can see your transactions as it passes them on. Access is read-only.
- The Claude API key is stored in the browser's localStorage and sent only to `api.anthropic.com`.
- What goes to Claude: for each *unknown* merchant, its name, up to two example descriptions and a typical amount. That name can be a person you transfer money to. IBANs, card numbers and long reference numbers are removed before sending (`mask()` in `src/lib/ai.ts`). Balances and your own account details are never sent.
- Use Settings → Export backup now and then. Clearing your browser data deletes everything.

## Known limits

- The KBC column mapping is built from the documented export headers and has not yet been checked against a real export. If an import fails, the error message lists the headers it found.
- The Enable Banking integration has only been tested against a mock bank. The first real connection is the test.
- Only KBC is set up. Other Belgian banks work through Enable Banking by changing `aspsp` in `server/config.json`, but this is untested.
- KBC credit cards are not available through PSD2.
- Data stays in one browser on one device. There is no multi-device sync.
