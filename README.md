# ♚ Chess Advisor

A browser-based chess analysis tool powered by **Stockfish** and the **Lichess Cloud Eval API**. Get engine-accurate best move recommendations, play against Stockfish at any strength, and understand positions with AI-powered explanations.

**No server required** — everything runs in your browser.

![Chess Advisor Screenshot](docs/screenshot.png)

---

## Features

### 🔍 Engine Analysis
- **Lichess Cloud Eval** (default) — instant analysis from Lichess's pre-computed database
- **Local Stockfish WASM** (fallback) — runs Stockfish entirely in your browser via Web Worker
- **Multi-PV** — view the top 1, 3, or 5 candidate moves ranked by evaluation
- **Configurable depth** — set search depth from 8 to 40
- **Visual arrows** — best move displayed as a green arrow on the board
- **Eval bar** — real-time evaluation bar (like Chess.com/Lichess)

### ♟ Interactive Board
- **Click-to-move** with legal move highlighting (dots and rings)
- **Drag & drop** pieces with floating ghost
- **Check highlighting** — king square turns red when in check
- **Last move highlighting** — see which squares were involved
- **Board flip** — play from either side
- **Pawn promotion** — visual piece picker dialog

### 🎮 Play vs Engine
- Adjustable Elo from **400 to 3200**
- Choose White, Black, or Random
- Engine responds automatically using local Stockfish WASM
- Skill level maps to Stockfish's internal Skill Level parameter

### 📖 Opening Book
- Automatically detects and displays the opening name as you play
- Covers 30+ common openings (Sicilian, Ruy López, Italian, Queen's Gambit, French, Caro-Kann, and more)

### ⊞ Endgame Tablebase
- For positions with **≤7 pieces**, queries the **Syzygy tablebase** via Lichess API
- Shows theoretical outcome (Win/Draw/Loss) with distance-to-mate
- Displays the tablebase-optimal move

### 💡 AI Move Explanation
- Uses the **Claude API** to explain why the best move is strongest
- Plain-English strategic and tactical reasoning
- Accessible via the "Explain" tab

### 📋 Import / Export
- **FEN input** — load any position instantly
- **PGN import** — paste a full game to replay and analyze
- **PGN export** — save your game with headers, copy to clipboard

### 🎯 Blunder Detection
- Alerts when evaluation swings by ≥1.5 pawns after a move
- Move classification labels: Brilliant, Best, Great, Good, OK, Inaccuracy, Mistake, Blunder

### ⌨ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `←` | Undo move |
| `→` | Redo move |
| `Escape` | Close modals |

---

## Quick Start

### Option 1: Just Open It (Easiest)

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/chess-advisor.git

# Open in browser
open index.html
# or
xdg-open index.html    # Linux
start index.html        # Windows
```

That's it. No build step, no npm install, no server. Just open `index.html`.

### Option 2: Serve Locally (Recommended for WASM)

Some browsers restrict Web Workers when opened via `file://`. Use a local server:

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .

# Then open http://localhost:8000
```

### Option 3: Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **main branch**, root folder
4. Your app will be live at `https://YOUR_USERNAME.github.io/chess-advisor/`

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────┐
│  Browser (Single HTML File)             │
│                                         │
│  ┌──────────┐  ┌─────────────────────┐  │
│  │  Board UI │  │  Analysis Panel     │  │
│  │  (Canvas) │  │  - Eval score       │  │
│  │           │  │  - Best move        │  │
│  │  chess.js │  │  - Top lines        │  │
│  │  (logic)  │  │  - Move history     │  │
│  └──────────┘  └─────────────────────┘  │
│       │                │                 │
│       ▼                ▼                 │
│  ┌─────────────────────────────────┐    │
│  │      Analysis Engine Layer      │    │
│  │  1. Lichess Cloud API (fast)    │    │
│  │  2. Stockfish WASM (fallback)   │    │
│  │  3. Tablebase API (endgames)    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### External Dependencies (loaded via CDN)

| Library | Purpose | CDN |
|---------|---------|-----|
| `chess.js` v0.10.3 | Move validation, legal moves, PGN/FEN parsing | cdnjs |
| `stockfish.js` v10.0.2 | Local engine analysis (Web Worker) | jsDelivr |

### APIs Used

| API | Purpose | Auth Required |
|-----|---------|---------------|
| [Lichess Cloud Eval](https://lichess.org/api#tag/Analysis) | Pre-computed position evaluations | No |
| [Lichess Tablebase](https://tablebase.lichess.ovh) | Syzygy endgame tablebase lookups | No |
| [Anthropic Claude API](https://docs.anthropic.com) | Move explanations in plain English | Yes (API key) |

> **Note:** The Claude API integration works automatically within Claude.ai artifacts. For standalone deployment, you'll need to add your own API key handling.

---

## Project Structure

```
chess-advisor/
├── index.html          # The entire application (single file)
├── README.md           # This file
├── LICENSE             # MIT License
├── .gitignore          # Git ignore rules
└── docs/
    └── screenshot.png  # App screenshot for README
```

### Why a Single HTML File?

This project intentionally uses a **single-file architecture**:

- **Zero build step** — no webpack, vite, or npm needed
- **Instant deployment** — drag and drop to any static host
- **Easy to fork and modify** — everything in one place
- **Works offline** — once loaded (except API calls)
- **GitHub Pages ready** — push and deploy

---

## Configuration

### Engine Settings

Settings are adjustable in the UI:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Depth | 20 | 8–40 | Search depth (higher = stronger but slower) |
| Lines | 3 | 1/3/5 | Number of candidate moves to show |

### Play vs Engine

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Elo | 1500 | 400–3200 | Engine playing strength |
| Color | White | W/B/Random | Side you play as |

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 80+ | ✅ Full support |
| Firefox 78+ | ✅ Full support |
| Safari 14+ | ✅ Full support |
| Edge 80+ | ✅ Full support |
| Mobile Chrome | ✅ Works (responsive) |
| Mobile Safari | ✅ Works (responsive) |

> Web Workers and WASM are required for local Stockfish. All modern browsers support these.

---

## Contributing

Contributions are welcome! Some ideas for improvement:

- [ ] Piece images (SVG) instead of Unicode characters
- [ ] Sound effects for moves, captures, checks
- [ ] Game database integration (search by position)
- [ ] Multi-game analysis (batch import)
- [ ] Drill mode (replay blunders and find correct moves)
- [ ] Dark/light theme toggle
- [ ] Time controls for vs-engine games
- [ ] Share analysis via URL (encode position in hash)

### Development

Since this is a single HTML file, development is straightforward:

1. Fork the repo
2. Edit `index.html`
3. Open in browser to test
4. Submit a PR

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Credits

- [chess.js](https://github.com/jhlywa/chess.js) — Chess logic library by Jeff Hlywa
- [Stockfish](https://stockfishchess.org/) — World's strongest open-source chess engine
- [Lichess](https://lichess.org/) — Cloud eval API and tablebase API
- [Anthropic Claude](https://www.anthropic.com/) — AI move explanations

---

Built with ♟ by a chess enthusiast. No more back rank mates.
