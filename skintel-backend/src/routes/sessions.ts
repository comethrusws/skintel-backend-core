import { Router, Request, Response } from 'express';
import { AnonymousSessionResponse } from '../types';
import { generateSessionId, generateSessionToken } from '../utils/auth';
import { anonymousSessionRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';

const router = Router();

/**
 * @swagger
 * /v1/sessions/anonymous:
 *   post:
 *     summary: Create anonymous session
 *     description: Creates a temporary session for onboarding without user registration
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_id:
 *                 type: string
 *                 format: uuid
 *                 example: "123e4567-e89b-12d3-a456-426614174000"
 *               device_info:
 *                 $ref: '#/components/schemas/DeviceInfo'
 *             required:
 *               - device_id
 *               - device_info
 *     responses:
 *       201:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session_id:
 *                   type: string
 *                   example: "sess_abc123"
 *                 session_token:
 *                   type: string
 *                   example: "st_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/anonymous', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = anonymousSessionRequestSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ 
        error: 'Invalid request data',
        details: validationResult.error.errors 
      });
      return;
    }

    const { device_id, device_info } = validationResult.data;

    const sessionId = generateSessionId();
    const sessionToken = generateSessionToken(sessionId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const session = await prisma.anonymousSession.create({
      data: {
        sessionId,
        sessionToken,
        deviceId: device_id,
        deviceInfo: device_info,
        expiresAt,
      },
    });

    const response: AnonymousSessionResponse = {
      session_id: sessionId,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString()
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as sessionsRouter };