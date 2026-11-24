# Ponton

Personal finance tracking for KBC (Belgium) customers. You drop in a statement export and the app does the rest: it categorises every transaction, learns from your corrections, and shows you what's worth acting on.

**Design goal: as little effort from you as possible.** You do one CSV export a month and answer a short review list. The list shrinks every month because each answer is remembered for that merchant.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser, rules and insights tests
npm run build    # static site in dist/ (works from any static host or file server)
```

## How it works

| Step | What happens | Where |
|---|---|---|
| Import | Reads KBC CSV exports in Dutch, French or English. Columns are matched by header name, not position. Handles `;`, decimal commas, dd/mm/yyyy dates and Windows-1252 encoding. Overlapping exports are de-duplicated. | `src/lib/kbc.ts` |
| Categorise | 1. Transfers between your own accounts are marked internal. 2. Merchants you (or Claude) categorised before are applied from memory. 3. Built-in rules recognise common Belgian merchants (Colruyt, Proximus, NMBS…). 4. Only the remaining unknown merchants go to Claude, one entry per merchant. | `src/lib/pipeline.ts`, `rules.ts`, `ai.ts` |
| Review | Low-confidence guesses are grouped by merchant. One tap confirms or corrects all of a merchant's payments and teaches the app for future imports. | `src/views/Transactions.tsx` |
| Insights | Budget pace, projected from your usual end-of-month pattern rather than straight-line extrapolation. Also: category changes vs. your 3-month average, unusual payments, subscription price increases, recurring costs and savings rate. | `src/lib/insights.ts` |
| Budgets | Start automatically at the median of your last 3 months. Override any of them to turn it into a target. | `src/views/Budgets.tsx` |

## Privacy

- There is no backend. Data lives in the browser's IndexedDB.
- The Claude API key is stored in the browser's localStorage and sent only to `api.anthropic.com`.
- What goes to Claude: for each *unknown* merchant, its name, up to two example descriptions and a typical amount. That name can be a person you transfer money to. IBANs, card numbers and long reference numbers are removed before sending (`mask()` in `src/lib/ai.ts`). Balances and your own account details are never sent.
- Use Settings → Export backup now and then. Clearing your browser data deletes everything.

## Known limits

- The KBC column mapping is built from the documented export headers and has not yet been checked against a real export. If an import fails, the error message lists the headers it found.
- Only KBC CSV is supported. PDF statements and other banks are not.
- Data stays in one browser on one device. There is no sync.
