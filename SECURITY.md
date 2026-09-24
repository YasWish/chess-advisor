# Security policy

## Supported versions

Only the latest release, the one deployed at <https://yaswish.github.io/chess-advisor/>,
receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/YasWish/chess-advisor/security/advisories/new),
with a description, the steps to reproduce it, and the impact you expect. You should get an
answer within a week, and credit in the release notes if you would like it.

## Scope

Chess Advisor is a static web application with no server and no user accounts. It stores
settings and the current game in the browser's local storage. Relevant issues include, for
example, script injection through imported PGN, FEN or shared links, bypasses of the Content
Security Policy, and data sent to a third party that the privacy section of the README does
not disclose. Vulnerabilities in Stockfish, Lichess or Chess.com themselves should be
reported to those projects.
