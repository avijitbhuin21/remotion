import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import type {Request, Response} from 'express';
import express from 'express';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import pLimit from 'p-limit';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MAX_CONCURRENT = process.env.MAX_CONCURRENT_RENDERS
	? parseInt(process.env.MAX_CONCURRENT_RENDERS, 10)
	: 8;

const require = createRequire(import.meta.url);

const app = express();
app.use(express.json({limit: '10mb'}));

const limit = pLimit(MAX_CONCURRENT);

const OUT_DIR = join(process.cwd(), 'out');
if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, {recursive: true});
}

let bundleCache: string | null = null;
let isReady = false;

const getBundle = async (): Promise<string> => {
	if (bundleCache) return bundleCache;

	const entryPoint = require.resolve('./index');
	bundleCache = await bundle({
		entryPoint,
		webpackOverride: (config) => config,
	});

	return bundleCache;
};

const warmup = async (): Promise<void> => {
	console.log('Ensuring Chromium is installed...');
	await ensureBrowser();
	console.log('Chromium ready.');

	console.log('Pre-warming Remotion bundle...');
	await getBundle();
	console.log('Bundle ready.');

	isReady = true;
	console.log('Server is fully ready to accept render requests.');
};

app.get('/health', (_req: Request, res: Response) => {
	res.status(isReady ? 200 : 503).json({
		status: isReady ? 'ok' : 'warming_up',
		maxConcurrentRenders: MAX_CONCURRENT,
		activeRenders: MAX_CONCURRENT - limit.pendingCount,
		pendingRenders: limit.pendingCount,
		timestamp: new Date().toISOString(),
	});
});

type RenderRequestBody = {
	compositionId: string;
	inputProps?: Record<string, unknown>;
	codec?: 'h264' | 'h265' | 'vp8' | 'vp9' | 'gif' | 'prores' | 'mp3' | 'aac' | 'wav';
	imageFormat?: 'png' | 'jpeg' | 'none';
	jpegQuality?: number;
	crf?: number;
	scale?: number;
};

app.post('/render', async (req: Request, res: Response) => {
	if (!isReady) {
		res.status(503).json({
			success: false,
			error: 'Server is still warming up. Please retry in a few seconds.',
		});
		return;
	}

	const body = req.body as RenderRequestBody;

	if (!body.compositionId) {
		res.status(400).json({
			success: false,
			error: 'Missing required field: compositionId',
		});
		return;
	}

	const jobId = randomUUID();
	const codec = body.codec ?? 'h264';
	const isGif = codec === 'gif';
	const fileExtension = isGif ? 'gif' : 'mp4';
	const outputPath = join(OUT_DIR, `${jobId}.${fileExtension}`);

	try {
		await limit(async () => {
			const serveUrl = await getBundle();

			const composition = await selectComposition({
				serveUrl,
				id: body.compositionId,
				inputProps: body.inputProps ?? {},
			});

			await renderMedia({
				codec,
				composition,
				serveUrl,
				outputLocation: outputPath,
				chromiumOptions: {
					enableMultiProcessOnLinux: true,
				},
				inputProps: body.inputProps ?? {},
				imageFormat: isGif ? 'png' : (body.imageFormat ?? 'jpeg'),
				...(isGif ? {} : {jpegQuality: body.jpegQuality ?? 80}),
				...(body.crf !== undefined ? {crf: body.crf} : {}),
				...(body.scale !== undefined ? {scale: body.scale} : {}),
			});
		});

		res.setHeader('Content-Type', isGif ? 'image/gif' : 'video/mp4');
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${body.compositionId}-${jobId}.${fileExtension}"`,
		);
		res.setHeader('X-Job-Id', jobId);

		const {createReadStream} = await import('node:fs');
		const stream = createReadStream(outputPath);

		stream.on('end', () => {
			try {
				rmSync(outputPath, {force: true});
			} catch {
			}
		});

		stream.on('error', (err) => {
			console.error(`Stream error for job ${jobId}:`, err);
			rmSync(outputPath, {force: true});
		});

		stream.pipe(res);
	} catch (err: unknown) {
		try {
			rmSync(outputPath, {force: true});
		} catch {
		}

		const errorMessage =
			err instanceof Error ? err.message : String(err);
		const errorStack =
			err instanceof Error ? err.stack : undefined;

		console.error(`Render failed for job ${jobId}:`, errorMessage);

		res.status(500).json({
			success: false,
			jobId,
			compositionId: body.compositionId,
			error: errorMessage,
			stack: process.env.NODE_ENV !== 'production' ? errorStack : undefined,
		});
	}
});

app.listen(PORT, () => {
	console.log(`Remotion render server running on port ${PORT}`);
	console.log(`Max concurrent renders: ${MAX_CONCURRENT}`);
	warmup().catch((err) => {
		console.error('Warmup failed:', err);
		process.exit(1);
	});
});
