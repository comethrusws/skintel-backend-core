import { Request, Response, NextFunction } from 'express';
import { verifySessionToken, verifyAccessToken } from '../utils/auth';
import { prisma } from '../lib/prisma';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
}

export const authenticateSession = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;
    
    if (!sessionToken) {
      res.status(401).json({ error: 'Session token required' });
      return;
    }

    const decoded = verifySessionToken(sessionToken);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid session token' });
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: decoded.sessionId },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Session not found or expired' });
      return;
    }

    req.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const authenticateUser = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyAccessToken(token);
  
  if (!decoded) {
    res.status(401).json({ error: 'Invalid access token' });
    return;
  }

  req.userId = decoded.userId;
  next();
};