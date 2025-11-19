import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { skinFeelRequestSchema } from '../lib/validation';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

    const skinFeels = await prisma.skinFeel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    const response = {
      user_id: userId,
      skin_feels: skinFeels.map(sf => ({
        id: sf.id,
        value: sf.value,
        created_at: sf.createdAt.toISOString()
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Get skin feels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /v1/skin-feel:
 *   get:
 *     summary: Get skin feel history
 *     description: Retrieve user's skin feel history
 *     tags: [Dashboard]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of records to return
 *     responses:
 *       200:
 *         description: Skin feel history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 skin_feels:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       value:
 *                         type: string
 *                         enum: [feeling_rough, not_great, feeling_good, feeling_fresh, glowing]
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Authentication required
 *   post:
 *     summary: Submit skin feel update
 *     description: Record how the user's skin feels today
 *     tags: [Dashboard]
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
 *               value:
 *                 type: string
 *                 enum: [feeling_rough, not_great, feeling_good, feeling_fresh, glowing]
 *                 example: "feeling_good"
 *             required:
 *               - value
 *     responses:
 *       201:
 *         description: Skin feel recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 user_id:
 *                   type: string
 *                 value:
 *                   type: string
 *                   enum: [feeling_rough, not_great, feeling_good, feeling_fresh, glowing]
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 */
router.post('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const validationResult = skinFeelRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { value } = validationResult.data;

    const skinFeel = await prisma.skinFeel.create({
      data: {
        userId,
        value: value as any
      }
    });

    const response = {
      id: skinFeel.id,
      user_id: skinFeel.userId,
      value: skinFeel.value,
      created_at: skinFeel.createdAt.toISOString()
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Create skin feel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as skinFeelRouter };