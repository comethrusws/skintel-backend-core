import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || '';
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL; 

export const s3 = new S3Client({
  region: AWS_REGION,
});

export type UploadImageInput = {
  imageBase64: string; //either raw base64 or data url here
  prefix?: string; // optional prefix
};

export type UploadImageResult = {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
};

function parseBase64(input: string): { buffer: Buffer; contentType: string; extension: string } {
  let base64 = input;
  let contentType = 'application/octet-stream';
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error('Invalid data URL');
    contentType = match[1];
    base64 = match[2];
  }
  const buffer = Buffer.from(base64, 'base64');

  let extension = 'bin';
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') extension = 'jpg';
  else if (contentType === 'image/png') extension = 'png';
  else if (contentType === 'image/webp') extension = 'webp';
  else if (contentType === 'image/gif') extension = 'gif';

  return { buffer, contentType, extension };
}

export async function uploadImageToS3(input: UploadImageInput): Promise<UploadImageResult> {
  if (!S3_BUCKET_NAME) throw new Error('S3_BUCKET_NAME is not configured');

  const { buffer, contentType, extension } = parseBase64(input.imageBase64);
  if (buffer.length === 0) throw new Error('Empty image payload');

  const randomName = crypto.randomUUID().replace(/-/g, '');
  const prefix = input.prefix ? input.prefix.replace(/^\/+|\/+$|\.+/g, '') + '/' : '';
  const key = `${prefix}${randomName}.${extension}`;

  const put = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(put);

  const url = S3_PUBLIC_BASE_URL
    ? `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
    : `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

  return { key, url, contentType, sizeBytes: buffer.length };
}

export async function uploadBufferToS3(params: { buffer: Buffer; contentType?: string; prefix?: string }): Promise<UploadImageResult> {
  if (!S3_BUCKET_NAME) throw new Error('S3_BUCKET_NAME is not configured');

  const { buffer } = params;
  const contentType = params.contentType || 'application/octet-stream';

  if (buffer.length === 0) throw new Error('Empty image payload');

  let extension = 'bin';
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') extension = 'jpg';
  else if (contentType === 'image/png') extension = 'png';
  else if (contentType === 'image/webp') extension = 'webp';
  else if (contentType === 'image/gif') extension = 'gif';

  const randomName = crypto.randomUUID().replace(/-/g, '');
  const prefix = params.prefix ? params.prefix.replace(/^\/+|\/+$|\.+/g, '') + '/' : '';
  const key = `${prefix}${randomName}.${extension}`;

  const put = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(put);

  const url = S3_PUBLIC_BASE_URL
    ? `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
    : `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

  return { key, url, contentType, sizeBytes: buffer.length };
}


