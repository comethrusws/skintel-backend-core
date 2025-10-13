import { Router, Request, Response } from 'express';
import { AuthResponse, RefreshTokenResponse, LogoutResponse } from '../types';
import { 
  generateUserId, 
  generateAccessToken, 
  generateRefreshToken,
  hashPassword,
  verifyPassword
} from '../utils/auth';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { 
  authSignupRequestSchema,
  authLoginRequestSchema,
  authSSORequestSchema,
  refreshTokenRequestSchema,
  logoutRequestSchema
} from '../lib/validation';
import { prisma } from '../lib/prisma';

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

    const { session_id, provider, sso_token } = validationResult.data;

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: session_id },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const ssoId = sso_token;
    let user = await prisma.user.findUnique({
      where: {
        ssoProvider_ssoId: {
          ssoProvider: provider,
          ssoId,
        },
      },
    });

    if (!user) {
      const userId = generateUserId();
      user = await prisma.user.create({
        data: {
          userId,
          ssoProvider: provider,
          ssoId,
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

async function mergeSessionToUser(sessionId: string, userId: string): Promise<boolean> {
  try {
    // capture ansID belonging to this session before we null out apna seshID
    const answers = await prisma.onboardingAnswer.findMany({
      where: { sessionId },
      select: { answerId: true },
    });
    const answerIds = answers.map(a => a.answerId);

    await prisma.$transaction([
      // this will make surefacial landmarks for these answers are linked to the user
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

      // marking session as merged
      prisma.anonymousSession.update({
        where: { sessionId },
        data: { mergedToUserId: userId },
      }),
    ]);
    return true;
  } catch (error) {
    console.error('Session merge error:', error);
    return false;
  }
}

export { router as authRouter };