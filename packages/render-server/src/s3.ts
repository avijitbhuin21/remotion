import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import {config} from './config';

export const s3 = new S3Client({
	region: config.s3.region,
	credentials: {
		accessKeyId: config.s3.accessKey,
		secretAccessKey: config.s3.secretKey,
	},
	endpoint: config.s3.endpoint,
	forcePathStyle: true,
});

export const ensureBucketExists = async (): Promise<void> => {
	try {
		await s3.send(new HeadBucketCommand({Bucket: config.s3.bucket}));
		console.log(`S3 bucket "${config.s3.bucket}" already exists`);
	} catch {
		console.log(`Creating S3 bucket "${config.s3.bucket}"...`);
		await s3.send(new CreateBucketCommand({Bucket: config.s3.bucket}));
		console.log(`S3 bucket "${config.s3.bucket}" created`);
	}
};

export const uploadFile = async (
	localPath: string,
	key: string,
	contentType: string,
): Promise<string> => {
	const fileContent = fs.readFileSync(localPath);

	await s3.send(
		new PutObjectCommand({
			Bucket: config.s3.bucket,
			Key: key,
			Body: fileContent,
			ContentType: contentType,
		}),
	);

	const endpoint = config.s3.endpoint.replace(/\/$/, '');
	return `${endpoint}/${config.s3.bucket}/${key}`;
};
