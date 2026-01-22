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
 *                 current_analysis:
 *                   $ref: '#/components/schemas/AnalysisResult'
 *                 progress_update:
 *                   type: object
 *                   description: Progress comparison data
 *                 landmarks:
 *                   type: object
 *                 images_analyzed:
 *                   type: array
 *                   items:
 *                     type: string
 *                 analysis_type:
 *                   type: string
 *                   enum: [PROGRESS]
 *                 initial_score:
 *                   type: number
 *                   description: Initial skin score
 *                 current_score:
 *                   type: number
 *                   description: Current skin score
 *                 estimated_improvement_score:
 *                   type: number
 *                   description: Target improvement score from initial analysis
 *                 estimated_weekly_scores:
 *                   type: object
 *                   description: Estimated weekly scores from initial analysis
 *                   properties:
 *                     week_1:
 *                       type: number
 *                     week_2:
 *                       type: number
 *                     week_3:
 *                       type: number
 *                     week_4:
 *                       type: number
 *                 updated_weekly_scores:
 *                   type: object
 *                   description: Updated weekly scores from current progress analysis
 *                   properties:
 *                     week_1:
 *                       type: number
 *                     week_2:
 *                       type: number
 *                     week_3:
 *                       type: number
 *                     week_4:
 *                       type: number
 *                 initial_analysis:
 *                   type: object
 *                   properties:
 *                     issues:
 *                       type: array
 *                     overall_assessment:
 *                       type: string
 *                 days_elapsed:
 *                   type: number
 *                 plan_start_date:
 *                   type: string
 *                 plan_end_date:
 *                   type: string
 *                 annotated_image_url:
 *                   type: string
 *                   format: uri
 *                   description: Presigned URL to the annotated front profile image with issue overlays
 *                   nullable: true
 *                 svg_overlays:
 *                   type: array
 *                   description: SVG overlays for each issue type, returned from facial landmarks service
 *                   items:
 *                     type: object
 *                     properties:
 *                       issue_type:
 *                         type: string
 *                         description: Type of skin issue (e.g., wrinkles, acne, dark_circles)
 *                       color:
 *                         type: string
 *                         description: Color code for the issue type overlay
 *                       svg_content:
 *                         type: string
 *                         description: SVG markup for rendering the overlay
 *                       issue_count:
 *                         type: number
 *                         description: Number of issues of this type
 *                 front_profile_url:
 *                   type: string
 *                   format: uri
 *                   description: Presigned URL to the original front profile image
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
