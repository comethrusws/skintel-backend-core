import { Router, Request, Response } from 'express';
import { AuthResponse, RefreshTokenResponse, LogoutResponse } from '../types';
import {
  generateUserId,
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
  hashPassword,
  verifyPassword
} from '../utils/auth';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { generateTasksForUser } from '../services/tasks';
import {
  authSignupRequestSchema,
  authLoginRequestSchema,
  authSSORequestSchema,
  refreshTokenRequestSchema,
  logoutRequestSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema
} from '../lib/validation';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { verifyClerkSessionToken } from '../lib/clerk';

const router = Router();

/**
 * @swagger
 * /v1/auth/signup:
 *   post:
 *     summary: User signup
 *     description: Create new user account with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               session_id:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *             required:
 *               - session_id
 *               - email
 *               - password
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Session not found or expired
 *       409:
 *         description: User already exists
 * 
 * /v1/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               session_id:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *             required:
 *               - session_id
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       404:
 *         description: Session not found or expired
 * 
 * /v1/auth/sso:
 *   post:
 *     summary: SSO login via Clerk
 *     description: Authenticate user with Clerk SSO (Google, Facebook, Apple)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               session_id:
 *                 type: string
 *                 description: Anonymous session ID from onboarding
 *               provider:
 *                 type: string
 *                 enum: [clerk_google, clerk_facebook, clerk_apple]
 *                 description: OAuth provider used with Clerk
 *               clerk_token:
 *                 type: string
 *                 description: Clerk session token obtained after OAuth
 *               clerk_session_id:
 *                 type: string
 *                 description: Clerk session ID (`sess_...`) returned with the token
 *             required:
 *               - session_id
 *               - provider
 *               - clerk_token
 *               - clerk_session_id
 *     responses:
 *       200:
 *         description: SSO login successful
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Invalid or expired Clerk token
 *       404:
 *         description: Session not found or expired
 * 
 * /v1/auth/token/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Get new access token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_token:
 *                 type: string
 *             required:
 *               - refresh_token
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid refresh token
 * 
 * /v1/auth/password-reset/request:
 *   post:
 *     summary: Request password reset
 *     description: Generate password reset token for user email
 *     tags: [Authentication]
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
 *             required:
 *               - email
 *     responses:
 *       200:
 *         description: Reset token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reset_token:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: User not found
 *       400:
 *         description: Invalid request data
 * 
 * /v1/auth/password-reset/confirm:
 *   post:
 *     summary: Confirm password reset
 *     description: Reset user password using reset token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reset_token:
 *                 type: string
 *               new_password:
 *                 type: string
 *                 minLength: 8
 *             required:
 *               - reset_token
 *               - new_password
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Invalid or expired reset token
 */

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = authSignupRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { session_id, email, password } = validationResult.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: session_id },
      include: { answers: true },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const userId = generateUserId();
    const accessToken = generateAccessToken(userId);
    const refreshToken = generateRefreshToken();
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        userId,
        email,
        passwordHash,
      },
    });

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const sessionMerged = await mergeSessionToUser(session_id, userId);

    const response: AuthResponse = {
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      session_merged: sessionMerged,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = authLoginRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { session_id, email, password } = validationResult.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: session_id },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const accessToken = generateAccessToken(user.userId);
    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.userId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const sessionMerged = await mergeSessionToUser(session_id, user.userId);

    const response: AuthResponse = {
      user_id: user.userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      session_merged: sessionMerged,
    };

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sso', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = authSSORequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { session_id, provider, clerk_token, clerk_session_id } = validationResult.data;

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: session_id },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }


    const verifiedSession = await verifyClerkSessionToken(clerk_token);

    if (!verifiedSession) {
      res.status(401).json({ error: 'Invalid or expired Clerk token' });
      return;
    }

    if (verifiedSession.sessionId !== clerk_session_id) {
      res.status(401).json({ error: 'Mismatched Clerk session' });
      return;
    }

    const detectedProvider = verifiedSession.provider;

    if (provider !== detectedProvider) {
      console.warn(`Clerk provider mismatch: expected ${provider}, got ${detectedProvider}`);
      res.status(400).json({ error: 'Provider mismatch' });
      return;
    }

    const ssoId = verifiedSession.clerkUserId;

    let user = await prisma.user.findUnique({
      where: {
        ssoProvider_ssoId: {
          ssoProvider: detectedProvider,
          ssoId,
        },
      },
    });

    if (!user && verifiedSession.email) {
      user = await prisma.user.findUnique({
        where: {
          email: verifiedSession.email,
        },
      });

      if (user && !user.ssoProvider && !user.ssoId) {
        user = await prisma.user.update({
          where: { userId: user.userId },
          data: {
            ssoProvider: detectedProvider,
            ssoId,
            // Update name if not already set
            name: user.name || ([verifiedSession.firstName, verifiedSession.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || undefined),
          },
        });
      }
    }

    // If still not found, create new user
    if (!user) {
      const userId = generateUserId();
      user = await prisma.user.create({
        data: {
          userId,
          ssoProvider: detectedProvider,
          ssoId,
          email: verifiedSession.email || undefined,
          name: [verifiedSession.firstName, verifiedSession.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || undefined,
        },
      });
    }

    const accessToken = generateAccessToken(user.userId);
    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.userId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const sessionMerged = await mergeSessionToUser(session_id, user.userId);

    const response: AuthResponse = {
      user_id: user.userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      session_merged: sessionMerged,
    };

    res.json(response);
  } catch (error) {
    console.error('SSO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/token/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = refreshTokenRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { refresh_token } = validationResult.data;

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refresh_token },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const newAccessToken = generateAccessToken(tokenRecord.userId);
    const newRefreshToken = generateRefreshToken();

    await prisma.$transaction([
      prisma.refreshToken.delete({
        where: { token: refresh_token },
      }),
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: tokenRecord.userId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const response: RefreshTokenResponse = {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_in: 3600,
    };

    res.json(response);
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validationResult = logoutRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { refresh_token } = validationResult.data;
    const userId = req.userId!;

    await prisma.refreshToken.deleteMany({
      where: {
        token: refresh_token,
        userId,
      },
    });

    const response: LogoutResponse = {
      status: 'logged_out',
    };

    res.json(response);
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/password-reset/request', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = passwordResetRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { email } = validationResult.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.userId },
    });

    const resetToken = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        token: resetToken,
        userId: user.userId,
        expiresAt,
      },
    });

    res.json({
      reset_token: resetToken,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/password-reset/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = passwordResetConfirmSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { reset_token, new_password } = validationResult.data;

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: reset_token },
      include: { user: true },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await hashPassword(new_password);

    await prisma.$transaction([
      prisma.user.update({
        where: { userId: resetToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.delete({
        where: { token: reset_token },
      }),
      prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    res.json({
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Password reset confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function mergeSessionToUser(sessionId: string, userId: string): Promise<boolean> {
  try {
    const answers = await prisma.onboardingAnswer.findMany({
      where: { sessionId },
      select: { answerId: true },
    });
    const answerIds = answers.map((a: { answerId: string }) => a.answerId);

    const existingUserSession = await prisma.onboardingSession.findUnique({
      where: { userId },
    });

    await prisma.$transaction([
      prisma.facialLandmarks.updateMany({
        where: { answerId: { in: answerIds } },
        data: { userId }
      }),

      prisma.onboardingAnswer.updateMany({
        where: { sessionId },
        data: {
          userId,
          sessionId: null,
        },
      }),

      ...(existingUserSession
        ? [
          prisma.onboardingSession.deleteMany({
            where: { sessionId },
          })
        ]
        : [
          prisma.onboardingSession.updateMany({
            where: { sessionId },
            data: {
              userId,
              sessionId: null,
            },
          })
        ]
      ),

      prisma.anonymousSession.update({
        where: { sessionId },
        data: { mergedToUserId: userId },
      }),
    ]);

    // trigger task generation for any new user
    try {
      console.log(`[TaskGen] Attempting to generate tasks for user ${userId}`);
      const facialLandmark = await prisma.facialLandmarks.findFirst({
        where: {
          userId,
          status: 'COMPLETED',
          weeklyPlan: { not: Prisma.DbNull }
        },
        orderBy: { createdAt: 'desc' }
      });

      console.log(`[TaskGen] Found landmark:`, facialLandmark ? 'yes' : 'no');

      if (facialLandmark && facialLandmark.weeklyPlan) {
        console.log(`[TaskGen] Landmark has weekly plan, proceeding...`);
        const weeklyPlan = typeof facialLandmark.weeklyPlan === 'string'
          ? JSON.parse(facialLandmark.weeklyPlan)
          : facialLandmark.weeklyPlan;

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
          weeklyPlan,
          userProducts: formattedProducts
        });
        console.log(`[TaskGen] Task generation triggered successfully`);
      } else {
        console.log(`[TaskGen] Skipping task generation: No weekly plan found (Plan exists: ${!!facialLandmark?.weeklyPlan})`);
      }
    } catch (taskError) {
      console.error('[TaskGen] Failed to generate tasks after signup/login:', taskError);
      // Don't fail the auth request if task generation fails
    }

    return true;
  } catch (error) {
    console.error('Session merge error:', error);
    return false;
  }
}

export { router as authRouter };