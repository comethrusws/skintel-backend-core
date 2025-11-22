import { Router, Response } from 'express';
import { processLandmarks } from '../services/landmarks';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { maybePresignUrl, uploadImageToS3 } from '../lib/s3';
import { z } from 'zod';
import axios from 'axios';
import { generateTasksForUser } from '../services/tasks';

export const vanalyseRouter = Router();

const progressAnalysisSchema = z.object({
  front_image_url: z.string().url('Must be a valid URL'),
  left_image_url: z.string().url('Must be a valid URL').optional(),
  right_image_url: z.string().url('Must be a valid URL').optional()
});

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
    const validationResult = progressAnalysisSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
    }

    const { front_image_url, left_image_url, right_image_url } = validationResult.data;
    const userId = req.userId!;

    const [activePlan, presignedUrls, landmarkResult] = await Promise.all([
      prisma.facialLandmarks.findFirst({
        where: {
          userId,
          planStartDate: { not: null },
          planEndDate: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
      }),

      Promise.all([
        maybePresignUrl(front_image_url, 300),
        left_image_url ? maybePresignUrl(left_image_url, 300) : Promise.resolve(null),
        right_image_url ? maybePresignUrl(right_image_url, 300) : Promise.resolve(null)
      ]).then(([front, left, right]) => ({ front, left, right })),

      processLandmarks(front_image_url)
    ]);

    if (!activePlan) {
      return res.status(400).json({
        error: 'No active improvement plan found. Complete initial analysis first.'
      });
    }

    if (!landmarkResult.success || !landmarkResult.data) {
      return res.status(500).json({
        error: landmarkResult.error || 'Landmark processing failed'
      });
    }

    const initialAnalysis = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        analysisType: 'INITIAL',
        planStartDate: activePlan.planStartDate,
        planEndDate: activePlan.planEndDate,
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'asc' }
    });

    if (!initialAnalysis || !initialAnalysis.analysis || !initialAnalysis.weeklyPlan) {
      return res.status(400).json({
        error: 'Initial analysis data not found. Cannot compare progress.'
      });
    }

    const initialAnalysisData = typeof initialAnalysis.analysis === 'string'
      ? JSON.parse(initialAnalysis.analysis)
      : initialAnalysis.analysis;

    const initialWeeklyPlan = typeof initialAnalysis.weeklyPlan === 'string'
      ? JSON.parse(initialAnalysis.weeklyPlan)
      : initialAnalysis.weeklyPlan;

    const daysElapsed = Math.floor(
      (new Date().getTime() - initialAnalysis.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const answerId = `progress_${Date.now()}_${userId.slice(-6)}`;

    await prisma.$transaction([
      prisma.onboardingAnswer.create({
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
      }),
      prisma.facialLandmarks.create({
        data: {
          answerId,
          userId,
          landmarks: landmarkResult.data as unknown as any,
          analysis: {},
          status: 'PROCESSING',
          processedAt: new Date(),
          analysisType: 'PROGRESS',
          planStartDate: activePlan.planStartDate,
          planEndDate: activePlan.planEndDate,
          weeklyPlan: {},
        }
      })
    ]);

    const [currentAnalysis, progressUpdate] = await Promise.all([
      analyzeWithLandmarksOptimized(
        presignedUrls.front,
        landmarkResult.data,
        presignedUrls.left,
        presignedUrls.right
      ),

      analyzeProgressOptimized(
        presignedUrls,
        landmarkResult.data,
        initialAnalysisData,
        initialAnalysis.score || 0,
        initialWeeklyPlan,
        daysElapsed,
        userId,
        answerId
      )
    ]);

    if (progressUpdate && typeof progressUpdate === 'object' && 'score_change' in progressUpdate) {
      const currentScore = currentAnalysis.score || 0;
      const initialScore = initialAnalysis.score || 0;
      progressUpdate.score_change = currentScore - initialScore;
      progressUpdate.overall_progress_score = currentScore;
    }

    await prisma.facialLandmarks.update({
      where: { answerId },
      data: {
        analysis: currentAnalysis,
        progressUpdate: progressUpdate ?? null,
        status: 'COMPLETED',
        score: currentAnalysis.score || null,
        weeklyPlan: currentAnalysis.care_plan_4_weeks as any,
      }
    });

    try {
      const userProducts = await prisma.product.findMany({
        where: { userId },
        select: {
          id: true,
          productData: true
        }
      });

      const formattedProducts = userProducts.map(p => {
        const data = p.productData as any;
        return {
          id: p.id,
          category: data?.category || 'unknown',
          name: data?.product_name || 'Unknown Product',
          ingredients: data?.ingredients
        };
      });

      await generateTasksForUser({
        userId,
        weeklyPlan: currentAnalysis.care_plan_4_weeks,
        userProducts: formattedProducts,
        force: true
      });

    } catch (taskError) {
      console.error('Failed to regenerate tasks after progress analysis:', taskError);
    }

    const imagesAnalyzed = ['front'];
    if (left_image_url) imagesAnalyzed.push('left');
    if (right_image_url) imagesAnalyzed.push('right');

    return res.json({
      answer_id: answerId,
      current_analysis: currentAnalysis,
      progress_update: progressUpdate,
      landmarks: landmarkResult.data,
      images_analyzed: imagesAnalyzed,
      analysis_type: 'PROGRESS',
      days_elapsed: daysElapsed,
      plan_start_date: activePlan.planStartDate?.toISOString(),
      plan_end_date: activePlan.planEndDate?.toISOString(),
      initial_score: initialAnalysis.score,
      current_score: currentAnalysis.score
    });

  } catch (error) {
    console.error('Progress analysis error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Progress analysis failed'
    });
  }
});

async function analyzeWithLandmarksOptimized(
  frontPresignedUrl: string,
  landmarks: object,
  leftPresignedUrl?: string | null,
  rightPresignedUrl?: string | null
) {
  const { buildPrompt, openai, OPENAI_MODEL } = await import('../services/analysis');

  const imageContent: any[] = [];
  const availableImages: string[] = [];

  imageContent.push({ type: 'image_url', image_url: { url: frontPresignedUrl } });
  availableImages.push('front');

  if (leftPresignedUrl) {
    imageContent.push({ type: 'image_url', image_url: { url: leftPresignedUrl } });
    availableImages.push('left');
  }

  if (rightPresignedUrl) {
    imageContent.push({ type: 'image_url', image_url: { url: rightPresignedUrl } });
    availableImages.push('right');
  }

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: buildPrompt() },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze these face images (${availableImages.join(', ')}) with facial landmarks for comprehensive skin analysis.`
          },
          ...imageContent,
          { type: 'text', text: `Landmarks: ${JSON.stringify(landmarks)}` }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

async function analyzeProgressOptimized(
  presignedUrls: { front: string; left: string | null; right: string | null },
  currentLandmarks: object,
  initialAnalysis: any,
  initialScore: number,
  weeklyPlan: any[],
  daysElapsed: number,
  userId: string,
  answerId: string
) {
  const { buildProgressPrompt, openai, OPENAI_MODEL } = await import('../services/analysis');

  const imageContent: any[] = [];
  const availableImages: string[] = [];

  imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.front } });
  availableImages.push('front');

  if (presignedUrls.left) {
    imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.left } });
    availableImages.push('left');
  }

  if (presignedUrls.right) {
    imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.right } });
    availableImages.push('right');
  }

  const weeksElapsed = Math.floor(daysElapsed / 7);
  const currentWeekPlan = weeklyPlan[Math.min(weeksElapsed, weeklyPlan.length - 1)];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: buildProgressPrompt() },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze progress in these current images (${availableImages.join(', ')}) compared to initial analysis and return your response in JSON.`
          },
          ...imageContent,
          {
            type: 'text',
            text: `Current landmarks: ${JSON.stringify(currentLandmarks)}\n` +
              `Initial analysis: ${JSON.stringify(initialAnalysis)}\n` +
              `Initial score: ${initialScore}\n` +
              `Weekly plan: ${JSON.stringify(weeklyPlan)}\n` +
              `Days elapsed: ${daysElapsed}\n` +
              `Current week plan: ${JSON.stringify(currentWeekPlan)}`
          }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  let parsed: any;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { raw: content };
  }

  if (parsed.remaining_issues && parsed.remaining_issues.length > 0 && presignedUrls.front) {
    generateAnnotatedImageBackground(presignedUrls.front, parsed.remaining_issues, userId, answerId).catch(err => {
      console.error('Background annotation failed:', err);
    });
  }

  return { ...parsed, annotatedImageUrl: null };
}

async function generateAnnotatedImageBackground(
  imageUrl: string,
  issues: any[],
  userId: string,
  answerId: string
) {
  try {
    const microserviceUrl = process.env.LANDMARK_URL || 'http://localhost:8000';

    const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
      image_url: imageUrl,
      issues: issues
    });

    if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
      const uploadResult = await uploadImageToS3({
        imageBase64: annotationResponse.data.annotated_image,
        prefix: 'annotated-issues-progress'
      });

      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          annotatedImageUrl: uploadResult.url
        }
      });

      console.log(`[Background] Annotated image updated for answer ${answerId}`);
    }
  } catch (annotationError) {
    console.error('Failed to generate annotated image in background:', annotationError);
  }
}


