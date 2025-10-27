import { Router, Request, Response } from 'express';
import { analyzeSkin, analyzeWithLandmarks } from '../services/analysis';
import { processLandmarks } from '../services/landmarks';

export const vanalyseRouter = Router();

/**
 * @swagger
 * /v1/vanalyse:
 *   post:
 *     summary: Run skin analysis for face images
 *     description: Triggers AI skin analysis using facial landmarks and multiple face images (front, left, right profiles).
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
 *               front_image_url:
 *                 type: string
 *                 description: URL to front face image (required for landmarks)
 *               left_image_url:
 *                 type: string
 *                 description: URL to left profile image (optional)
 *               right_image_url:
 *                 type: string
 *                 description: URL to right profile image (optional)
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
 *                 images_analyzed:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Missing or invalid request body
 *       500:
 *         description: Analysis failed due to a server error
 */
vanalyseRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { answerId, front_image_url, left_image_url, right_image_url } = req.body as { 
      answerId?: string; 
      front_image_url?: string; 
      left_image_url?: string; 
      right_image_url?: string; 
    };

    if (!answerId && !front_image_url) {
      return res.status(400).json({ error: 'Provide either answerId or front_image_url' });
    }

    if (answerId) {
      // Use stored landmarks and find all face images for this user
      const analysis = await analyzeSkin(answerId);
      return res.json({ answerId, analysis });
    }

    // For direct image URLs: process landmarks from front image then analyze all images
    const landmarkResult = await processLandmarks(front_image_url!);
    if (!landmarkResult.success || !landmarkResult.data) {
      return res.status(500).json({ error: landmarkResult.error || 'landmark processing failed' });
    }

    const analysis = await analyzeWithLandmarks(
      front_image_url!, 
      landmarkResult.data, 
      left_image_url, 
      right_image_url
    );

    const imagesAnalyzed = ['front'];
    if (left_image_url) imagesAnalyzed.push('left');
    if (right_image_url) imagesAnalyzed.push('right');

    return res.json({ 
      front_image_url, 
      analysis, 
      landmarks: landmarkResult.data,
      images_analyzed: imagesAnalyzed
    });
  } catch (error) {
    console.error('vanalyse error', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'analysis failed' });
  }
});


