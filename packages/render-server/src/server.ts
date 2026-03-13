import {ensureBrowser} from '@remotion/renderer';
import type {Request, Response} from 'express';
import express from 'express';
import pLimit from 'p-limit';
import {config} from './config';
import {renderVideo, type SupportedCodec} from './render';
import {ensureBucketExists} from './s3';

const MAX_CONCURRENT = process.env.MAX_CONCURRENT_RENDERS
	? parseInt(process.env.MAX_CONCURRENT_RENDERS, 10)
	: 8;

const app = express();
app.use(express.json({limit: '10mb'}));

const limit = pLimit(MAX_CONCURRENT);

let isReady = false;

const warmup = async (): Promise<void> => {
	console.log('Ensuring Chromium is installed...');
	await ensureBrowser();
	console.log('Chromium ready.');

	console.log('Verifying S3 bucket...');
	await ensureBucketExists();
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
	tsxCode: string;
	compositionId: string;
	codec?: SupportedCodec;
	durationInFrames?: number;
	fps?: number;
	width?: number;
	height?: number;
	props?: Record<string, unknown>;
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

	if (!body.tsxCode) {
		res.status(400).json({
			success: false,
			error: 'Missing required field: tsxCode',
		});
		return;
	}

	if (!body.compositionId) {
		res.status(400).json({
			success: false,
			error: 'Missing required field: compositionId',
		});
		return;
	}

	try {
		const result = await limit(() =>
			renderVideo({
				tsxCode: body.tsxCode,
				compositionId: body.compositionId,
				codec: body.codec,
				durationInFrames: body.durationInFrames,
				fps: body.fps,
				width: body.width,
				height: body.height,
				props: body.props,
				imageFormat: body.imageFormat,
				jpegQuality: body.jpegQuality,
				crf: body.crf,
				scale: body.scale,
			}),
		);

		res.status(200).json({
			success: true,
			url: result.url,
			key: result.key,
		});
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		const errorStack = err instanceof Error ? err.stack : undefined;

		console.error('Render failed:', errorMessage);

		res.status(500).json({
			success: false,
			compositionId: body.compositionId,
			error: errorMessage,
			stack: process.env.NODE_ENV !== 'production' ? errorStack : undefined,
		});
	}
});

app.listen(config.port, () => {
	console.log(`Remotion render server running on port ${config.port}`);
	console.log(`Max concurrent renders: ${MAX_CONCURRENT}`);
	warmup().catch((err) => {
		console.error('Warmup failed:', err);
		process.exit(1);
	});
});
