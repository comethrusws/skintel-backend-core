import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  
  if (!idempotencyKey) {
    next();
    return;
  }

  try {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      if (existing.expiresAt < new Date()) {
        await prisma.idempotencyKey.delete({
          where: { key: idempotencyKey },
        });
        next();
        return;
      }
      
      res.json(existing.response);
      return;
    }

    (req as any).idempotencyKey = idempotencyKey;
    next();
  } catch (error) {
    next();
  }
};