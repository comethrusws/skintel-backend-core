import { Request, Response, NextFunction } from 'express';
import { verifySessionToken, verifyAccessToken, verifyPassword } from '../utils/auth';
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


/**
 * Optional session authentication - doesn't block if no token is provided
 * Sets sessionId if valid token exists, otherwise continues without it
 */
export const authenticateSessionOptional = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifyAccessToken(token);

      if (decoded) {
        req.userId = decoded.userId;
        next();
        return;
      }
    }

    const sessionToken = req.headers['x-session-token'] as string;

    if (!sessionToken) {
      next();
      return;
    }

    const decoded = verifySessionToken(sessionToken);
    if (!decoded) {
      next();
      return;
    }

    const session = await prisma.anonymousSession.findUnique({
      where: { sessionId: decoded.sessionId },
    });

    if (!session || session.expiresAt < new Date()) {
      next();
      return;
    }

    req.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    next();
  }
};

export const authenticateUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'Authorization header required' });
      return;
    }

    // Handle Bearer token authentication
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifyAccessToken(token);

      if (!decoded) {
        res.status(401).json({ error: 'Invalid access token' });
        return;
      }

      req.userId = decoded.userId;
      next();
      return;
    }

    // Handle Basic authentication
    if (authHeader.startsWith('Basic ')) {
      const base64Credentials = authHeader.slice(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [email, password] = credentials.split(':');

      if (!email || !password) {
        res.status(401).json({ error: 'Invalid Basic auth credentials' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const isValidPassword = await verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      req.userId = user.userId;
      next();
      return;
    }

    res.status(401).json({ error: 'Unsupported authorization method' });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};