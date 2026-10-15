# Pickpocket Match Log

Bo3 match tracker for the Orzhov Pickpocket Standard deck. Next.js 14 on
Vercel, with matches stored in a Notion database (same pattern as
hathcocked-recipes).

- Reads are public; adding or removing a match needs `TRACKER_PASSCODE`.
- Removing a match moves its Notion row to the trash, so it can be restored.
- You can also add or fix rows straight in Notion; the page reads whatever is there.

## Setup

1. **Notion integration.** At https://notion.so/my-integrations, use an
   existing internal integration or make a new one with Read, Update and
   Insert content. Open the **Pickpocket Match Log** database in Notion →
   `•••` → Connections → add the integration.
2. **Vercel.** Import this repo (Add New → Project). Under Environment
   Variables add:
   - `NOTION_TOKEN` — the integration's secret
   - `NOTION_DATA_SOURCE_ID` — `7a5da861-6c8f-46e4-89b9-16ef5eec2edc`
   - `TRACKER_PASSCODE` — anything you'll remember
3. Deploy. The page shows a banner until the Notion variables are set.

## Local dev

```bash
cp .env.local.example .env.local   # fill in the token and passcode
npm install
npm run dev
npm test                           # stats + Notion mapping tests
```

## Changing the deck

Edit `lib/deck.mjs`. The 75, sideboard guide, opponent list and dead-card
choices all come from there.
