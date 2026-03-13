import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {uploadFile} from './s3';

export type RenderInput = {
	tsxCode: string;
	compositionId: string;
	durationInFrames?: number;
	fps?: number;
	width?: number;
	height?: number;
	props?: Record<string, unknown>;
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
		durationInFrames = 150,
		fps = 30,
		width = 1920,
		height = 1080,
		props = {},
	} = input;

	const jobId = crypto.randomUUID();
	const tmpDir = path.join(os.tmpdir(), `remotion-render-${jobId}`);
	const bundleOutDir = path.join(os.tmpdir(), `remotion-bundle-${jobId}`);
	const outputMp4 = path.join(os.tmpdir(), `${jobId}.mp4`);

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

		console.log(`[${jobId}] Rendering...`);
		await renderMedia({
			composition: finalComposition,
			serveUrl: bundleLocation,
			codec: 'h264',
			outputLocation: outputMp4,
			inputProps: props,
			onProgress: ({progress}) => {
				process.stdout.write(`\r[${jobId}] Render progress: ${Math.round(progress * 100)}%`);
			},
		});
		console.log(`\n[${jobId}] Render done`);

		const s3Key = `renders/${jobId}.mp4`;
		console.log(`[${jobId}] Uploading to S3 as ${s3Key}...`);
		const url = await uploadFile(outputMp4, s3Key, 'video/mp4');
		console.log(`[${jobId}] Upload done: ${url}`);

		return {url, key: s3Key};
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
		fs.rmSync(bundleOutDir, {recursive: true, force: true});
		if (fs.existsSync(outputMp4)) {
			fs.rmSync(outputMp4, {force: true});
		}
	}
};
