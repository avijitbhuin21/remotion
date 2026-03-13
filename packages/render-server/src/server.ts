import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import {
	CreateBucketCommand,
	HeadBucketCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import type {Request, Response} from 'express';
import express from 'express';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createReadStream, existsSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import pLimit from 'p-limit';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MAX_CONCURRENT = process.env.MAX_CONCURRENT_RENDERS
	? parseInt(process.env.MAX_CONCURRENT_RENDERS, 10)
	: 8;

const S3_BUCKET = process.env.S3_BUCKET ?? '';
const S3_REGION = process.env.S3_REGION ?? 'us-east-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? '';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? '';

const s3 = new S3Client({
	region: S3_REGION,
	credentials: {
		accessKeyId: S3_ACCESS_KEY,
		secretAccessKey: S3_SECRET_KEY,
	},
	...(S3_ENDPOINT ? {endpoint: S3_ENDPOINT, forcePathStyle: true} : {}),
});

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

const ensureBucket = async (): Promise<void> => {
	if (!S3_BUCKET) {
		throw new Error('S3_BUCKET environment variable is not set');
	}

	try {
		await s3.send(new HeadBucketCommand({Bucket: S3_BUCKET}));
		console.log(`S3 bucket "${S3_BUCKET}" already exists.`);
	} catch {
		console.log(`Creating S3 bucket "${S3_BUCKET}"...`);
		await s3.send(new CreateBucketCommand({Bucket: S3_BUCKET}));
		console.log(`S3 bucket "${S3_BUCKET}" created.`);
	}
};

const CODEC_META: Record<
	string,
	{ext: string; mime: string}
> = {
	h264: {ext: 'mp4', mime: 'video/mp4'},
	h265: {ext: 'mp4', mime: 'video/mp4'},
	vp8: {ext: 'webm', mime: 'video/webm'},
	vp9: {ext: 'webm', mime: 'video/webm'},
	gif: {ext: 'gif', mime: 'image/gif'},
	prores: {ext: 'mov', mime: 'video/quicktime'},
	mp3: {ext: 'mp3', mime: 'audio/mpeg'},
	aac: {ext: 'aac', mime: 'audio/aac'},
	wav: {ext: 'wav', mime: 'audio/wav'},
};

const uploadToS3 = async (
	filePath: string,
	key: string,
	contentType: string,
): Promise<string> => {
	const fileStream = createReadStream(filePath);

	const upload = new Upload({
		client: s3,
		params: {
			Bucket: S3_BUCKET,
			Key: key,
			Body: fileStream,
			ContentType: contentType,
		},
	});

	await upload.done();

	if (S3_ENDPOINT) {
		return `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${key}`;
	}

	return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
};

const warmup = async (): Promise<void> => {
	console.log('Ensuring Chromium is installed...');
	await ensureBrowser();
	console.log('Chromium ready.');

	console.log('Pre-warming Remotion bundle...');
	await getBundle();
	console.log('Bundle ready.');

	console.log('Verifying S3 bucket...');
	await ensureBucket();
	console.log('S3 bucket ready.');

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
	const meta = CODEC_META[codec] ?? CODEC_META['h264'];
	const {ext, mime} = meta;
	const outputPath = join(OUT_DIR, `${jobId}.${ext}`);
	const s3Key = `renders/${jobId}.${ext}`;

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
				imageFormat: codec === 'gif' ? 'png' : (body.imageFormat ?? 'jpeg'),
				...(codec === 'gif' ? {} : {jpegQuality: body.jpegQuality ?? 80}),
				...(body.crf !== undefined ? {crf: body.crf} : {}),
				...(body.scale !== undefined ? {scale: body.scale} : {}),
			});
		});

		const url = await uploadToS3(outputPath, s3Key, mime);

		try {
			rmSync(outputPath, {force: true});
		} catch {
		}

		res.status(200).json({
			success: true,
			jobId,
			url,
			key: s3Key,
		});
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
