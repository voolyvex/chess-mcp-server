// Thin HTTP-to-UCI bridge for the native Stockfish binary.
// Runs inside the Docker container.
//
// POST /analyze  { fen, movetimeMs?, multiPv? } → { engine, lines, depth_reached, ... }
// GET  /health   → { status, threads, engine: { name, version, build } }
// GET  /id       → { name, version, build, ... }
//
// Wall-clock is the budget; depth is the outcome. The engine stops itself via
// `go movetime`, so exhausting the budget is a normal result carrying the deepest
// *completed* iteration — never an error, and never a line from an iteration still
// in flight.

"use strict";

const { spawn } = require("child_process");
const express = require("express");

const STOCKFISH_PATH = process.env.STOCKFISH_PATH || "stockfish";
const THREADS = parseInt(process.env.STOCKFISH_THREADS || "4", 10);
const HASH_MB = parseInt(process.env.STOCKFISH_HASH || "256", 10);
const PORT = parseInt(process.env.STOCKFISH_PORT || "8090", 10);
const DEFAULT_MOVETIME_MS = parseInt(process.env.STOCKFISH_MOVETIME || "2000", 10);

// The build (bmi2/avx2/...) is not something the engine reports over UCI — it comes from
// the Dockerfile's SF_BUILD arg. It is part of the engine identity downstream keys its
// cache on, so an unset value is reported as "unknown" rather than silently omitted.
const ENGINE_BUILD = process.env.STOCKFISH_BUILD || "unknown";

// A hard ceiling above the caller's budget. The engine is expected to stop itself; this
// only fires if it stops talking altogether, and then it is a genuine failure.
const WATCHDOG_GRACE_MS = parseInt(process.env.STOCKFISH_WATCHDOG_GRACE || "10000", 10);

const MAX_MOVETIME_MS = parseInt(process.env.STOCKFISH_MAX_MOVETIME || "30000", 10);
const MAX_MULTIPV = 5;

// ---------------------------------------------------------------------------
// Stockfish process management
// ---------------------------------------------------------------------------

let sf = null;
let sfReady = false;
let sfBuffer = "";

/**
 * Engine identity, harvested from the `uci` handshake's `id name` line. Stockfish
 * reports e.g. `id name Stockfish 18` — name and version arrive as one string and are
 * split here so downstream can key a cache on the pair without re-parsing.
 */
let engineIdentity = { name: null, version: null, build: ENGINE_BUILD };

/** @type {Array<PendingRequest>} */
const requestQueue = [];

/** @type {PendingRequest|null} */
let currentRequest = null;

/**
 * @typedef {Object} EngineLine
 * @property {number} depth
 * @property {number} multipv_rank
 * @property {number|null} score_cp    - Raw Score: side-to-move relative, as UCI says it
 * @property {number|null} score_mate  - mate distance in moves, side-to-move relative
 * @property {[number,number,number]|null} wdl - per mille, side-to-move relative
 * @property {string[]} pv
 */

/**
 * @typedef {Object} PendingRequest
 * @property {string} fen
 * @property {number} movetimeMs
 * @property {number} multiPv
 * @property {Map<number, Map<number, EngineLine>>} byDepth - depth → rank → line
 * @property {number} startedAt
 * @property {number|null} nodes
 * @property {number|null} nps
 * @property {number|null} timeMs
 * @property {boolean} settled
 * @property {(result: object) => void} resolve
 * @property {(err: Error) => void} reject
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

function spawnStockfish() {
  sf = spawn(STOCKFISH_PATH);
  sfBuffer = "";
  sfReady = false;

  sf.stdin.on("error", (err) => {
    // The engine can die between our liveness check and the write landing.
    console.error(`[StockfishServer] stdin error: ${err.message}`);
  });

  sf.stdin.write(`setoption name Threads value ${THREADS}\n`);
  sf.stdin.write(`setoption name Hash value ${HASH_MB}\n`);
  // UCI_ShowWDL defaults to false, so the field silently never appears unless it is
  // asked for — a failure that reads as the engine not supporting WDL at all.
  sf.stdin.write("setoption name UCI_ShowWDL value true\n");
  sf.stdin.write("uci\n");
  sf.stdin.write("isready\n");

  sf.stdout.on("data", (data) => {
    sfBuffer += data.toString();
    const lines = sfBuffer.split("\n");
    sfBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line.trim());
    }
  });

  sf.stderr.on("data", (data) => {
    // Swallow Stockfish stderr (benchmark output, etc.)
    void data;
  });

  sf.on("error", (err) => {
    console.error(`[StockfishServer] Failed to spawn Stockfish: ${err.message}`);
    console.error(`[StockfishServer] Check STOCKFISH_PATH=${STOCKFISH_PATH}`);
    sfReady = false;
    failInFlight("engine failed to spawn");
    setTimeout(spawnStockfish, 3000);
  });

  sf.on("exit", (code) => {
    console.error(`[StockfishServer] Stockfish exited (code=${code}), restarting in 1s...`);
    sfReady = false;
    sf = null;
    // A request in flight when the engine dies must fail now. Left alone it would hang
    // until the caller's own timeout, since no `bestmove` is ever coming.
    failInFlight(`engine exited (code=${code}) mid-search`);
    setTimeout(spawnStockfish, 1000);
  });
}

/** Fails the in-flight request and every queued one — none of them can be served. */
function failInFlight(reason) {
  const dead = [];
  if (currentRequest) {
    dead.push(currentRequest);
    currentRequest = null;
  }
  while (requestQueue.length > 0) dead.push(requestQueue.shift());
  for (const req of dead) settleReject(req, new Error(reason));
}

function settleReject(req, err) {
  if (req.settled) return;
  req.settled = true;
  if (req.timer !== null) clearTimeout(req.timer);
  req.reject(err);
}

function settleResolve(req, result) {
  if (req.settled) return;
  req.settled = true;
  if (req.timer !== null) clearTimeout(req.timer);
  req.resolve(result);
}

// ---------------------------------------------------------------------------
// UCI line parsing
// ---------------------------------------------------------------------------

function handleLine(line) {
  if (line.startsWith("id name ")) {
    // e.g. "id name Stockfish 18" — trailing token is the version when it looks like one.
    const full = line.slice("id name ".length).trim();
    const match = full.match(/^(.*?)[\s]+([0-9][^\s]*)$/);
    engineIdentity = match
      ? { name: match[1], version: match[2], build: ENGINE_BUILD }
      : { name: full, version: null, build: ENGINE_BUILD };
    return;
  }

  if (line === "readyok") {
    sfReady = true;
    console.log(
      `[StockfishServer] ${engineIdentity.name ?? "engine"} ${engineIdentity.version ?? ""}` +
        ` (${engineIdentity.build}) ready — ${THREADS} threads, ${HASH_MB}MB hash.`,
    );
    processQueue();
    return;
  }

  if (!currentRequest) return;

  if (line.startsWith("info ")) {
    absorbInfo(currentRequest, line);
    return;
  }

  if (line.startsWith("bestmove")) {
    const req = currentRequest;
    currentRequest = null;
    settleResolve(req, buildResult(req));
    processQueue();
  }
}

/**
 * Accumulates one `info` line into the request, indexed by the depth it belongs to.
 *
 * Indexing by depth rather than overwriting a single slot is what makes "deepest
 * *completed* iteration" expressible: when the budget expires mid-iteration, the
 * partial depth is present but short of its MultiPV quota, and is discarded at
 * result-building time rather than mixed in with the depth below it.
 */
function absorbInfo(req, line) {
  const nodes = line.match(/\bnodes (\d+)/);
  const nps = line.match(/\bnps (\d+)/);
  const time = line.match(/\btime (\d+)/);
  if (nodes) req.nodes = parseInt(nodes[1], 10);
  if (nps) req.nps = parseInt(nps[1], 10);
  if (time) req.timeMs = parseInt(time[1], 10);

  if (!line.includes(" pv ")) return;

  const depthMatch = line.match(/\bdepth (\d+)/);
  const pvMatch = line.match(/ pv (.+)$/);
  if (!depthMatch || !pvMatch) return;

  // `info depth N ... upperbound/lowerbound` is a fail-high/fail-low report, not a
  // resolved score for that iteration. Taking it would report a score the search
  // itself has not confirmed.
  if (/\b(upperbound|lowerbound)\b/.test(line)) return;

  const depth = parseInt(depthMatch[1], 10);
  const mpvMatch = line.match(/\bmultipv (\d+)/);
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  const wdlMatch = line.match(/\bwdl (\d+) (\d+) (\d+)/);

  const rank = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;

  /** @type {EngineLine} */
  const entry = {
    depth,
    multipv_rank: rank,
    // A forced mate is a mate distance, not centipawns: when `score mate` is present,
    // `score cp` is absent, and score_cp stays null rather than being faked as ±30000.
    score_cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    score_mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    wdl: wdlMatch
      ? [parseInt(wdlMatch[1], 10), parseInt(wdlMatch[2], 10), parseInt(wdlMatch[3], 10)]
      : null,
    pv: pvMatch[1].trim().split(/\s+/),
  };

  let atDepth = req.byDepth.get(depth);
  if (!atDepth) {
    atDepth = new Map();
    req.byDepth.set(depth, atDepth);
  }
  atDepth.set(rank, entry);
}

/**
 * Picks the deepest iteration that finished, and reports the depth it actually reached.
 *
 * "Finished" means the iteration produced every MultiPV rank the search was asked for.
 * A mate found at rank 1 can legitimately cut the count short — the engine stops
 * reporting further ranks once the position is resolved — so a mate-bearing iteration
 * counts as complete on its own.
 */
function buildResult(req) {
  const depths = [...req.byDepth.keys()].sort((a, b) => b - a);

  let chosen = null;
  for (const depth of depths) {
    const atDepth = req.byDepth.get(depth);
    const complete =
      atDepth.size >= req.multiPv ||
      [...atDepth.values()].some((line) => line.score_mate !== null);
    if (complete) {
      chosen = { depth, lines: atDepth };
      break;
    }
  }

  // Nothing completed — the budget was too short even for depth 1, or the position is
  // terminal (checkmate/stalemate, where the engine emits `bestmove (none)` with no pv).
  if (!chosen) {
    return {
      engine: { ...engineIdentity },
      lines: [],
      depth_reached: 0,
      nodes: req.nodes,
      nps: req.nps,
      time_ms: req.timeMs ?? Date.now() - req.startedAt,
      movetime_ms: req.movetimeMs,
      multipv: req.multiPv,
    };
  }

  const lines = [...chosen.lines.values()].sort((a, b) => a.multipv_rank - b.multipv_rank);

  return {
    engine: { ...engineIdentity },
    lines,
    // The depth actually reached, never the depth requested — there is no requested
    // depth here, which is the point.
    depth_reached: chosen.depth,
    nodes: req.nodes,
    nps: req.nps,
    time_ms: req.timeMs ?? Date.now() - req.startedAt,
    movetime_ms: req.movetimeMs,
    multipv: req.multiPv,
  };
}

// ---------------------------------------------------------------------------
// Search dispatch
// ---------------------------------------------------------------------------

function processQueue() {
  if (currentRequest || !sfReady || requestQueue.length === 0) return;
  const next = requestQueue.shift();
  if (next) runAnalysis(next);
}

function runAnalysis(req) {
  currentRequest = req;
  req.startedAt = Date.now();

  // Not the budget — the engine owns that via `go movetime` and stops itself. This only
  // catches an engine that has gone silent without exiting, which no result can be
  // salvaged from.
  req.timer = setTimeout(() => {
    if (currentRequest === req) {
      currentRequest = null;
      if (sf) sf.stdin.write("stop\n");
      settleReject(req, new Error(`engine did not respond within ${req.movetimeMs + WATCHDOG_GRACE_MS}ms`));
      processQueue();
    }
  }, req.movetimeMs + WATCHDOG_GRACE_MS);

  if (!sf) {
    settleReject(req, new Error("engine is not running"));
    currentRequest = null;
    return;
  }

  sf.stdin.write(`setoption name MultiPV value ${req.multiPv}\n`);
  sf.stdin.write(`position fen ${req.fen}\n`);
  sf.stdin.write(`go movetime ${req.movetimeMs}\n`);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

function identityPayload() {
  return {
    name: engineIdentity.name,
    version: engineIdentity.version,
    build: engineIdentity.build,
    threads: THREADS,
    hash_mb: HASH_MB,
    default_movetime_ms: DEFAULT_MOVETIME_MS,
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: sfReady ? "ready" : "warming_up",
    threads: THREADS,
    engine: { ...engineIdentity },
  });
});

// Engine identity as its own endpoint: it is part of the cache key downstream, and a
// cache that has to parse a health payload to find its key will eventually stop doing so.
app.get("/id", (_req, res) => {
  if (!sfReady) {
    res.status(503).json({ error: "engine is warming up" });
    return;
  }
  res.json(identityPayload());
});

app.post("/analyze", (req, res) => {
  const { fen, movetimeMs, multiPv = 3 } = req.body ?? {};

  if (!fen || typeof fen !== "string") {
    res.status(400).json({ error: "fen is required and must be a string" });
    return;
  }

  // Wall-clock is the budget. A caller-supplied depth is not accepted at all — accepting
  // one would reintroduce the unpredictable latency the movetime budget exists to remove.
  if ("depth" in (req.body ?? {})) {
    res.status(400).json({
      error: "depth is not a valid budget — pass movetimeMs; depth is reported as an outcome",
    });
    return;
  }

  const requested = movetimeMs === undefined ? DEFAULT_MOVETIME_MS : parseInt(String(movetimeMs), 10);
  if (!Number.isFinite(requested) || requested <= 0) {
    res.status(400).json({ error: "movetimeMs must be a positive integer" });
    return;
  }

  /** @type {PendingRequest} */
  const entry = {
    fen,
    movetimeMs: Math.min(requested, MAX_MOVETIME_MS),
    multiPv: Math.min(Math.max(parseInt(String(multiPv), 10) || 1, 1), MAX_MULTIPV),
    byDepth: new Map(),
    startedAt: Date.now(),
    nodes: null,
    nps: null,
    timeMs: null,
    settled: false,
    resolve: (result) => res.json(result),
    reject: (err) => res.status(503).json({ error: err.message }),
    timer: null,
  };

  requestQueue.push(entry);
  processQueue();
});

spawnStockfish();

app.listen(PORT, () => {
  console.log(`[StockfishServer] Listening on port ${PORT}`);
});
