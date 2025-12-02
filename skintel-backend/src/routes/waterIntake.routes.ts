import { Router, Response } from 'express';
import { WaterIntakeService } from '../services/waterIntake';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /v1/water-intake:
 *   get:
 *     summary: Get water intake information
 *     description: Returns today's water intake data including recommendation, actual intake logged by the user, and progress.
 *     tags: [Dashboard]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Water intake information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 date:
 *                   type: string
 *                   format: date
 *                   description: Today's date in ISO format (yyyy-mm-dd)
 *                   example: "2025-12-02"
 *                 recommended:
 *                   type: object
 *                   description: Recommended daily water intake based on user's skin analysis
 *                   properties:
 *                     amount:
 *                       type: number
 *                       example: 2500
 *                     unit:
 *                       type: string
 *                       example: "ml"
 *                     reason:
 *                       type: string
 *                       example: "To maintain hydration for dry skin."
 *                 actual:
 *                   type: object
 *                   nullable: true
 *                   description: Actual water intake logged by the user for today. Null if no intake has been logged yet.
 *                   properties:
 *                     amount:
 *                       type: number
 *                       description: Total accumulated water intake for today in ml
 *                       example: 1800
 *                     unit:
 *                       type: string
 *                       example: "ml"
 *                 progress:
 *                   type: number
 *                   nullable: true
 *                   description: Progress towards recommended intake (0-1). Calculated as actual / recommended. Null if no intake has been logged.
 *                   example: 0.72
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Update daily water intake for a user
 *     description: Record how much water the user actually drank on a given day and compare it against the recommended intake. This endpoint INCREMENTS the existing water intake amount for the specified date - it adds to any previously logged amount rather than replacing it. If no previous record exists for the date, it creates a new entry.
 *     tags: [Dashboard]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *                 description: ISO date (yyyy-mm-dd). Defaults to today if omitted.
 *                 example: "2025-12-02"
 *               amount:
 *                 type: number
 *                 description: Amount of water consumed to ADD to the daily total (not replace).
 *                 example: 250
 *               unit:
 *                 type: string
 *                 description: Unit of the amount. Currently supports "ml" or "l". Defaults to "ml".
 *                 example: "ml"
 *             required:
 *               - amount
 *     responses:
 *       200:
 *         description: Daily water intake updated and compared with recommendation. Returns the total accumulated water intake for the day.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 date:
 *                   type: string
 *                   format: date
 *                   example: "2025-12-02"
 *                 actualAmount:
 *                   type: number
 *                   description: Total water intake for the day after adding the new amount
 *                   example: 1800
 *                 actualUnit:
 *                   type: string
 *                   example: "ml"
 *                 recommended:
 *                   type: object
 *                   properties:
 *                     amount:
 *                       type: number
 *                       example: 2500
 *                     unit:
 *                       type: string
 *                       example: "ml"
 *                     reason:
 *                       type: string
 *                       example: "To maintain hydration for dry skin."
 *                 progress:
 *                   type: number
 *                   nullable: true
 *                   description: Progress towards recommended intake (0-1). Calculated as actualAmount / recommended.amount. Null if recommendation is not available.
 *                   example: 0.72
 *       400:
 *         description: Invalid input data (e.g., missing amount, invalid unit, invalid date format).
 *       500:
 *         description: Internal server error.
 */
router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const suggestion = await WaterIntakeService.getWaterIntakeSuggestion(userId);
    res.json(suggestion);
  } catch (error) {
    console.error('Error fetching water intake suggestion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { date, amount, unit } = req.body || {};

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'amount is required' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      return res.status(400).json({ error: 'amount must be a valid number' });
    }

    if (unit && !['ml', 'l', 'L'].includes(unit)) {
      return res.status(400).json({ error: 'unit must be one of: ml, l' });
    }

    let dateString: string | undefined = date;
    if (dateString) {
      const parsed = new Date(dateString);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'date must be a valid ISO date (yyyy-mm-dd)' });
      }
    }

    const summary = await WaterIntakeService.upsertDailyIntake(userId, {
      date: dateString,
      amount: numericAmount,
      unit,
    });

    res.json(summary);
  } catch (error) {
    console.error('Error updating daily water intake:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const waterIntakeRouter = router;
