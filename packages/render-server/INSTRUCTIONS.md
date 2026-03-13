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
| `S3_ENDPOINT` | **Yes** | Custom endpoint URL for MinIO/Railway e.g. `https://bucket.up.railway.app`. URL is built as `{S3_ENDPOINT}/{S3_BUCKET}/{key}`. |

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

Renders a video from a dynamically provided Remotion composition (as TSX source code), uploads the result to S3, and returns a public URL.

**Request body (JSON):**

```json
{
  "tsxCode": "<string — full TSX source of your Comp component>",
  "compositionId": "<string>",
  "durationInFrames": 150,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "props": {}
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `tsxCode` | string | ✅ | — | Full TSX source code of the `Comp` component to render. Must export a named export `Comp`. |
| `compositionId` | string | ✅ | — | The composition ID to register and render. |
| `codec` | string | No | `"h264"` | Output codec: `"h264"`, `"h265"`, `"vp8"`, `"vp9"`, `"gif"`, `"prores"`, `"mp3"`, `"aac"`, `"wav"` |
| `durationInFrames` | number | No | `150` | Total number of frames to render |
| `fps` | number | No | `30` | Frames per second |
| `width` | number | No | `1920` | Output width in pixels |
| `height` | number | No | `1080` | Output height in pixels |
| `props` | object | No | `{}` | Props passed into the composition component |
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

**How `tsxCode` works:**

The server writes your `tsxCode` to a temporary `Comp.tsx` file and auto-generates an `index.tsx` entry file that wires it into a Remotion `<Composition>` with the given `compositionId`, dimensions, fps, and duration. Your `Comp.tsx` must export a React component named `Comp`.

Example minimal `tsxCode`:

```tsx
import {AbsoluteFill} from 'remotion';

export const Comp: React.FC<{text: string}> = ({text}) => {
  return (
    <AbsoluteFill style={{backgroundColor: 'red', justifyContent: 'center', alignItems: 'center'}}>
      <h1 style={{color: 'white'}}>{text}</h1>
    </AbsoluteFill>
  );
};
```

**Success response:**

```json
{
  "success": true,
  "url": "https://bucket.up.railway.app/my-bucket/renders/abc123.mp4",
  "key": "renders/abc123.mp4"
}
```

**Error response:**

```json
{
  "success": false,
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
    "tsxCode": "import {AbsoluteFill} from '\''remotion'\''; export const Comp: React.FC<{text: string}> = ({text}) => (<AbsoluteFill style={{backgroundColor: '\''#000'\'', justifyContent: '\''center'\'', alignItems: '\''center'\''}}><h1 style={{color: '\''#fff'\''}}>{text}</h1></AbsoluteFill>);",
    "compositionId": "MyComp",
    "durationInFrames": 90,
    "fps": 30,
    "width": 1280,
    "height": 720,
    "props": { "text": "Hello from dynamic render!" }
  }'
```

---

## Notes for Railway deployment

- Set all env vars (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`) in the Railway service variables panel
- Health check path: `GET /health`
- The server downloads Chromium automatically on first render — this may take 30–60s on cold start
- Renders are CPU and memory intensive — use at least 2 vCPU / 4GB RAM on Railway
- Output files are stored in S3 permanently; the server deletes local temp files after each upload
- Each render creates a fresh bundle from the provided `tsxCode` — there is no shared bundle cache between requests
