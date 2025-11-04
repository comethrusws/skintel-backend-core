import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { profileUpdateRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../utils/auth';

const router = Router();

/**
 * @swagger
 * /v1/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve basic user profile information
 *     tags: [Profile]
 *     security:
 *       - BasicAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 * 
 *   put:
 *     summary: Update user profile
 *     description: Update user profile information
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already exists
 * 
 *   delete:
 *     summary: Delete user profile
 *     description: Delete user account and all associated data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     responses:
 *       200:
 *         description: Profile deleted successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found

 * 
 * /v1/profile/analysis:
 *   get:
 *     summary: Get user facial analysis
 *     description: Retrieve user's facial analysis data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Analysis retrieved successfully
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/landmarks:
 *   get:
 *     summary: Get user facial landmarks
 *     description: Retrieve user's facial landmarks data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Landmarks retrieved successfully
 *       401:
 *         description: Authentication required
 * 
 */

router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { userId },
      select: {
        userId: true,
        email: true,
        ssoProvider: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response = {
      user_id: user.userId,
      email: user.email,
      sso_provider: user.ssoProvider,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString()
    };

    res.json(response);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/analysis', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const facialLandmarks = await prisma.facialLandmarks.findMany({
      where: { userId },
      include: {
        answer: {
          select: {
            questionId: true,
            screenId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const response = {
      user_id: userId,
      analysis: facialLandmarks.map(landmark => ({
        answer_id: landmark.answerId,
        question_id: landmark.answer.questionId,
        screen_id: landmark.answer.screenId,
        analysis: landmark.analysis ? 
          (typeof landmark.analysis === 'string' ? JSON.parse(landmark.analysis) : landmark.analysis) 
          : null,
        status: landmark.status,
        processed_at: landmark.processedAt?.toISOString(),
        created_at: landmark.createdAt.toISOString(),
        error: landmark.error
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Get profile analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/landmarks', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const facialLandmarks = await prisma.facialLandmarks.findMany({
      where: { userId },
      include: {
        answer: {
          select: {
            questionId: true,
            screenId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const response = {
      user_id: userId,
      landmarks: facialLandmarks.map(landmark => ({
        answer_id: landmark.answerId,
        question_id: landmark.answer.questionId,
        screen_id: landmark.answer.screenId,
        landmarks: landmark.landmarks,
        status: landmark.status,
        processed_at: landmark.processedAt?.toISOString(),
        created_at: landmark.createdAt.toISOString(),
        error: landmark.error
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Get profile landmarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const validationResult = profileUpdateRequestSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ 
        error: 'Invalid request data',
        details: validationResult.error.errors 
      });
      return;
    }

    const { email, password } = validationResult.data;

    const existingUser = await prisma.user.findUnique({
      where: { userId }
    });

    if (!existingUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email }
      });

      if (emailExists) {
        res.status(409).json({ error: 'Email already exists' });
        return;
      }
    }

    const updateData: any = {};
    
    if (email) {
      updateData.email = email;
    }
    
    if (password) {
      updateData.passwordHash = await hashPassword(password);
    }

    const updatedUser = await prisma.user.update({
      where: { userId },
      data: updateData,
      select: {
        userId: true,
        email: true,
        ssoProvider: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const response = {
      user_id: updatedUser.userId,
      email: updatedUser.email,
      sso_provider: updatedUser.ssoProvider,
      created_at: updatedUser.createdAt.toISOString(),
      updated_at: updatedUser.updatedAt.toISOString(),
      updated: true
    };

    res.json(response);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { userId }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await prisma.$transaction([
      prisma.refreshToken.deleteMany({
        where: { userId }
      }),
      prisma.product.deleteMany({
        where: { userId }
      }),
      prisma.facialLandmarks.deleteMany({
        where: { userId }
      }),
      prisma.onboardingAnswer.deleteMany({
        where: { userId }
      }),
      prisma.onboardingSession.deleteMany({
        where: { userId }
      }),
      prisma.user.delete({
        where: { userId }
      })
    ]);

    const response = {
      user_id: userId,
      deleted: true,
      deleted_at: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    console.error('Delete profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as profileRouter };