import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { profileUpdateRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../utils/auth';
import { ProgressAnalysisItem } from '../types';

const router = Router();

/**
 * @swagger
 * /v1/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve complete user profile information including name, phone, profile image, and date of birth
 *     tags: [Profile]
 *     security:
 *       - BasicAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 name:
 *                   type: string
 *                   nullable: true
 *                 phone_number:
 *                   type: string
 *                   nullable: true
 *                 date_of_birth:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 profile_image:
 *                   type: string
 *                   format: uri
 *                   nullable: true
 *                   description: Front face photo from onboarding
 *                 email:
 *                   type: string
 *                   format: email
 *                   nullable: true
 *                 sso_provider:
 *                   type: string
 *                   nullable: true
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 * 
 *   put:
 *     summary: Update user profile
 *     description: Update user profile information (only name and phone number can be updated)
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
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: "John Doe"
 *               phone_number:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 20
 *                 example: "+1234567890"
 *             minProperties: 1
 *             description: At least one field must be provided
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 name:
 *                   type: string
 *                   nullable: true
 *                 phone_number:
 *                   type: string
 *                   nullable: true
 *                 date_of_birth:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 profile_image:
 *                   type: string
 *                   format: uri
 *                   nullable: true
 *                 email:
 *                   type: string
 *                   format: email
 *                   nullable: true
 *                 sso_provider:
 *                   type: string
 *                   nullable: true
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                 updated:
 *                   type: boolean
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
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
 * /v1/profile/progress:
 *   get:
 *     summary: Get current 4-week plan progress
 *     description: Retrieve progress tracking data for the user's current active 4-week skin improvement plan
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Progress data retrieved successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No active plan found
 */

router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { userId },
      select: {
        userId: true,
        name: true,
        phoneNumber: true,
        dateOfBirth: true,
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

    let profileImage: string | undefined;
    const frontFaceAnswer = await prisma.onboardingAnswer.findFirst({
      where: {
        userId,
        questionId: 'q_face_photo_front',
        status: 'answered'
      },
      orderBy: { savedAt: 'desc' }
    });

    if (frontFaceAnswer && frontFaceAnswer.value) {
      const value = frontFaceAnswer.value as any;
      if (value.image_url) {
        profileImage = value.image_url;
      }
    }

    const response = {
      user_id: user.userId,
      name: user.name,
      phone_number: user.phoneNumber,
      date_of_birth: user.dateOfBirth?.toISOString(),
      profile_image: profileImage,
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
        score: landmark.score,
        weekly_plan: landmark.weeklyPlan ? 
          (typeof landmark.weeklyPlan === 'string' ? JSON.parse(landmark.weeklyPlan) : landmark.weeklyPlan) 
          : null,
        analysis_type: landmark.analysisType,
        plan_start_date: landmark.planStartDate?.toISOString(),
        plan_end_date: landmark.planEndDate?.toISOString(),
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

    const { name, phone_number } = validationResult.data;

    const existingUser = await prisma.user.findUnique({
      where: { userId }
    });

    if (!existingUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updateData: any = {};
    
    if (name !== undefined) {
      updateData.name = name;
    }
    
    if (phone_number !== undefined) {
      updateData.phoneNumber = phone_number;
    }

    const updatedUser = await prisma.user.update({
      where: { userId },
      data: updateData,
      select: {
        userId: true,
        name: true,
        phoneNumber: true,
        dateOfBirth: true,
        email: true,
        ssoProvider: true,
        createdAt: true,
        updatedAt: true
      }
    });

    let profileImage: string | undefined;
    const frontFaceAnswer = await prisma.onboardingAnswer.findFirst({
      where: {
        userId,
        questionId: 'q_face_photo_front',
        status: 'answered'
      },
      orderBy: { savedAt: 'desc' }
    });

    if (frontFaceAnswer && frontFaceAnswer.value) {
      const value = frontFaceAnswer.value as any;
      if (value.image_url) {
        profileImage = value.image_url;
      }
    }

    const response = {
      user_id: updatedUser.userId,
      name: updatedUser.name,
      phone_number: updatedUser.phoneNumber,
      date_of_birth: updatedUser.dateOfBirth?.toISOString(),
      profile_image: profileImage,
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

router.get('/progress', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const currentPlan = await prisma.facialLandmarks.findFirst({
      where: { 
        userId,
        planStartDate: { not: null },
        planEndDate: { not: null }
      },
      orderBy: { planStartDate: 'desc' }
    });

    if (!currentPlan || !currentPlan.planStartDate || !currentPlan.planEndDate) {
      res.json({
        user_id: userId,
        has_active_plan: false,
        progress_analyses: [],
        total_analyses_in_period: 0
      });
      return;
    }

    const now = new Date();
    const isActivePlan = now <= currentPlan.planEndDate;
    
    const planStartDate = currentPlan.planStartDate;
    const planEndDate = currentPlan.planEndDate;

    const planAnalyses = await prisma.facialLandmarks.findMany({
      where: {
        userId,
        planStartDate: planStartDate,
        planEndDate: planEndDate,
        status: 'COMPLETED'
      },
      include: {
        answer: {
          select: {
            questionId: true,
            screenId: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const initialAnalysis = planAnalyses.find(a => a.analysisType === 'INITIAL');
    const progressAnalyses = planAnalyses.filter(a => a.analysisType === 'PROGRESS');

    const daysSincePlanStart = Math.floor(
      (now.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysRemaining = Math.max(0, Math.floor(
      (planEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    ));

    const daysSinceLastAnalysis = planAnalyses.length > 0 
      ? Math.floor((now.getTime() - planAnalyses[planAnalyses.length - 1].createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    const nextRecommendedDays = 7 - (daysSinceLastAnalysis % 7);
    const nextRecommendedDate = new Date();
    nextRecommendedDate.setDate(nextRecommendedDate.getDate() + (daysSinceLastAnalysis >= 7 ? 0 : nextRecommendedDays));

    const latestAnalysis = planAnalyses[planAnalyses.length - 1];
    const scoreImprovement = (initialAnalysis?.score && latestAnalysis?.score) 
      ? latestAnalysis.score - initialAnalysis.score 
      : undefined;

    const formatAnalysisItem = (analysis: any, planStartDate: Date): ProgressAnalysisItem => ({
      answer_id: analysis.answerId,
      question_id: analysis.answer.questionId,
      screen_id: analysis.answer.screenId,
      analysis: analysis.analysis ? 
        (typeof analysis.analysis === 'string' ? JSON.parse(analysis.analysis) : analysis.analysis) 
        : null,
      score: analysis.score,
      weekly_plan: analysis.weeklyPlan ? 
        (typeof analysis.weeklyPlan === 'string' ? JSON.parse(analysis.weeklyPlan) : analysis.weeklyPlan) 
        : null,
      analysis_type: analysis.analysisType,
      created_at: analysis.createdAt.toISOString(),
      days_since_initial: Math.floor(
        (analysis.createdAt.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    });

    const response = {
      user_id: userId,
      has_active_plan: isActivePlan,
      plan_start_date: planStartDate.toISOString(),
      plan_end_date: planEndDate.toISOString(),
      days_remaining: isActivePlan ? daysRemaining : 0,
      days_elapsed: daysSincePlanStart,
      initial_analysis: initialAnalysis ? formatAnalysisItem(initialAnalysis, planStartDate) : undefined,
      progress_analyses: progressAnalyses.map(a => formatAnalysisItem(a, planStartDate)),
      latest_score: latestAnalysis?.score,
      score_improvement: scoreImprovement,
      total_analyses_in_period: planAnalyses.length,
      next_recommended_analysis: isActivePlan ? nextRecommendedDate.toISOString() : undefined
    };

    res.json(response);
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as profileRouter };