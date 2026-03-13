# Remotion Render Server — API Instructions

## Starting the server

```bash
# From the monorepo root, build all packages first:
bun run build

# Then start the render server:
cd packages/render-server
bun run start

# Or in dev mode with hot reload:
bun run dev
```

## Environment variables

Copy `.env.example` to `.env` and fill in values:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default: 3000) | HTTP port to listen on |
| `MAX_CONCURRENT_RENDERS` | No (default: 8) | Max parallel renders |
| `S3_BUCKET` | **Yes** | S3 / MinIO bucket name |
| `S3_REGION` | **Yes** | e.g. `us-east-1` |
| `S3_ACCESS_KEY` | **Yes** | S3 access key ID |
| `S3_SECRET_KEY` | **Yes** | S3 secret access key |
| `S3_ENDPOINT` | No | Custom endpoint URL for MinIO/Railway e.g. `https://bucket.up.railway.app`. When set, the URL is built as `{S3_ENDPOINT}/{S3_BUCKET}/{key}` instead of the default AWS pattern. |

The server will **create the bucket automatically** if it does not exist at startup. All rendered files are uploaded to S3 and the local temp file is deleted after upload.

---

## Endpoints

### `GET /health`

Returns server status. Use this for Railway health checks.

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "maxConcurrentRenders": 8,
  "activeRenders": 8,
  "pendingRenders": 0,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### `POST /render`

Renders a video/gif/audio from a Remotion composition, uploads the result to S3, and returns a public URL.

**Request body (JSON):**

```json
{
  "compositionId": "<string>",
  "inputProps": {},
  "codec": "h264",
  "imageFormat": "jpeg",
  "jpegQuality": 80,
  "crf": 18,
  "scale": 1
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `compositionId` | string | ✅ | — | The ID registered with `<Composition id="...">` |
| `inputProps` | object | No | `{}` | Props passed to the composition component |
| `codec` | string | No | `"h264"` | Output codec: `"h264"`, `"h265"`, `"vp8"`, `"vp9"`, `"gif"`, `"prores"`, `"mp3"`, `"aac"`, `"wav"` |
| `imageFormat` | string | No | `"jpeg"` | Frame capture format: `"jpeg"`, `"png"`, `"none"`. Auto-set to `"png"` for GIF. |
| `jpegQuality` | number | No | `80` | JPEG quality 0–100. Ignored for GIF. |
| `crf` | number | No | codec default | Constant rate factor (lower = better quality, larger file) |
| `scale` | number | No | `1` | Output scale multiplier |

**Codec → file extension mapping:**

| Codec | Extension | MIME type |
|---|---|---|
| `h264` | `.mp4` | `video/mp4` |
| `h265` | `.mp4` | `video/mp4` |
| `vp8` | `.webm` | `video/webm` |
| `vp9` | `.webm` | `video/webm` |
| `gif` | `.gif` | `image/gif` |
| `prores` | `.mov` | `video/quicktime` |
| `mp3` | `.mp3` | `audio/mpeg` |
| `aac` | `.aac` | `audio/aac` |
| `wav` | `.wav` | `audio/wav` |

**Success response:**

```json
{
  "success": true,
  "jobId": "abc123",
  "url": "https://bucket.up.railway.app/my-bucket/renders/abc123.mp4",
  "key": "renders/abc123.mp4"
}
```

**Error response:**

```json
{
  "success": false,
  "jobId": "abc123",
  "compositionId": "MyComp",
  "error": "Human-readable error message"
}
```

---

## Example curl request

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "compositionId": "MyComp",
    "inputProps": { "title": "Hello World" },
    "codec": "h264"
  }'
```

GIF example:

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "compositionId": "MyComp",
    "codec": "gif"
  }'
```

---

## Notes for Railway deployment

- Set all env vars (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`) in the Railway service variables panel
- Health check path: `GET /health`
- The server downloads Chromium automatically on first render — this may take 30–60s on cold start
- Renders are CPU and memory intensive — use at least 2 vCPU / 4GB RAM on Railway
- Output files are stored in S3 permanently; the server deletes local temp files after each upload
- GIF renders should be kept short (≤ 5s) and at a lower resolution to avoid large file sizes
