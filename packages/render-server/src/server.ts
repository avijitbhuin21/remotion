import {config} from './config';
import {renderVideo} from './render';
import {ensureBucketExists} from './s3';

const jsonResponse = (data: unknown, status = 200): Response =>
	new Response(JSON.stringify(data), {
		status,
		headers: {'Content-Type': 'application/json'},
	});

const handleHealth = (): Response =>
	jsonResponse({status: 'ok', timestamp: new Date().toISOString()});

const handleRender = async (req: Request): Promise<Response> => {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return jsonResponse({error: 'Invalid JSON body'}, 400);
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		!('tsxCode' in body) ||
		!('compositionId' in body)
	) {
		return jsonResponse(
			{error: 'Missing required fields: tsxCode, compositionId'},
			400,
		);
	}

	const {
		tsxCode,
		compositionId,
		durationInFrames,
		fps,
		width,
		height,
		props,
	} = body as Record<string, unknown>;

	if (typeof tsxCode !== 'string' || tsxCode.trim() === '') {
		return jsonResponse({error: 'tsxCode must be a non-empty string'}, 400);
	}

	if (typeof compositionId !== 'string' || compositionId.trim() === '') {
		return jsonResponse({error: 'compositionId must be a non-empty string'}, 400);
	}

	try {
		const result = await renderVideo({
			tsxCode,
			compositionId,
			durationInFrames:
				typeof durationInFrames === 'number' ? durationInFrames : undefined,
			fps: typeof fps === 'number' ? fps : undefined,
			width: typeof width === 'number' ? width : undefined,
			height: typeof height === 'number' ? height : undefined,
			props:
				typeof props === 'object' && props !== null
					? (props as Record<string, unknown>)
					: undefined,
		});

		return jsonResponse({success: true, url: result.url, key: result.key});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Render error:', message);
		return jsonResponse({error: message}, 500);
	}
};

const server = Bun.serve({
	port: config.port,
	async fetch(req) {
		const url = new URL(req.url);

		if (req.method === 'GET' && url.pathname === '/health') {
			return handleHealth();
		}

		if (req.method === 'POST' && url.pathname === '/render') {
			return handleRender(req);
		}

		return jsonResponse({error: 'Not found'}, 404);
	},
});

console.log(`Initializing S3 bucket...`);
await ensureBucketExists();

console.log(`Remotion Render Server running on http://localhost:${server.port}`);
console.log(`  GET  /health  — health check`);
console.log(`  POST /render  — render a video from TSX code`);
