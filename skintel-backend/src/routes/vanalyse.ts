import { Router, Request, Response } from 'express';
import { analyzeSkin } from '../services/analysis';

export const vanalyseRouter = Router();

// POST /v1/vanalyse
// body: { answerId: string }
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


