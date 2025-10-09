import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { getUserLandmarks } from '../services/landmarks';

const router = Router();

/**
 * @swagger
 * /v1/landmarks/user:
 *   get:
 *     summary: Get user's facial landmarks
 *     description: Retrieve all processed facial landmarks for the authenticated user
 *     tags: [Landmarks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Landmarks retrieved successfully
 *       401:
 *         description: Authentication required
 */
router.get('/user', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const landmarks = await getUserLandmarks(userId);
    
    res.json({
      user_id: userId,
      landmarks: landmarks.map(landmark => ({
        answer_id: landmark.answerId,
        question_id: landmark.answer.questionId,
        screen_id: landmark.answer.screenId,
        landmarks: landmark.landmarks,
        status: landmark.status,
        processed_at: landmark.processedAt?.toISOString(),
        created_at: landmark.createdAt.toISOString()
      }))
    });
  } catch (error) {
    console.error('Get user landmarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as landmarksRouter };
