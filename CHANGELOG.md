# Changelog

All notable changes to Chess Advisor are recorded here. The project follows
[semantic versioning](https://semver.org).

## 3.0.0 — 2026-09-24

A complete rewrite. Chess Advisor is now a React and TypeScript application built with Vite,
tested in a real browser on every change, and released under the GPL.

### Added

- Stockfish 19 (WebAssembly) replaces Stockfish 10, running in a Web Worker with a race-free
  UCI search queue, up to five lines, adjustable depth, win/draw/loss probabilities and
  instant results from the Lichess cloud database.
- Plain-English explanations of the best move: material won, forks, pins, skewers,
  discovered attacks, sacrifices and forced mates, plus threats and weaknesses in the position.
- Threat mode, showing what the opponent would play if it were their move.
- Full game review with eleven move grades, Lichess-method accuracy, average centipawn loss,
  an interactive evaluation graph, key moments, and deeper verification of apparent mistakes.
- Practise your mistakes: replay the positions where you went wrong and find a better move.
- Play against Stockfish at ten levels, with clocks, premoves, takebacks, hints and draw offers.
- A move tree with variations, comments, NAGs and clock times; promote and delete variations.
- PGN import and export (with optional engine annotations), FEN import, Lichess game links,
  recent games of any Lichess or Chess.com player, and shareable position and game links.
- Opening names for 3,800 positions from the Lichess openings database, recognised by
  position, and the named continuations from the current position.
- Syzygy tablebase results for positions with seven or fewer pieces.
- A board editor with castling rights, side to move and legality checking.
- Dark and light themes, six board colour schemes, six piece sets, figurine notation,
  synthesised sounds, spoken moves, keyboard shortcuts and a mobile layout.
- Offline support and installation as an app, autosave of the current game, and a strict
  Content Security Policy.
- Unit tests, an end-to-end browser test, continuous integration and automatic deployment
  to GitHub Pages.

### Changed

- The licence is now the GNU General Public License v3 or later, as required by the GPL
  components it is built on (Stockfish, chessground and chessops).

## 2.0.0

- Split the single-file prototype into separate HTML, CSS and JavaScript modules.

## 1.0.0

- First release: a single-page analysis board with Stockfish 10, Lichess cloud evaluations
  and template explanations.
