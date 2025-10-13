import { Router, Request, Response } from 'express';
import { analyzeSkin } from '../services/analysis';

export const vanalyseRouter = Router();

/**
 * @swagger
 * /v1/vanalyse:
 *   post:
 *     summary: Run skin analysis for an onboarding face image
 *     description: Triggers AI skin analysis using the stored facial landmarks for the provided onboarding answer.
 *     tags: [Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answerId:
 *                 type: string
 *                 description: The onboarding `answer_id` for a face image question
 *             required:
 *               - answerId
 *     responses:
 *       200:
 *         description: Analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answerId:
 *                   type: string
 *                 analysis:
 *                   type: object
 *       400:
 *         description: Missing or invalid request body
 *       500:
 *         description: Analysis failed due to a server error
 */
vanalyseRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { answerId } = req.body as { answerId?: string };
    if (!answerId) {
      return res.status(400).json({ error: 'answerId is required' });
    }

    const analysis = await analyzeSkin(answerId);
    return res.json({ answerId, analysis });
  } catch (error) {
    console.error('vanalyse error', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'analysis failed' });
  }
});


