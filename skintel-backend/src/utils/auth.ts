import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'random-secret-key';
const JWT_EXPIRES_IN = '1h';
const SALT_ROUNDS = 12;

export const generateSessionId = (): string => `sess_${uuidv4()}`;

export const generateUserId = (): string => `user_${uuidv4()}`;

export const generateAnswerId = (): string => `ans_${uuidv4()}`;

export const generateImageId = (): string => `img_${uuidv4()}`;

export const generateSessionToken = (sessionId: string): string => {
  return `st_${jwt.sign({ sessionId, type: 'session' }, JWT_SECRET, { expiresIn: '48h' })}`;
};

export const generateAccessToken = (userId: string): string => {
  return jwt.sign({ userId, type: 'access' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const generateRefreshToken = (): string => {
  return `rt_${crypto.randomBytes(32).toString('hex')}`;
};

export const verifySessionToken = (token: string): { sessionId: string } | null => {
  try {
    if (!token.startsWith('st_')) return null;
    const jwtToken = token.slice(3);
    const decoded = jwt.verify(jwtToken, JWT_SECRET) as any;
    if (decoded.type !== 'session') return null;
    return { sessionId: decoded.sessionId };
  } catch {
    return null;
  }
};

export const verifyAccessToken = (token: string): { userId: string } | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.type !== 'access') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
};

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};