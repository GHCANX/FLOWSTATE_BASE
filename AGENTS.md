# Super Smash Bros. Melee Replay Engine Guidelines

## 1. Scope & Execution Boundaries
- **Local Analysis Only**: Focus strictly on offline `.slp` replay parsing, quantitative metrics extraction, SQLite storage, and query analytics.
- **Out of Scope**: Do NOT implement live broadcast capturing (OBS/Twitch), live Slippi relay listeners, or Dolphin/FFmpeg video rendering pipelines unless explicitly requested.

## 2. Storage & Disk Hygiene (Zero Accumulation)
- **Dual-Storage Pattern**:
  - Relational indexes, aggregate metrics, and summary states belong in `analytics.db` (SQLite).
  - High-density timelines (conversions, shield pressure events, phantom hits) belong in date-sharded `.json.gz` payloads (`payloads/YYYY/MM/<id>.json.gz`).
- **Immediate Replay Purging**: Temporary `.slp` files downloaded for ingestion must be deleted immediately after a verified database transaction commit. Never allow raw `.slp` files to accumulate in `./temp_slp/`.

## 3. External API & Rate Limiting (Lunar Melee)
- **Endpoint**: Lunar Melee API is located at `https://api.lunarmelee.com` (documented in `docs/llms-full.txt`).
- **Throttling**: The external API limits downloads to 30 requests per minute. Batch workers must throttle to $\le 24\text{ downloads/min}$ using a sliding-window rate limiter.
- **Backoff**: Handle HTTP 429 and 503 responses with exponential backoff and jitter.

## 4. Pipeline Resilience
- **Corrupt File Handling**: When encountering invalid headers, truncated byte streams, or parser crashes in `.slp` files, record the error in `replay_status` as `FAILED_CORRUPT` and proceed with the remaining batch. Never let a single bad replay crash the batch pipeline.
