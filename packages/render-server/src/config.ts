const required = (name: string): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
};

const optional = (name: string, fallback: string): string => {
	return process.env[name] ?? fallback;
};

export const config = {
	port: parseInt(optional('PORT', '3000'), 10),
	s3: {
		bucket: required('S3_BUCKET'),
		region: required('S3_REGION'),
		accessKey: required('S3_ACCESS_KEY'),
		secretKey: required('S3_SECRET_KEY'),
		endpoint: required('S3_ENDPOINT'),
	},
} as const;
