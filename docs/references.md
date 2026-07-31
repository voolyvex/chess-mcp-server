# Reference Standards

Authoritative sources for the notations and protocols this project consumes. When
behaviour is disputed, these win over library docs, blog posts, or inference.

## Chess notation — PGN, SAN, FEN

**Standard: Portable Game Notation Specification and Implementation Guide**
Steven J. Edwards, 12 March 1994. The single normative document for all three notations —
FEN is defined inside the PGN standard, not separately.

- Full text: <http://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm>
- Archival copy: <https://archive.org/details/pgn-standard-1994-03-12>
- IANA media type `application/vnd.chess-pgn`: <https://www.iana.org/assignments/media-types/application/vnd.chess-pgn>

Sections worth citing directly:

| Section | Defines | Why it matters here |
|---------|---------|---------------------|
| **16.1** | FEN, and its six fields | Field 2 (active colour) and field 6 (fullmove number) are what let an absolute move number be derived from a mid-game Start Position |
| 16.1.3.1–16.1.3.6 | Piece placement, active colour, castling, en passant, halfmove clock, fullmove number | Fullmove number increments *after* Black's move — the source of most off-by-one errors |
| **8.2.3** | SAN, incl. disambiguation (8.2.3.4) and check/mate suffixes (8.2.3.5) | The move format users paste into chat |
| **8.2.5** | RAV — recursive annotation variations, `( ... )` | chess.js silently drops these; see below |
| 8.2.4, 10 | NAGs — `$0`–`$255` and their meanings | Parsed and ignored |
| 5 | Comment syntax — `{ ... }` and `; ...` | Where `{[%clk ...]}` and `{[%eval ...]}` live |
| 8.1.1 | Seven Tag Roster | Event, Site, Date, Round, White, Black, Result |
| **9.7** | `SetUp` (9.7.1) and `FEN` (9.7.2) tag pairs | How a PGN declares a non-standard Start Position |

## Chess engine protocol — UCI

**UCI Protocol and Stockfish Commands** — official Stockfish documentation.
<https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html>

Load-bearing details:

- **`score cp` and `score mate` are reported from the side-to-move's perspective**, not
  White's. Any White-relative display must negate when Black is to move. This is the
  single most common source of inverted evaluations.
- `info` fields: `depth`, `seldepth`, `multipv`, `nodes`, `nps`, `hashfull` (per mille),
  `tbhits`, `time`, `pv`.
- `wdl <win> <draw> <loss>` available when `UCI_ShowWDL` is enabled — expressed in
  per-mille, and often more legible to a human than centipawns.
- `position [fen <fenstring> | startpos] moves <move1> ...` — passing `moves` rather than
  a precomputed FEN is what gives the engine correct repetition detection.
- `go depth <x>` searches to exactly x plies.
- Options: `Threads` (set to physical cores), `Hash` (MB, set *after* Threads),
  `UCI_LimitStrength` + `UCI_Elo` (1320–3190, calibrated at 120s+1s), `Skill Level` (0–20).

## Library behaviour — chess.js

Not a standard, but the parser in use. Verified against **chess.js 1.4.0** in this repo:

| Input | Behaviour |
|-------|-----------|
| Bare move list, `"e4 e5 Nf3 Nc6"` | Parses — move numbers and result token are optional |
| `[FEN "..."]` header, with or without `[SetUp "1"]` | Honoured as the Start Position |
| `{[%clk ...]}`, `{[%eval ...]}`, `$1` | Parsed and ignored correctly |
| Variations, `2. Nf3 (2. Bc4 Nf6)` | **Mainline taken, RAV silently dropped** — absent from `getComments()`, no error |
| Two games concatenated | Throws `Expected end of input or whitespace` |
| Fragment starting mid-game, `"2... Nc6"` | Throws `Invalid move in PGN` |
| Illegal move | Throws `Invalid move in PGN: <san>` |

Only the RAV case fails silently, and it is therefore the only one that can produce a
confident evaluation of a position the user never asked about.
