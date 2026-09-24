# Stockfish engine files

These two files are the chess engine that Chess Advisor runs in your browser:

| File | Size | SHA-256 |
| --- | --- | --- |
| `stockfish-19-lite-single.js` | 21 KB | `d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6` |
| `stockfish-19-lite-single.wasm` | 1.8 MB | `57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387` |

They are the unmodified "lite, single-threaded" build of **Stockfish 19** from the
[`stockfish` npm package](https://www.npmjs.com/package/stockfish) version 19.0.0, which is
[Stockfish](https://github.com/official-stockfish/Stockfish) compiled to WebAssembly by the
[stockfish.js](https://github.com/nmrugg/stockfish.js) project.

The lite build uses a smaller neural network so the download stays under 2 MB, and the
single-threaded build needs no cross-origin isolation headers, so it works on GitHub Pages
and any other static host. In the browser it searches roughly 300 000 to 1 500 000
positions per second, depending on the device.

Stockfish is free software under the GNU General Public License version 3; its full text is
in [`COPYING.txt`](COPYING.txt). The corresponding source code is available from the two
repositories linked above. To refresh these files from a newer release, run
`npm run engine:update`.
