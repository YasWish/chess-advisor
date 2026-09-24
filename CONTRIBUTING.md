# Contributing to Chess Advisor

Thank you for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting problems

Open an [issue](https://github.com/YasWish/chess-advisor/issues/new/choose) and include the
position or game if the problem involves one: in the app, **Share → Copy FEN** or
**Copy PGN** gives you exactly what is needed to reproduce it. Security problems should be
reported privately; see [SECURITY.md](SECURITY.md).

## Setting up

You need Node.js 22 or newer.

```sh
git clone https://github.com/YasWish/chess-advisor.git
cd chess-advisor
npm ci
npm run dev
```

## Before you open a pull request

Please run the same checks as the continuous integration:

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run build && npm run e2e
```

`npm run e2e` needs Chrome or Chromium; set `CHROME_PATH` if it is not at
`/usr/bin/google-chrome`. `npm run format` fixes formatting automatically.

## Where things live

- `src/lib/` contains the chess logic: positions, PGN, evaluation maths, move grading,
  tactics and explanations. This code has no dependency on React or the browser and is
  covered by the unit tests in `tests/`. New analysis features usually start here, with tests.
- `src/engine/` wraps Stockfish and the Lichess cloud evaluation and tablebase services.
- `src/controllers/` connects the engine and the state: live analysis, game review, practice,
  games against the engine, persistence and keyboard shortcuts.
- `src/state/` holds the application state (Zustand stores).
- `src/components/` is the user interface, and `src/styles/` the CSS, built on the design
  tokens in `tokens.css`.

## Guidelines

- Keep the app self-contained: it must work as a static site with no server of its own,
  and analysis must keep working offline. Any new network service must be optional and be
  added to the Content Security Policy in `vite.config.ts` and to the privacy section of
  the README.
- Prefer clear names and short functions over comments; add a comment when the reason for
  a piece of code is not obvious from the code itself.
- User-facing text is written in plain, friendly English, in sentence case.
- Test with the keyboard and on a narrow screen when you change the interface.

## Licence

Chess Advisor is licensed under the GNU General Public License v3 or later. By contributing,
you agree that your contributions are licensed under the same terms.
