import { Router, Request, Response } from 'express';
import { OnboardingResponse, OnboardingStateResponse } from '../types';
import { authenticateSession, authenticateSessionOptional, AuthenticatedRequest } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { onboardingRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';
import { processLandmarksAsync, processLandmarksForAnswerWithUrl } from '../services/landmarks';

const router = Router();

/**
 * @swagger
 * /v1/onboarding:
 *   put:
 *     summary: Save onboarding answers
 *     description: Save user answers for onboarding questions with idempotency support
 *     tags: [Onboarding]
 *     security:
 *       - SessionToken: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optional idempotency key to prevent duplicate requests
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               session_id:
 *                 type: string
 *               answers:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/OnboardingAnswer'
 *               screen_completed:
 *                 type: boolean
 *             required:
 *               - session_id
 *               - answers
 *     responses:
 *       200:
 *         description: Answers saved successfully
 *       400:
 *         description: Invalid request or session ID mismatch
 *       404:
 *         description: Session not found or expired
 *   get:
 *     summary: Get onboarding state
 *     description: Retrieve saved answers for a session
 *     tags: [Onboarding]
 *     security:
 *       - SessionToken: []
 *     parameters:
 *       - in: query
 *         name: session_id
 *         schema:
 *           type: string
 *         description: Session ID (optional, uses authenticated session if not provided)
 *     responses:
 *       200:
 *         description: Onboarding state retrieved successfully
 *       400:
 *         description: Session ID mismatch
 *       404:
 *         description: Session not found or expired
 */

router.put('/', idempotencyMiddleware, authenticateSession, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validationResult = onboardingRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { session_id, answers, screen_completed } = validationResult.data;
    const sessionId = req.sessionId!;
    const idempotencyKey = (req as any).idempotencyKey;

    if (session_id !== sessionId) {
      res.status(400).json({ error: 'Session ID mismatch' });
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId },
      include: { answers: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const responseAnswers = [];
    const now = new Date();

    // Process each answer
    for (const answer of answers) {
      const existingAnswer = await prisma.onboardingAnswer.findUnique({
        where: { answerId: answer.answer_id },
      });

      if (existingAnswer) {
        await prisma.onboardingAnswer.update({
          where: { answerId: answer.answer_id },
          data: {
            screenId: answer.screen_id,
            questionId: answer.question_id,
            type: answer.type,
            value: answer.value as any,
            status: answer.status,
            savedAt: now,
          },
        });
      } else {
        await prisma.onboardingAnswer.create({
          data: {
            answerId: answer.answer_id,
            sessionId,
            screenId: answer.screen_id,
            questionId: answer.question_id,
            type: answer.type,
            value: answer.value as any,
            status: answer.status,
            savedAt: now,
          },
        });
      }

      // process facial landmarks for image questions
      if (answer.type === 'image' && answer.status === 'answered' &&
        typeof answer.value === 'object' && answer.value !== null &&
        ('image_id' in answer.value || 'image_url' in answer.value)) {

        //  front face image only goes for landmark
        if (answer.question_id === 'q_face_photo_front') {
          if ('image_id' in (answer.value as any)) {
            const imageValue = answer.value as { image_id: string };
            console.log(`Triggering landmark processing for front face: ${imageValue.image_id}`);
            processLandmarksAsync(answer.answer_id, imageValue.image_id).catch(error => {
              console.error('Async landmark processing error:', error);
            });
          } else if ('image_url' in (answer.value as any)) {
            const urlValue = answer.value as { image_url: string };
            console.log(`Triggering URL-based landmark processing for front face: ${urlValue.image_url}`);
            processLandmarksForAnswerWithUrl(answer.answer_id, urlValue.image_url).catch(error => {
              console.error('Async url landmark processing error:', error);
            });
          }
        } else if (['q_face_photo_left', 'q_face_photo_right'].includes(answer.question_id)) {
          console.log(`Skipping landmark processing for ${answer.question_id} (only front face is processed for landmarks)`);
        }
      }

      responseAnswers.push({
        answer_id: answer.answer_id,
        saved: true,
        saved_at: now.toISOString(),
      });
    }

    await updateOnboardingSession(sessionId, null, screen_completed);

    const totalAnswers = await prisma.onboardingAnswer.count({
      where: { sessionId },
    });

    const response: OnboardingResponse = {
      saved: true,
      total_answers_received: totalAnswers,
      answers: responseAnswers,
      session_onboarding_status: screen_completed ? 'completed' : 'in_progress',
    };

    if (idempotencyKey) {
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          response: response as any,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    res.json(response);
  } catch (error) {
    console.error('Onboarding save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticateSessionOptional, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const querySessionId = req.query.session_id as string;
    const sessionId = req.sessionId || querySessionId;

    if (req.userId) {
      const answers = await prisma.onboardingAnswer.findMany({
        where: { userId: req.userId },
        orderBy: { savedAt: 'asc' }
      });

      const response: OnboardingStateResponse = {
        session_id: req.userId,
        answers: answers.map((answer: any) => ({
          question_id: answer.questionId,
          value: answer.value as any,
        })),
      };
      res.json(response);
      return;
    }

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID required (either via query param or authentication token)' });
      return;
    }

    if (req.sessionId && querySessionId && querySessionId !== req.sessionId) {
      res.status(400).json({ error: 'Session ID mismatch' });
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId },
      include: { answers: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const response: OnboardingStateResponse = {
      session_id: sessionId,
      answers: session.answers.map((answer: any) => ({
        question_id: answer.questionId,
        value: answer.value as any,
      })),
    };

    res.json(response);
  } catch (error) {
    console.error('Onboarding state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * creates the combined onboarding session record
 * that stores all answers as a single json object in the db for us
 */
async function updateOnboardingSession(
  sessionId: string | null,
  userId: string | null,
  isCompleted?: boolean
): Promise<void> {
  try {
    // get all current ans for this sesh or user
    const allAnswers = await prisma.onboardingAnswer.findMany({
      where: sessionId ? { sessionId } : { userId },
      orderBy: { savedAt: 'asc' },
    });

    // transfrom answers into a combined json struct
    const combinedAnswers = allAnswers.reduce((acc: Record<string, any>, answer: any) => {
      acc[answer.questionId] = {
        answer_id: answer.answerId,
        screen_id: answer.screenId,
        question_id: answer.questionId,
        type: answer.type,
        value: answer.value,
        status: answer.status,
        saved_at: answer.savedAt.toISOString(),
      };
      return acc;
    }, {} as Record<string, any>);

    const currentStatus = isCompleted ? 'completed' : 'in_progress';

    if (sessionId) {
      await prisma.onboardingSession.upsert({
        where: { sessionId },
        create: {
          sessionId,
          allAnswers: combinedAnswers,
          status: currentStatus,
        },
        update: {
          allAnswers: combinedAnswers,
          status: currentStatus,
          updatedAt: new Date(),
        },
      });
    } else if (userId) {
      await prisma.onboardingSession.upsert({
        where: { userId },
        create: {
          userId,
          allAnswers: combinedAnswers,
          status: currentStatus,
        },
        update: {
          allAnswers: combinedAnswers,
          status: currentStatus,
          updatedAt: new Date(),
        },
      });
    }
  } catch (error) {
    console.error('Error updating onboarding session:', error);
    // no throw | shouldnt break main flow
  }
}

export { router as onboardingRouter };