import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { VanalyseService } from '../services/vanalyse';

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
vanalyseRouter.post('/progress', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = progressAnalysisSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await VanalyseService.analyzeProgress(req.userId!, validationResult.data);
  res.json(response);
}));
