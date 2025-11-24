import express, { Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { NotificationService } from '../services/notifications';

export const notificationsRouter = express.Router();

notificationsRouter.use(authenticateUser);

/**
 * Upload a device token
 */
notificationsRouter.post('/device-token', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const { token, platform } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        const deviceToken = await prisma.deviceToken.upsert({
            where: { token },
            update: {
                userId,
                platform: platform || 'unknown',
            },
            create: {
                userId,
                token,
                platform: platform || 'unknown',
            },
        });

        res.json(deviceToken);
    } catch (error) {
        console.error('Error uploading device token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Remove a device token
 */
notificationsRouter.delete('/device-token', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        await prisma.deviceToken.deleteMany({
            where: {
                userId,
                token,
            },
        });

        res.json({ message: 'Device token removed' });
    } catch (error) {
        console.error('Error removing device token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get notification preferences
 */
notificationsRouter.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId!;

        let preferences = await prisma.notificationPreference.findUnique({
            where: { userId },
        });

        if (!preferences) {
            // Create default preferences if not exists
            preferences = await prisma.notificationPreference.create({
                data: { userId },
            });
        }

        res.json(preferences);
    } catch (error) {
        console.error('Error getting notification preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Update notification preferences
 */
notificationsRouter.patch('/preferences', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const updates = req.body;

        // Filter allowed fields
        const allowedFields = [
            'dailyRoutineReminders',
            'hydrationAlerts',
            'uvIndexAlerts',
            'tipOfTheDay',
            'questionsOfTheDay',
            'smartInsights',
            'ingredientRecommendations',
            'notificationSound',
        ];

        const filteredUpdates: Record<string, boolean> = {};
        Object.keys(updates).forEach((key) => {
            if (allowedFields.includes(key) && typeof updates[key] === 'boolean') {
                filteredUpdates[key] = updates[key];
            }
        });

        const preferences = await prisma.notificationPreference.upsert({
            where: { userId },
            update: filteredUpdates,
            create: {
                userId,
                ...filteredUpdates,
            },
        });

        res.json(preferences);
    } catch (error) {
        console.error('Error updating notification preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Test trigger notification (Dev only)
 */
notificationsRouter.post('/test-trigger', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const { title, body, data } = req.body;

        await NotificationService.sendNotification(
            userId,
            title || 'Test Notification',
            body || 'This is a test notification from Skintel',
            data
        );

        res.json({ message: 'Notification triggered' });
    } catch (error) {
        console.error('Error triggering notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
