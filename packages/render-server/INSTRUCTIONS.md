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
| `S3_BUCKET` | Yes | S3 / MinIO bucket name |
| `S3_REGION` | Yes | e.g. `us-east-1` |
| `S3_ACCESS_KEY` | Yes | S3 access key ID |
| `S3_SECRET_KEY` | Yes | S3 secret access key |
| `S3_ENDPOINT` | Yes | Full endpoint URL e.g. `https://bucket.up.railway.app` |

The server will **create the bucket automatically** if it does not exist at startup.

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
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### `POST /render`

Renders a video from a Remotion TSX component and uploads it to S3.

**Request body (JSON):**

```json
{
  "tsxCode": "<string> — full TSX file content of the Remotion composition",
  "compositionId": "<string> — must match the id prop in the <Composition> you register",
  "durationInFrames": 150,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "props": {}
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `tsxCode` | string | ✅ | — | Full source code of a file exporting `Comp` (see format below) |
| `compositionId` | string | ✅ | — | The ID registered with `<Composition id="...">` |
| `durationInFrames` | number | No | 150 | Total frames (length × fps = duration in seconds) |
| `fps` | number | No | 30 | Frames per second |
| `width` | number | No | 1920 | Video width in pixels |
| `height` | number | No | 1080 | Video height in pixels |
| `props` | object | No | `{}` | Props passed to the composition component |
| `codec` | string | No | `"h264"` | Output codec: `"h264"`, `"h265"`, `"vp8"`, `"vp9"`, `"gif"`, `"prores"`, `"mp3"`, `"aac"`, `"wav"` |

> **GIF support:** Set `"codec": "gif"` to render an animated GIF. The server automatically uses PNG frame capture (required for GIF) and returns `image/gif` with a `.gif` file extension. Keep GIF compositions short (≤ 5s) and at a lower resolution to avoid large file sizes.

**Response:**

```json
{
  "success": true,
  "url": "https://bucket.up.railway.app/remotion/renders/abc123.mp4",
  "key": "renders/abc123.mp4"
}
```

**Error response:**

```json
{
  "error": "Human-readable error message"
}
```

---

## TSX file format — what the LLM must generate

The `tsxCode` field must contain a **valid Remotion composition file** that:

1. **Exports a named component called `Comp`**
2. Uses only the Remotion APIs and React (both are pre-installed)
3. Does NOT call `registerRoot()` or create `<Composition>` — the server handles that
4. Does NOT import from external npm packages that are not listed below

### Available imports in tsxCode

```tsx
// React (always available)
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Video, Img, AbsoluteFill, Series, Loop, Easing } from 'remotion';
```

### Minimal valid example

```tsx
import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';

export const Comp = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ color: 'white', opacity, fontSize: 80, fontFamily: 'sans-serif' }}>
        Hello World
      </h1>
    </AbsoluteFill>
  );
};
```

### Prompt-driven example (text + background)

```tsx
import { useCurrentFrame, interpolate, spring, AbsoluteFill, useVideoConfig } from 'remotion';

type Props = { title: string; subtitle: string; bgColor: string };

export const Comp = ({ title = 'My Video', subtitle = 'Created with Remotion', bgColor = '#1a1a2e' }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const subtitleY = spring({ frame: frame - 15, fps, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <h1 style={{ color: 'white', opacity: titleOpacity, fontSize: 72, fontFamily: 'sans-serif', margin: 0 }}>
        {title}
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 36, fontFamily: 'sans-serif', margin: 0, transform: `translateY(${(1 - subtitleY) * 40}px)` }}>
        {subtitle}
      </p>
    </AbsoluteFill>
  );
};
```

To use the above, send `props: { "title": "My Title", "subtitle": "My Subtitle", "bgColor": "#1a1a2e" }` in the request body.

---

## LLM system prompt (add to your LLM call)

When instructing an LLM to generate the `tsxCode`, include these rules:

```
You are generating a Remotion video composition. Output ONLY the TSX file content.

Rules:
- Export a named component called `Comp` — no default export
- Do NOT call registerRoot() or create <Composition> tags
- Do NOT import from any external npm packages other than 'react' and 'remotion'
- Available from 'remotion': useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Video, Img, AbsoluteFill, Series, Loop, Easing, random, staticFile
- Use inline styles only (no CSS files, no Tailwind)
- Animations should use useCurrentFrame() and interpolate() or spring()
- The component receives typed props if needed — define them as a TypeScript type
- Output valid TypeScript JSX. No markdown code fences, just raw TSX.
```

---

## Example curl request

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "tsxCode": "import { useCurrentFrame, interpolate, AbsoluteFill } from \"remotion\";\nexport const Comp = () => {\n  const frame = useCurrentFrame();\n  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: \"clamp\" });\n  return <AbsoluteFill style={{ backgroundColor: \"black\", display: \"flex\", alignItems: \"center\", justifyContent: \"center\" }}><h1 style={{ color: \"white\", opacity, fontSize: 80 }}>Hello</h1></AbsoluteFill>;\n};",
    "compositionId": "Comp",
    "durationInFrames": 90,
    "fps": 30,
    "width": 1280,
    "height": 720
  }'
```

---

## Notes for Railway deployment

- Set all env vars in the Railway service variables panel
- Health check path: `GET /health`
- The server downloads Chromium automatically on first render — this may take 30–60s on cold start
- Renders are CPU and memory intensive — use at least 2 vCPU / 4GB RAM on Railway
- Output videos are stored in S3 permanently; the server deletes local temp files after each render
