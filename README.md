# MTG Standard Deck Stats Tracker

(Formerly Pickpocket Match Log. The Notion databases keep their original names.)

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
- **Start page** (`/`): pick a deck or add a new one. Each deck has its own
  page at `/decks/<id>`; old `/?deck=<id>` links redirect there.
- **Pre-test report**: on every deck page, computed from the decklist plus
  Scryfall card data (`lib/pretest.mjs`, cached for a week): curve, colored
  sources and Karsten-style casting odds, how each land enters, opening-hand
  land counts, removal count, and a check that each sideboard plan balances.
  It opens automatically for a new deck or one with no matches.
- **Synergy graph on every deck**: saving a deck without edges builds a
  first-pass graph from Scryfall card text (`lib/autoedges.mjs`: what each
  card produces and which cards pay it off), stored in Notion under an
  `# Auto-generated` header. A deck with no edges at all (typed into Notion)
  gets the same graph on its page. Claude's hourly review replaces
  auto-generated edges with a reviewed, rule-based set.
- **Plan profile**: what each card does for you and against the opponent
  on seven axes (life, poison, mill, instant win; cards, board, tempo),
  read from card text (`lib/axes.mjs`). It shows the deck's main win axis,
  which of its costs are fuel, how hard every other deck in the tracker
  pressures your life (worked out automatically), and whether each
  self-harm cost is worth paying in each matchup.
- **Claude's deck notes**: saving a new deck (or pressing *Ask Claude to
  re-check*) ticks *Analysis Requested* in Notion. An hourly Claude task in
  the project writes a pre-test review and synergy edges, then unticks it.
  A daily task reviews new matches. Both write the *Claude Review* field,
  which the app shows.

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

## Synergy graph

Each deck can carry a **Synergy Edges** list in Notion (also on the Add a deck
form), one per line:

```
Rank Rat -- Tinybones, Pocket Nuisance | discard pings
Ambrosia Whiteheart !! Sheltered by Ghosts | bounce frees their permanent
```

`--` is a synergy, `!!` a conflict. Only nonland main-deck cards count (lands
are recognized from the Standard pool in `lib/standard-lands.mjs`). The page
draws the graph and reports, in the same terms as the Claude project's Step 8
write-up: isolated cards, connected components (engines), cut vertices
(single points of failure, and which cards they strand), λ₂ (algebraic
connectivity), and the expected number of synergies with both cards seen by
turns 4 and 7 (hypergeometric, on the play). It joins per-card degree with the
dead-card flags from your matches. The math is in `lib/graph.mjs`, tested in
`lib/graph.test.mjs`.

## Installing on a phone

It's a progressive web app. On Android/Chrome, accept the install banner. On
iPhone, open it in Safari → Share → Add to Home Screen. Pages you've loaded
open offline; logging a match needs a connection.
