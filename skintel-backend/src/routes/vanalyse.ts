import { Router, Request, Response } from 'express';
import { analyzeSkin, analyzeWithLandmarks } from '../services/analysis';
import { processLandmarks } from '../services/landmarks';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

export const vanalyseRouter = Router();


/**
 * @swagger
 * /v1/vanalyse/progress:
 *   post:
 *     summary: Run progress face analysis
 *     description: Analyzes face images for progress tracking within an active 4-week improvement plan. Requires authentication and existing active plan.
 *     tags: [Analysis]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               front_image_url:
 *                 type: string
 *                 format: uri
 *                 description: URL to front face image (required)
 *               left_image_url:
 *                 type: string
 *                 format: uri
 *                 description: URL to left profile image (optional)
 *               right_image_url:
 *                 type: string
 *                 format: uri
 *                 description: URL to right profile image (optional)
 *             required:
 *               - front_image_url
 *     responses:
 *       200:
 *         description: Progress analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer_id:
 *                   type: string
 *                 analysis:
 *                   type: object
 *                 landmarks:
 *                   type: object
 *                 images_analyzed:
 *                   type: array
 *                   items:
 *                     type: string
 *                 analysis_type:
 *                   type: string
 *                   enum: [PROGRESS]
 *       400:
 *         description: Missing required data or no active plan
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Analysis processing failed
 */
vanalyseRouter.post('/progress', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { front_image_url, left_image_url, right_image_url } = req.body as {
      front_image_url?: string;
      left_image_url?: string;
      right_image_url?: string;
    };

    if (!front_image_url) {
      return res.status(400).json({ error: 'front_image_url is required' });
    }

    const activePlan = await prisma.facialLandmarks.findFirst({
      where: { 
        userId,
        planStartDate: { not: null },
        planEndDate: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!activePlan) {
      return res.status(400).json({ 
        error: 'No active improvement plan found. Complete initial analysis first.' 
      });
    }

    const landmarkResult = await processLandmarks(front_image_url);
    if (!landmarkResult.success || !landmarkResult.data) {
      return res.status(500).json({ 
        error: landmarkResult.error || 'Landmark processing failed' 
      });
    }

    const analysis = await analyzeWithLandmarks(
      front_image_url,
      landmarkResult.data,
      left_image_url,
      right_image_url
    );

    const answerId = `progress_${Date.now()}_${userId.slice(-6)}`;
    await prisma.onboardingAnswer.create({
      data: {
        answerId,
        userId,
        sessionId: null,
        screenId: 'progress_analysis',
        questionId: 'q_face_photo_front',
        type: 'image',
        value: { image_url: front_image_url },
        status: 'answered'
      }
    });

    await prisma.facialLandmarks.create({
      data: {
        answerId,
        userId,
        landmarks: landmarkResult.data as unknown as any,
        analysis: analysis,
        status: 'COMPLETED',
        processedAt: new Date(),
        analysisType: 'PROGRESS',
        planStartDate: activePlan.planStartDate,
        planEndDate: activePlan.planEndDate,
        score: analysis.score || null,
        weeklyPlan: analysis.weekly_plan || null
      }
    });

    const imagesAnalyzed = ['front'];
    if (left_image_url) imagesAnalyzed.push('left');
    if (right_image_url) imagesAnalyzed.push('right');

    return res.json({
      answer_id: answerId,
      analysis,
      landmarks: landmarkResult.data,
      images_analyzed: imagesAnalyzed,
      analysis_type: 'PROGRESS',
      plan_start_date: activePlan.planStartDate?.toISOString(),
      plan_end_date: activePlan.planEndDate?.toISOString()
    });

  } catch (error) {
    console.error('Progress analysis error:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Progress analysis failed' 
    });
  }
});


