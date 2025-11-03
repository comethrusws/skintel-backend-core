import { Router, Request, Response } from 'express';
import { uploadImageToS3, uploadBufferToS3 } from '../lib/s3';

export const uploadRouter = Router();

/**
 * @swagger
 * tags:
 *   - name: Upload
 *     description: Image upload to s3
 *
 * /v1/upload:
 *   post:
 *     summary: Upload an image to S3 bucket
 *     description: Accepts a base64-encoded image and returns the public URL and key.
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageBase64:
 *                 type: string
 *                 description: Base64-encoded image or data URL
 *                 example: data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...
 *               prefix:
 *                 type: string
 *                 description: Optional folder prefix for the S3 key
 *             required:
 *               - imageBase64
 *     responses:
 *       201:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   format: uri
 *                 key:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 sizeBytes:
 *                   type: integer
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
uploadRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { imageBase64, prefix } = req.body as { imageBase64?: string; prefix?: string };
    
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 (string) is required' });
    }

    // Check base64 size before processing
    const sizeEstimate = Math.ceil(imageBase64.length * 0.75); // base64 to bytes estimation
    const maxSize = 50 * 1024 * 1024; // 50MB limit for images
    
    if (sizeEstimate > maxSize) {
      return res.status(413).json({
        error: 'Image too large',
        message: `Estimated size ${Math.round(sizeEstimate / 1024 / 1024)}MB exceeds 50MB limit`,
        maxSizeMB: 50
      });
    }

    console.log(`Processing image upload: estimated size ${Math.round(sizeEstimate / 1024)}KB`);
    
    const result = await uploadImageToS3({ imageBase64, prefix });
    return res.status(201).json({ 
      url: result.url, 
      key: result.key, 
      contentType: result.contentType, 
      sizeBytes: result.sizeBytes,
      sizeMB: Math.round(result.sizeBytes / 1024 / 1024 * 100) / 100
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    
    if (error.message?.includes('too large') || error.message?.includes('size')) {
      return res.status(413).json({ 
        error: 'File too large', 
        message: error.message,
        maxSizeMB: 10
      });
    }
    
    return res.status(500).json({ 
      error: 'Upload failed', 
      message: error?.message ?? 'Unknown error' 
    });
  }
});

/**
 * @swagger
 * /v1/upload/file:
 *   post:
 *     summary: Upload an image file to S3
 *     description: Accepts raw image bytes (binary body) and returns the public URL and key. MEANT FOR TESTING> DO NOT USE IN PRODUCTION!
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         image/jpeg:
 *           schema:
 *             type: string
 *             format: binary
 *         image/png:
 *           schema:
 *             type: string
 *             format: binary
 *         application/octet-stream:
 *           schema:
 *             type: string
 *             format: binary
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *         required: false
 *         description: Optional folder prefix for the S3 key
 *     responses:
 *       201:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   format: uri
 *                 key:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 sizeBytes:
 *                   type: integer
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
uploadRouter.post('/file', async (req: Request, res: Response) => {
  try {
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          return res.status(400).json({ error: 'Empty body' });
        }

        const result = await uploadBufferToS3({ buffer, contentType, prefix });
        return res.status(201).json({ url: result.url, key: result.key, contentType: result.contentType, sizeBytes: result.sizeBytes });
      } catch (error: any) {
        return res.status(500).json({ error: 'Upload failed', message: error?.message ?? 'Unknown error' });
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Upload failed', message: error?.message ?? 'Unknown error' });
  }
});

/**
 * @swagger
 * /v1/upload/config:
 *   get:
 *     summary: Get upload configuration
 *     description: Returns current upload limits and configuration for debugging
 *     tags: [Upload]
 *     responses:
 *       200:
 *         description: Configuration retrieved
 */
uploadRouter.get('/config', async (req: Request, res: Response) => {
  const maxRequestSize = process.env.MAX_REQUEST_SIZE || 'not set';
  const s3Configured = !!(process.env.S3_BUCKET_NAME && process.env.AWS_REGION);
  
  res.json({
    maxRequestSize,
    s3Configured,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});


