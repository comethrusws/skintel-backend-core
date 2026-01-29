import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppleNotificationService } from '../services/appleNotification';
import { sendSlackNotification } from '../services/slack';

const router = Router();

/**
 * @swagger
 * /webhooks/apple:
 *   post:
 *     summary: Apple App Store Server Notifications V2
 *     description: Receives server-to-server notifications from Apple for subscription lifecycle events.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signedPayload:
 *                 type: string
 *                 description: JWS signed notification payload from Apple
 *     responses:
 *       200:
 *         description: Notification received and processed
 *       400:
 *         description: Invalid notification payload
 *       500:
 *         description: Internal server error
 */
router.post('/apple', asyncHandler(async (req: Request, res: Response) => {
    const { signedPayload } = req.body;

    if (!signedPayload) {
        console.error('Apple webhook: Missing signedPayload');
        res.status(400).json({ error: 'Missing signedPayload' });
        return;
    }

    try {
        const result = await AppleNotificationService.processNotification(signedPayload);

        if (result.success) {
            console.log(`Apple webhook processed: ${result.notificationType} for user ${result.userId || 'unknown'}`);
            res.status(200).json({ status: 'ok' });
        } else {
            console.error('Apple webhook processing failed:', result.error);
            // Still return 200 to Apple to prevent retries for invalid notifications
            res.status(200).json({ status: 'error', message: result.error });
        }
    } catch (error) {
        console.error('Apple webhook error:', error);

        // Notify via Slack for critical errors
        await sendSlackNotification({
            text: `⚠️ Apple Webhook Error\n\`\`\`${error instanceof Error ? error.message : 'Unknown error'}\`\`\``
        }).catch(() => { });

        // Return 200 to prevent Apple from retrying
        res.status(200).json({ status: 'error' });
    }
}));

export { router as webhookRouter };
