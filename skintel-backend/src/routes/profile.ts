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
 *     description: Retrieve user profile with facial landmarks, analysis, and basic info
 *     tags: [Profile]
 *     security:
 *       - BasicAuth: []
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
 *     responses:
 *       200:
 *         description: Profile deleted successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 */

router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { userId },
      include: {
        facialLandmarks: {
          include: {
            answer: {
              select: {
                questionId: true,
                screenId: true,
                type: true,
                value: true,
                status: true,
                savedAt: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        answers: {
          select: {
            answerId: true,
            questionId: true,
            screenId: true,
            type: true,
            value: true,
            status: true,
            savedAt: true
          },
          orderBy: { savedAt: 'desc' }
        },
        products: {
          select: {
            id: true,
            imageUrl: true,
            productData: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
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
      updated_at: user.updatedAt.toISOString(),
      facial_landmarks: user.facialLandmarks.map(landmark => ({
        answer_id: landmark.answerId,
        question_id: landmark.answer.questionId,
        screen_id: landmark.answer.screenId,
        landmarks: landmark.landmarks,
        analysis: landmark.analysis,
        status: landmark.status,
        processed_at: landmark.processedAt?.toISOString(),
        created_at: landmark.createdAt.toISOString(),
        error: landmark.error
      })),
      onboarding_answers: user.answers.map(answer => ({
        answer_id: answer.answerId,
        question_id: answer.questionId,
        screen_id: answer.screenId,
        type: answer.type,
        value: answer.value,
        status: answer.status,
        saved_at: answer.savedAt.toISOString()
      })),
      products: user.products.map(product => ({
        id: product.id,
        image_url: product.imageUrl,
        product_data: product.productData,
        created_at: product.createdAt.toISOString(),
        updated_at: product.updatedAt.toISOString()
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Get profile error:', error);
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