import { Router, Request, Response } from 'express';
import { uploadImageToS3 } from '../lib/s3';

export const uploadRouter = Router();

// POST /v1/upload
// Body: { imageBase64: string, prefix?: string }
uploadRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { imageBase64, prefix } = req.body as { imageBase64?: string; prefix?: string };
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 (string) is required' });
    }

    const result = await uploadImageToS3({ imageBase64, prefix });
    return res.status(201).json({ url: result.url, key: result.key, contentType: result.contentType, sizeBytes: result.sizeBytes });
  } catch (error: any) {
    return res.status(500).json({ error: 'Upload failed', message: error?.message ?? 'Unknown error' });
  }
});


