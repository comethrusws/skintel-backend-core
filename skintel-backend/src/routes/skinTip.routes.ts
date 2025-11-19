import { Router } from 'express';
import { SkinTipService } from '../services/skinTip';

const router = Router();

/**
 * @swagger
 * /v1/skin-tip:
 *   get:
 *     summary: Get the skin tip of the day
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: The skin tip for today
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: string
 *                 category:
 *                   type: string
 *                   nullable: true
 */
router.get('/', async (req, res) => {
    try {
        const tip = await SkinTipService.getTipForToday();
        res.json(tip);
    } catch (error) {
        console.error('Error fetching skin tip:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export const skinTipRouter = router;
