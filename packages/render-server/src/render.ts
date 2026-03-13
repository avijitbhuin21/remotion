import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {uploadFile} from './s3';

export type SupportedCodec =
	| 'h264'
	| 'h265'
	| 'vp8'
	| 'vp9'
	| 'gif'
	| 'prores'
	| 'mp3'
	| 'aac'
	| 'wav';

type CodecMeta = {
	ext: string;
	mime: string;
};

const CODEC_META: Record<SupportedCodec, CodecMeta> = {
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

export type RenderInput = {
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

export type RenderOutput = {
	url: string;
	key: string;
};

const buildEntryFile = (compositionId: string): string => {
	return `
import {registerRoot, Composition} from 'remotion';
import {Comp} from './Comp';

const Root = () => (
  <>
    <Composition
      id="${compositionId}"
      component={Comp}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);

registerRoot(Root);
`.trim();
};

export const renderVideo = async (input: RenderInput): Promise<RenderOutput> => {
	const {
		tsxCode,
		compositionId,
		codec = 'h264',
		durationInFrames = 150,
		fps = 30,
		width = 1920,
		height = 1080,
		props = {},
		imageFormat,
		jpegQuality,
		crf,
		scale,
	} = input;

	const {ext, mime} = CODEC_META[codec];

	const jobId = crypto.randomUUID();
	const tmpDir = path.join(os.tmpdir(), `remotion-render-${jobId}`);
	const bundleOutDir = path.join(os.tmpdir(), `remotion-bundle-${jobId}`);
	const outputFile = path.join(os.tmpdir(), `${jobId}.${ext}`);

	try {
		fs.mkdirSync(tmpDir, {recursive: true});

		fs.writeFileSync(path.join(tmpDir, 'Comp.tsx'), tsxCode, 'utf-8');
		fs.writeFileSync(
			path.join(tmpDir, 'index.tsx'),
			buildEntryFile(compositionId),
			'utf-8',
		);

		console.log(`[${jobId}] Bundling...`);
		const bundleLocation = await bundle({
			entryPoint: path.join(tmpDir, 'index.tsx'),
			outDir: bundleOutDir,
			onProgress: (progress) => {
				process.stdout.write(`\r[${jobId}] Bundle progress: ${progress}%`);
			},
		});
		console.log(`\n[${jobId}] Bundle done: ${bundleLocation}`);

		console.log(`[${jobId}] Selecting composition "${compositionId}"...`);
		const composition = await selectComposition({
			serveUrl: bundleLocation,
			id: compositionId,
			inputProps: props,
		});

		const finalComposition = {
			...composition,
			durationInFrames,
			fps,
			width,
			height,
		};

		const resolvedImageFormat =
			codec === 'gif' ? 'png' : (imageFormat ?? 'jpeg');

		console.log(`[${jobId}] Rendering as ${codec} (${ext})...`);
		await renderMedia({
			composition: finalComposition,
			serveUrl: bundleLocation,
			codec,
			outputLocation: outputFile,
			inputProps: props,
			imageFormat: resolvedImageFormat,
			...(codec !== 'gif' && resolvedImageFormat !== 'none'
				? {jpegQuality: jpegQuality ?? 80}
				: {}),
			...(crf !== undefined ? {crf} : {}),
			...(scale !== undefined ? {scale} : {}),
			onProgress: ({progress}) => {
				process.stdout.write(
					`\r[${jobId}] Render progress: ${Math.round(progress * 100)}%`,
				);
			},
		});
		console.log(`\n[${jobId}] Render done`);

		const s3Key = `renders/${jobId}.${ext}`;
		console.log(`[${jobId}] Uploading to S3 as ${s3Key}...`);
		const url = await uploadFile(outputFile, s3Key, mime);
		console.log(`[${jobId}] Upload done: ${url}`);

		return {url, key: s3Key};
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
		fs.rmSync(bundleOutDir, {recursive: true, force: true});
		if (fs.existsSync(outputFile)) {
			fs.rmSync(outputFile, {force: true});
		}
	}
};
