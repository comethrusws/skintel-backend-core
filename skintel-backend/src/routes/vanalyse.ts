import { Router, Request, Response } from 'express';
import { analyzeSkin, analyzeWithLandmarks } from '../services/analysis';
import { processLandmarks } from '../services/landmarks';

export const vanalyseRouter = Router();

/**
 * @swagger
 * /v1/vanalyse:
 *   post:
 *     summary: Run skin analysis for an onboarding face image
 *     description: Triggers AI skin analysis using the stored facial landmarks for the provided onboarding answer.
 *     tags: [Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answerId:
 *                 type: string
 *                 description: The onboarding `answer_id` for a face image question
 *               image_url:
 *                 type: string
 *                 description: Direct URL to the image to analyze (alternative to answerId)
 *             required:
 *               - image_url
 *     responses:
 *       200:
 *         description: Analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answerId:
 *                   type: string
 *                 analysis:
 *                   type: object
 *       400:
 *         description: Missing or invalid request body
 *       500:
 *         description: Analysis failed due to a server error
 */
vanalyseRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { answerId, image_url } = req.body as { answerId?: string; image_url?: string };
    if (!answerId && !image_url) {
      return res.status(400).json({ error: 'Provide either answerId or image_url' });
    }

    if (answerId) {
      const analysis = await analyzeSkin(answerId);
      return res.json({ answerId, analysis });
    }

    // for direct image URL: call landmark service then analyze with returned landmarks (ment to be removed after we have s3 bucket)
    const landmarkResult = await processLandmarks(image_url!);
    if (!landmarkResult.success || !landmarkResult.data) {
      return res.status(500).json({ error: landmarkResult.error || 'landmark processing failed' });
    }

    const analysis = await analyzeWithLandmarks(image_url!, landmarkResult.data);
    return res.json({ image_url, analysis, landmarks: landmarkResult.data });
  } catch (error) {
    console.error('vanalyse error', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'analysis failed' });
  }
});


