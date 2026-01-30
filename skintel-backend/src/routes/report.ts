import express, { Request, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { sendSlackNotification } from '../services/slack';
import { prisma } from '../lib/prisma';
import { MetaConversionService } from '../services/meta';

const router = express.Router();

/**
 * @swagger
 * /v1/report/email:
 *   post:
 *     summary: Send an email report
 *     tags: [Report]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - description
 *             properties:
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email report sent successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
router.post('/email', authenticateUser, async (req: Request, res: Response) => {
    try {
        const { subject, description } = req.body;
        const userId = (req as AuthenticatedRequest).userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { userId },
            select: { email: true }
        });

        const userEmail = user?.email || 'Unknown User';

        if (!subject || !description) {
            return res.status(400).json({ error: 'Subject and description are required' });
        }

        const message = {
            text: `*New Email Report*\n*From:* ${userEmail}\n*Subject:* ${subject}\n*Description:* ${description}`,
        };

        await sendSlackNotification(message);

        res.status(200).json({ message: 'Email report sent successfully' });

        // Track Report Viewed/Sent Event
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip;
        const clientUserAgent = req.headers['user-agent'];
        MetaConversionService.sendEvent(
            'email_report_sent',
            { email: userEmail, externalId: userId, clientIp, clientUserAgent },
            { contentName: 'email_report', status: 'sent', details: subject },
            'report/email'
        ).catch(e => console.error('Meta event failed', e));
    } catch (error) {
        console.error('Error sending email report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /v1/report/issue:
 *   post:
 *     summary: Report an issue
 *     tags: [Report]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Issue reported successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
router.post('/issue', authenticateUser, async (req: Request, res: Response) => {
    try {
        const { title, description } = req.body;
        const userId = (req as AuthenticatedRequest).userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { userId },
            select: { email: true }
        });

        const userEmail = user?.email || 'Unknown User';

        if (!title || !description) {
            return res.status(400).json({ error: 'Title and description are required' });
        }

        const message = {
            text: `*New Issue Report*\n*From:* ${userEmail}\n*Title:* ${title}\n*Description:* ${description}`,
        };

        await sendSlackNotification(message);

        res.status(200).json({ message: 'Issue reported successfully' });
    } catch (error) {
        console.error('Error reporting issue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export const reportRouter = router;
