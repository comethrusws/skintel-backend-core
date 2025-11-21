import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { profileUpdateRequestSchema, profileQuestionsAnswerRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getTaskProgress } from '../services/tasks';
import { maybePresignUrl } from '../lib/s3';
import { PROFILE_QUESTIONS, PROFILE_SCREEN_ID, getProfileQuestion, validateProfileQuestionValue } from '../lib/profileQuestions';

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
 *                 gender:
 *                   type: string
 *                   nullable: true
 *                 skin_score:
 *                   type: number
 *                   nullable: true
 *                   description: Latest skin analysis score (0-100)
 *                 score_change:
 *                   type: number
 *                   description: Change in skin score from previous analysis
 *                 tasks_score:
 *                   type: number
 *                   nullable: true
 *                   description: Current skincare tasks completion score (0-100)
 *                 tasks_count:
 *                   type: object
 *                   properties:
 *                     completed:
 *                       type: number
 *                     total:
 *                       type: number
 *                 plan_details:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [MONTHLY, WEEKLY]
 *                 total_products_in_use:
 *                   type: number
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
 *                 skin_score:
 *                   type: number
 *                   nullable: true
 *                   description: Latest skin analysis score (0-100)
 *                 tasks_score:
 *                   type: number
 *                   nullable: true
 *                   description: Current skincare tasks completion score (0-100)
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
 * /v1/profile/weekly:
 *   get:
 *     summary: Get user's weekly progress info
 *     description: Retrieve the most recent weekly progress for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Weekly plan retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 analysis_type:
 *                   type: string
 *                   enum: [INITIAL, PROGRESS]
 *                 skin_score:
 *                   type: number
 *                 tasks_score:
 *                   type: number
 *                 tasks_missing:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       category:
 *                         type: string
 *                       priority:
 *                         type: string
 *                 improvements:
 *                   type: array
 *                   items:
 *                     type: string
 *                 plan_start_date:
 *                   type: string
 *                   format: date-time
 *                 plan_end_date:
 *                   type: string
 *                   format: date-time
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No weekly plan found
 * 
 * /v1/profile/onboarding-status:
 *   get:
 *     summary: Get user onboarding status
 *     description: Check the current onboarding status and progress for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     responses:
 *       200:
 *         description: Onboarding status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 onboarding_status:
 *                   type: string
 *                   enum: [not_started, in_progress, completed, skipped]
 *                 answers_count:
 *                   type: number
 *                   description: Total number of answered questions
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was started
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was last updated
 *                 completed_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was completed (if status is completed)
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/annotated-image:
 *   get:
 *     summary: Get user annotated image
 *     description: Retrieve the latest annotated image URL for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Annotated image retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 annotated_image_url:
 *                   type: string
 *                   format: uri
 *                   description: Presigned URL for the annotated image
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No annotated image found
 * 
 * /v1/profile/questions:
 *   get:
 *     summary: Get profile questions with status
 *     description: Retrieve all profile questions for "Tell Us A Bit More About You" section with their current status (answered/skipped/new)
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile questions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 questions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       question_id:
 *                         type: string
 *                       question_text:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [single, slider]
 *                       status:
 *                         type: string
 *                         enum: [answered, skipped, new]
 *                       value:
 *                         oneOf:
 *                           - type: string
 *                           - type: number
 *                           - type: 'null'
 *                       options:
 *                         type: array
 *                         items:
 *                           type: string
 *                       min_value:
 *                         type: number
 *                       max_value:
 *                         type: number
 *                       default_value:
 *                         type: number
 *                       saved_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/questions/answer:
 *   post:
 *     summary: Save profile question answers
 *     description: Save or update answers to profile questions
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
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     question_id:
 *                       type: string
 *                     value:
 *                       oneOf:
 *                         - type: string
 *                         - type: number
 *                         - type: 'null'
 *                     status:
 *                       type: string
 *                       enum: [answered, skipped]
 *             required:
 *               - answers
 *     responses:
 *       200:
 *         description: Answers saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 saved:
 *                   type: boolean
 *                 answers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       question_id:
 *                         type: string
 *                       saved:
 *                         type: boolean
 *                       saved_at:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
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
        planType: true,
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
        profileImage = await maybePresignUrl(value.image_url, 86400);
      }
    }

    const genderAnswer = await prisma.onboardingAnswer.findFirst({
      where: {
        userId,
        questionId: 'q_profile_gender',
        status: 'answered'
      },
      orderBy: { savedAt: 'desc' }
    });
    const gender = genderAnswer?.value as string | undefined;

    const totalProducts = await prisma.product.count({
      where: { userId }
    });

    let skinScore: number | null = null;
    let scoreChange: number = 0;

    const landmarks = await prisma.facialLandmarks.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        score: { not: null }
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { score: true }
    });

    if (landmarks.length > 0) {
      skinScore = landmarks[0].score;
      if (landmarks.length > 1 && landmarks[0].score !== null && landmarks[1].score !== null) {
        scoreChange = landmarks[0].score - landmarks[1].score;
      }
    }

    let tasksScore: number | null = null;
    let tasksCount = { completed: 0, total: 0 };

    try {
      const taskProgress = await getTaskProgress(userId);
      tasksScore = taskProgress.overallScore;
      tasksCount = {
        completed: taskProgress.totalTasksCompleted,
        total: taskProgress.totalTasksPossible
      };
    } catch (error) {
      console.log('No task progress found for user:', userId);
    }

    const response = {
      user_id: user.userId,
      name: user.name,
      phone_number: user.phoneNumber,
      date_of_birth: user.dateOfBirth?.toISOString(),
      profile_image: profileImage,
      email: user.email,
      sso_provider: user.ssoProvider,
      gender,
      skin_score: skinScore,
      score_change: scoreChange,
      tasks_score: tasksScore,
      tasks_count: tasksCount,
      plan_details: {
        type: user.planType
      },
      total_products_in_use: totalProducts,
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

router.get('/annotated-image', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const latestLandmark = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        annotatedImageUrl: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestLandmark || !latestLandmark.annotatedImageUrl) {
      res.status(404).json({ error: 'No annotated image found' });
      return;
    }

    const presignedUrl = await maybePresignUrl(latestLandmark.annotatedImageUrl, 86400);

    res.json({
      user_id: userId,
      annotated_image_url: presignedUrl,
      created_at: latestLandmark.createdAt
    });
  } catch (error) {
    console.error('Get annotated image error:', error);
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
        profileImage = await maybePresignUrl(value.image_url, 300);
      }
    }

    let skinScore: number | null = null;
    const latestAnalysis = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        score: { not: null }
      },
      orderBy: { createdAt: 'desc' },
      select: { score: true }
    });

    if (latestAnalysis) {
      skinScore = latestAnalysis.score;
    }

    let tasksScore: number | null = null;
    try {
      const taskProgress = await getTaskProgress(userId);
      tasksScore = taskProgress.overallScore;
    } catch (error) {
      console.log('No task progress found for user:', userId);
    }

    const response = {
      user_id: updatedUser.userId,
      name: updatedUser.name,
      phone_number: updatedUser.phoneNumber,
      date_of_birth: updatedUser.dateOfBirth?.toISOString(),
      profile_image: profileImage,
      email: updatedUser.email,
      sso_provider: updatedUser.ssoProvider,
      skin_score: skinScore,
      tasks_score: tasksScore,
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


router.get('/onboarding-status', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const onboardingSession = await prisma.onboardingSession.findUnique({
      where: { userId }
    });

    let onboardingStatus = 'not_started';
    let answersCount = 0;
    let createdAt: string | null = null;
    let updatedAt: string | null = null;
    let completedAt: string | null = null;

    if (onboardingSession) {
      onboardingStatus = onboardingSession.status;
      createdAt = onboardingSession.createdAt.toISOString();
      updatedAt = onboardingSession.updatedAt.toISOString();

      if (onboardingSession.status === 'completed') {
        completedAt = onboardingSession.updatedAt.toISOString();
      }

      const answers = await prisma.onboardingAnswer.count({
        where: {
          userId,
          status: 'answered'
        }
      });
      answersCount = answers;
    }

    const response = {
      user_id: userId,
      onboarding_status: onboardingStatus,
      answers_count: answersCount,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: completedAt
    };

    res.json(response);
  } catch (error) {
    console.error('Get onboarding status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/weekly', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const facialLandmark = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        weeklyPlan: { not: Prisma.DbNull }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!facialLandmark) {
      res.status(404).json({ error: 'No weekly plan found' });
      return;
    }

    const weeklyPlan = facialLandmark.weeklyPlan ?
      (typeof facialLandmark.weeklyPlan === 'string' ? JSON.parse(facialLandmark.weeklyPlan) : facialLandmark.weeklyPlan)
      : null;

    let tasksScore = 0;
    let tasksMissing: any[] = [];
    let tasksCompleted: any[] = [];

    if (facialLandmark.planStartDate) {
      const today = new Date();
      const planStart = facialLandmark.planStartDate;
      const daysSinceStart = Math.floor((today.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);

      const weekTasks = await prisma.task.findMany({
        where: {
          userId,
          week: currentWeek,
          isActive: true
        }
      });

      const weekStart = new Date(planStart);
      weekStart.setDate(weekStart.getDate() + (currentWeek - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekCompletions = await prisma.taskCompletion.findMany({
        where: {
          userId,
          taskId: { in: weekTasks.map(t => t.id) },
          completedAt: {
            gte: weekStart,
            lte: weekEnd
          }
        }
      });

      const completedTaskIds = new Set(weekCompletions.map(c => c.taskId));

      let totalWeight = 0;
      let weightedScore = 0;

      weekTasks.forEach(task => {
        const weight = task.priority === 'critical' ? 3 : task.priority === 'important' ? 2 : 1;
        totalWeight += weight;

        const isCompleted = completedTaskIds.has(task.id);
        if (isCompleted) {
          weightedScore += weight * 100;
          tasksCompleted.push({
            id: task.id,
            title: task.title,
            category: task.category,
            priority: task.priority
          });
        } else {
          tasksMissing.push({
            id: task.id,
            title: task.title,
            category: task.category,
            priority: task.priority
          });
        }
      });

      tasksScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
    }

    let improvements: string[] = [];
    if (facialLandmark.analysisType === 'PROGRESS') {
      const analysis = facialLandmark.analysis ?
        (typeof facialLandmark.analysis === 'string' ? JSON.parse(facialLandmark.analysis) : facialLandmark.analysis) as any
        : null;

      if (analysis && analysis.visual_improvements) {
        improvements = analysis.visual_improvements;
      }
    }

    const response = {
      user_id: userId,
      analysis_type: facialLandmark.analysisType,
      skin_score: facialLandmark.score,
      tasks_score: tasksScore,
      tasks_missing: tasksMissing,
      improvements: improvements,
      plan_start_date: facialLandmark.planStartDate?.toISOString(),
      plan_end_date: facialLandmark.planEndDate?.toISOString(),
      created_at: facialLandmark.createdAt.toISOString(),
    };

    res.json(response);
  } catch (error) {
    console.error('Get weekly plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/questions', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const savedAnswers = await prisma.onboardingAnswer.findMany({
      where: {
        userId,
        screenId: PROFILE_SCREEN_ID,
      },
      orderBy: { savedAt: 'desc' },
    });

    const answerMap = new Map();
    savedAnswers.forEach(answer => {
      if (!answerMap.has(answer.questionId)) {
        answerMap.set(answer.questionId, answer);
      }
    });

    const questions = PROFILE_QUESTIONS.map(question => {
      const savedAnswer = answerMap.get(question.question_id);

      const questionResponse: any = {
        question_id: question.question_id,
        question_text: question.question_text,
        type: question.type,
        status: savedAnswer ? savedAnswer.status : 'new',
        value: savedAnswer ? savedAnswer.value : null,
      };

      if (question.type === 'single' && question.options) {
        questionResponse.options = question.options;
      } else if (question.type === 'slider') {
        questionResponse.min_value = question.min_value;
        questionResponse.max_value = question.max_value;
        questionResponse.default_value = question.default_value;
      }

      if (savedAnswer) {
        questionResponse.saved_at = savedAnswer.savedAt.toISOString();
      }

      return questionResponse;
    });

    answerMap.forEach((answer, questionId) => {
      const isPredefined = PROFILE_QUESTIONS.some(q => q.question_id === questionId);
      if (!isPredefined) {
        questions.push({
          question_id: questionId,
          question_text: questionId, 
          type: answer.type,
          status: answer.status,
          value: answer.value,
          saved_at: answer.savedAt.toISOString(),
        });
      }
    });

    res.json({
      user_id: userId,
      questions,
    });
  } catch (error) {
    console.error('Get profile questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/questions/answer', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const validationResult = profileQuestionsAnswerRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { answers } = validationResult.data;
    const savedAnswers = [];
    const now = new Date();

    for (const answer of answers) {
      const { question_id, value, status } = answer;

      const question = getProfileQuestion(question_id);

      if (status === 'answered' && value !== null && question) {
        const isValid = validateProfileQuestionValue(question_id, value);
        if (!isValid) {
          res.status(400).json({
            error: `Invalid value for question ${question_id}`,
            details: {
              question_id,
              value,
              expected_type: question.type,
              ...(question.type === 'single' && { valid_options: question.options }),
              ...(question.type === 'slider' && {
                min_value: question.min_value,
                max_value: question.max_value
              })
            }
          });
          return;
        }
      }

      if (status === 'answered' && value !== null && !question) {
        if (typeof value !== 'string' && typeof value !== 'number') {
          res.status(400).json({
            error: `Invalid value type for question ${question_id}. Must be string or number.`,
            details: {
              question_id,
              value,
              received_type: typeof value
            }
          });
          return;
        }
      }

      const answerId = `ans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      let answerType: 'single' | 'slider' | 'derived';
      if (question) {
        answerType = question.type === 'single' ? 'single' : 'slider';
      } else {
        answerType = 'derived';
      }

      const existingAnswer = await prisma.onboardingAnswer.findFirst({
        where: {
          userId,
          questionId: question_id,
          screenId: PROFILE_SCREEN_ID,
        },
        orderBy: { savedAt: 'desc' },
      });

      if (existingAnswer) {
        await prisma.onboardingAnswer.update({
          where: { answerId: existingAnswer.answerId },
          data: {
            value: value as any,
            status: status as any,
            savedAt: now,
          },
        });

        savedAnswers.push({
          question_id,
          saved: true,
          saved_at: now.toISOString(),
        });
      } else {
        // Create new answer
        await prisma.onboardingAnswer.create({
          data: {
            answerId,
            userId,
            screenId: PROFILE_SCREEN_ID,
            questionId: question_id,
            type: answerType,
            value: value as any,
            status: status as any,
            savedAt: now,
          },
        });

        savedAnswers.push({
          question_id,
          saved: true,
          saved_at: now.toISOString(),
        });
      }
    }

    res.json({
      user_id: userId,
      saved: true,
      answers: savedAnswers,
    });
  } catch (error) {
    console.error('Save profile questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as profileRouter };