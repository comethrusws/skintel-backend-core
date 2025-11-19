import { Router, Request, Response } from 'express';
import { WaterIntakeService } from '../services/waterIntake';
import { authenticateUser } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /v1/water-intake:
 *   get:
 *     summary: Get personalized water intake suggestion
 *     tags: [Water Intake]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Water intake suggestion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 amount:
 *                   type: number
 *                   example: 2500
 *                 unit:
 *                   type: string
 *                   example: "ml"
 *                 reason:
 *                   type: string
 *                   example: "To maintain hydration for dry skin."
 */
router.get('/', authenticateUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const suggestion = await WaterIntakeService.getWaterIntakeSuggestion(userId);
        res.json(suggestion);
    } catch (error) {
        console.error('Error fetching water intake suggestion:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export const waterIntakeRouter = router;
