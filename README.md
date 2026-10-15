# Pickpocket Match Log

Bo3 match tracker for MTG decks under test. Next.js 14 on Vercel, with
decks and matches stored in two Notion databases (same pattern as
hathcocked-recipes).

- **Decks** (`Pickpocket Decks`): name, format, archetype, colors, the
  Arena-format main deck and sideboard, a sideboard guide, and a testing gate.
  Add one from **Add a deck** in the app, or as a row in Notion.
- **Matches** (`Pickpocket Match Log`): each match links to a deck. The
  opponent is a current meta deck, or **Not in meta** with a basic type
  (Aggro, Midrange, Control, Combo, Ramp, Tempo), colors and an optional name.
- **The meta list** is the options of the match log's *Opponent* select in
  Notion. Add, rename or reorder options there; the first five always show in
  the opponent table. Keep *Not in meta* as an option.
- **Claude's deck notes**: a daily Claude review reads new matches and writes
  adjustment notes into the deck's *Claude Review* field, which the app shows.

Reads are public; adding decks or matches, and removing matches, needs
`TRACKER_PASSCODE`. Removing a match moves its Notion row to the trash.

## Setup

1. **Notion integration.** At https://notion.so/my-integrations, use an
   existing internal integration or make a new one with Read, Update and
   Insert content. Open **Pickpocket Match Log** and **Pickpocket Decks** in
   Notion → `•••` → Connections → add the integration to each.
2. **Vercel.** Import this repo (Add New → Project) and add the variables
   from `.env.local.example`.
3. Deploy.

## Local dev

```bash
cp .env.local.example .env.local   # fill in the token and passcode
npm install
npm run dev
npm test                           # list parsing, stats and Notion mapping
```

## Sideboard guide format

One opponent per line, `Opponent | In | Out`. Put your two hardest matchups
first: the opponent table holds those two to a 35% bar instead of the
deck's gate win rate.
