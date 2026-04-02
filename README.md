<div align="center">

# ♚ Chess Advisor

### A free and open-source chess analysis tool

[**Live Demo**](https://yaswish.github.io/chess-advisor/) — [**Report Bug**](https://github.com/YasWish/chess-advisor/issues) — [**Request Feature**](https://github.com/YasWish/chess-advisor/issues)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/demo-live-brightgreen)](https://yaswish.github.io/chess-advisor/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Overview

Chess Advisor is a browser-based chess analysis tool that provides engine-accurate best move
recommendations for any position. It combines the [Lichess Cloud Evaluation](https://lichess.org/api#tag/Analysis)
database with a local [Stockfish](https://stockfishchess.org/) engine running via WebAssembly,
alongside [Syzygy endgame tablebases](https://syzygy-tables.info/) for perfect endgame play.

No server, no installation, no account required. Open the page and start analyzing.

## Features

**Engine Analysis** — Queries the Lichess cloud evaluation database for instant results,
with automatic fallback to a local Stockfish WASM engine running in a Web Worker.
Configurable search depth (8–30) and multi-PV (1, 3, or 5 candidate lines).

**Interactive Board** — Click-to-move and drag-and-drop with legal move highlighting,
last move tracking, check indication, pawn promotion dialog, and board flipping.
Full keyboard navigation with arrow keys for undo/redo.

**Play vs Engine** — Play against Stockfish at adjustable strength from Elo 400 to 3200.
Choose White, Black, or Random. The engine responds automatically using the local WASM worker.

**Endgame Tablebase** — Positions with 7 or fewer pieces are automatically looked up against
the Syzygy tablebase via the Lichess API, showing the theoretical outcome (win/draw/loss)
with distance-to-mate and the optimal move.

**Move Explanation** — A built-in analysis module explains the best move in plain English:
what the piece does, what threats it creates, why the alternatives are weaker, and the
expected continuation line.

**Opening Detection** — Automatically identifies and displays the opening name for common
positions including the Sicilian Defense, Ruy López, Italian Game, Queen's Gambit,
French Defense, Caro-Kann, and 20+ others.

**Blunder Detection** — Alerts when a move causes an evaluation swing of 1.5+ pawns.
Each candidate move is classified as Brilliant, Best, Great, Good, Inaccuracy, Mistake,
or Blunder based on centipawn loss.

**Import/Export** — Load any position via FEN string, import full games via PGN,
and export annotated PGN to clipboard.

## Quick Start

Chess Advisor is a single HTML file with no build step and no dependencies to install.

### Use Online

Open **https://yaswish.github.io/chess-advisor/** in any modern browser.

### Run Locally

```
git clone https://github.com/YasWish/chess-advisor.git
cd chess-advisor
```

Then open `index.html` in your browser. For full Web Worker support (local Stockfish),
serve it over HTTP:

```
python3 -m http.server 8000
# Open http://localhost:8000
```

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                 │
│                                                          │
│  ┌────────────────┐    ┌───────────────────────────────┐ │
│  │   Chessboard   │    │      Analysis Panel           │ │
│  │                │    │                               │ │
│  │  click / drag  │    │  eval · best move · top lines │ │
│  │  legal moves   │    │  move history · PV · classify │ │
│  │  arrows        │    │  blunder alerts               │ │
│  │                │    │                               │ │
│  │   chess.js     │    │      Explain · Play Engine    │ │
│  └────────────────┘    └───────────────────────────────┘ │
│           │                         │                    │
│           ▼                         ▼                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │             Analysis Layer                        │    │
│  │                                                   │    │
│  │  1. Lichess Cloud Eval API  (fast, pre-computed) │    │
│  │  2. Stockfish WASM Worker   (local fallback)     │    │
│  │  3. Syzygy Tablebase API    (≤7 piece endgames)  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

The analysis layer tries the Lichess cloud evaluation first. If the position is not in
their database (uncommon positions, deep variations), it falls back to running Stockfish
directly in the browser via WebAssembly in a dedicated Web Worker thread, keeping the
UI responsive during computation.

## Files

This distribution of Chess Advisor consists of the following files:

  * **README.md**, the file you are currently reading.
  * **index.html**, the complete application — board, engine integration, analysis UI,
    and all styling in a single self-contained file.
  * **LICENSE**, the MIT License under which this project is distributed.
  * **CONTRIBUTING.md**, guidelines for contributing to the project.

## External Libraries

| Library | Version | Purpose |
|---|---|---|
| [chess.js](https://github.com/jhlywa/chess.js) | 0.10.3 | Move validation, legal move generation, FEN/PGN parsing |
| [Stockfish.js](https://github.com/nicfab/stockfish.js) | 10.0.2 | Local engine analysis via WebAssembly (loaded on demand) |

Both libraries are loaded from public CDNs at runtime. No npm install required.

## APIs

| Service | Purpose | Auth |
|---|---|---|
| [Lichess Cloud Eval](https://lichess.org/api#tag/Analysis) | Pre-computed position evaluations | None |
| [Lichess Tablebase](https://tablebase.lichess.ovh) | Syzygy 7-piece endgame lookups | None |

## Browser Support

Chess Advisor runs in any modern browser with Web Worker and WebAssembly support.
This includes Chrome 80+, Firefox 78+, Safari 14+, Edge 80+, and their mobile variants.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting
a pull request. The project intentionally uses a single-file architecture with no build tools —
please maintain this simplicity.

Areas where help is especially appreciated:

  * SVG piece sets as an alternative to Unicode characters
  * Sound effects for moves, captures, and checks
  * Time controls for the Play vs Engine mode
  * Position sharing via URL hash encoding
  * Additional opening book coverage

## Terms of Use

Chess Advisor is free and distributed under the **MIT License**. You are free to use, modify,
and distribute it. See [LICENSE](LICENSE) for the full terms.

## Acknowledgments

  * [Stockfish](https://stockfishchess.org/) — the strongest open-source chess engine in the world
  * [Lichess](https://lichess.org/) — for their generous free cloud evaluation and tablebase APIs
  * [chess.js](https://github.com/jhlywa/chess.js) — chess logic library by Jeff Hlywa
