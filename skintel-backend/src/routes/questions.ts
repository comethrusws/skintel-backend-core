import express, { Request, Response } from 'express';
import { QuestionOfTheDayService } from '../services/questionOfTheDay';
import { CheckInService } from '../services/checkIn';
import { requireAuth } from '@clerk/express';

const router = express.Router();

/**
 * @swagger
 * /questions/daily:
 *   get:
 *     summary: Get the Question of the Day (Quiz)
 *     tags: [Questions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 question:
 *                   type: string
 *                 options:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                       isCorrect:
 *                         type: boolean
 *                 category:
 *                   type: string
 */
router.get('/daily', requireAuth(), async (req: Request, res: Response) => {
    try {
        const question = await QuestionOfTheDayService.getQuestionForToday();
        if (!question) {
            return res.status(404).json({ error: 'No question available for today' });
        }
        res.json(question);
    } catch (error) {
        console.error('Error getting daily question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /questions/check-in:
 *   get:
 *     summary: Get the Daily Check-in Question
 *     tags: [Questions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 question:
 *                   type: string
 */
router.get('/check-in', requireAuth(), async (req: Request, res: Response) => {
    try {
        const checkIn = await CheckInService.getCheckInForToday();
        if (!checkIn) {
            return res.status(404).json({ error: 'No check-in question available for today' });
        }
        res.json(checkIn);
    } catch (error) {
        console.error('Error getting check-in question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export const questionsRouter = router;
