import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import {
  authSignupRequestSchema,
  authLoginRequestSchema,
  authSSORequestSchema,
  refreshTokenRequestSchema,
  logoutRequestSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema
} from '../lib/validation';
import { AuthService } from '../services/auth';

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

router.post('/signup', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = authSignupRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip;
  const clientUserAgent = req.headers['user-agent'];
  const response = await AuthService.signup(validationResult.data, clientIp, clientUserAgent);
  res.status(201).json(response);
}));

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = authLoginRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await AuthService.login(validationResult.data);
  res.json(response);
}));

router.post('/sso', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = authSSORequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip;
  const clientUserAgent = req.headers['user-agent'];
  const response = await AuthService.sso(validationResult.data, clientIp, clientUserAgent);
  res.json(response);
}));

router.post('/token/refresh', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = refreshTokenRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await AuthService.refreshToken(validationResult.data.refresh_token);
  res.json(response);
}));

router.post('/logout', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = logoutRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await AuthService.logout(req.userId!, validationResult.data.refresh_token);
  res.json(response);
}));

router.post('/password-reset/request', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = passwordResetRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await AuthService.requestPasswordReset(validationResult.data.email);
  res.json(response);
}));

router.post('/password-reset/confirm', asyncHandler(async (req: Request, res: Response) => {
  const validationResult = passwordResetConfirmSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await AuthService.confirmPasswordReset(validationResult.data);
  res.json(response);
}));

export { router as authRouter };