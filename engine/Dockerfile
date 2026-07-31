# Stockfish engine container
#
# Wraps the official prebuilt Stockfish binary in an HTTP-to-UCI bridge
# (server.js) so the stateless MCP handler can reach it over localhost.
#
# The engine is a container rather than a child process of the handler because
# the handler restarts constantly during development, and a child-process engine
# would re-warm on every restart. The localhost hop is ~1ms against a
# multi-second search. See docs/decisions.md #8.

# ---- Stage 1: bridge dependencies ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

# ---- Stage 2: engine binary, pinned ----
FROM node:20-bookworm-slim AS engine

# Pinned by version AND checksum. Debian's repos carry Stockfish 15.1 — two
# majors behind — and `apt-get install stockfish` pins nothing at all.
#
# Build choice: bmi2. Measured on Zen 4, vnni512 beat plain avx512 by 0.2%
# (inside noise), while Intel removed AVX-512 from consumer CPUs entirely from
# Alder Lake onward, so AVX-512 builds SIGILL on a modern Intel laptop. bmi2
# shares a CPU generation with avx2, so it costs zero compatibility.
# Caveat: bmi2 is slower on AMD Zen 1/Zen 2 (microcoded pext) — slower, not
# incompatible; avx2 is the fallback at ~5%. See docs/decisions.md #9.
ARG SF_VERSION=sf_18
ARG SF_BUILD=bmi2
ARG SF_SHA256=7b200a3cd8ae6e2b07386cd213058edc91faf05ff77db68604d2f5143c56b69e

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /tmp/sf.tar \
      "https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/stockfish-ubuntu-x86-64-${SF_BUILD}.tar" \
 && echo "${SF_SHA256}  /tmp/sf.tar" | sha256sum -c - \
 && tar xf /tmp/sf.tar -C /tmp \
 && install -m 0755 "/tmp/stockfish/stockfish-ubuntu-x86-64-${SF_BUILD}" /usr/local/bin/stockfish \
 && rm -rf /tmp/sf.tar /tmp/stockfish /var/lib/apt/lists/* \
 && stockfish --help 2>&1 | head -1

# ---- Stage 3: runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
COPY --from=engine /usr/local/bin/stockfish /usr/local/bin/stockfish
COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./

# The build is not something the engine reports over UCI, so it is carried forward from
# the build arg above. It is part of the engine identity the handler keys its cache on:
# two containers differing only in build are two different engines.
ARG SF_BUILD=bmi2

ENV STOCKFISH_PATH=/usr/local/bin/stockfish \
    STOCKFISH_BUILD=${SF_BUILD} \
    STOCKFISH_THREADS=4 \
    STOCKFISH_HASH=256 \
    STOCKFISH_PORT=8090 \
    STOCKFISH_MOVETIME=2000

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8090/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const b=JSON.parse(d);process.exit(b.status==='ready'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
