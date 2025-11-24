import { firebaseAdmin } from '../lib/firebase';
import { prisma } from '../lib/prisma';

export class NotificationService {
    /**
     * Send a push notification to a specific user
     */
    static async sendNotification(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, string>
    ) {
        try {
            // Get user's device tokens
            const deviceTokens = await prisma.deviceToken.findMany({
                where: { userId },
                select: { token: true },
            });

            if (deviceTokens.length === 0) {
                console.log(`No device tokens found for user ${userId}`);
                return;
            }

            const tokens = deviceTokens.map((dt) => dt.token);

            // Send multicast message
            await this.sendMulticastNotification(tokens, title, body, data);
        } catch (error) {
            console.error('Error sending notification:', error);
            throw error;
        }
    }

    /**
     * Send a push notification to multiple tokens
     */
    static async sendMulticastNotification(
        tokens: string[],
        title: string,
        body: string,
        data?: Record<string, string>
    ) {
        if (tokens.length === 0) return;

        try {
            const message = {
                notification: {
                    title,
                    body,
                },
                data: data || {},
                tokens,
            };

            const response = await firebaseAdmin.messaging().sendEachForMulticast(message);

            // Handle invalid tokens
            if (response.failureCount > 0) {
                const failedTokens: string[] = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(tokens[idx]);
                    }
                });

                if (failedTokens.length > 0) {
                    console.log('Removing invalid tokens:', failedTokens);
                    await prisma.deviceToken.deleteMany({
                        where: {
                            token: {
                                in: failedTokens,
                            },
                        },
                    });
                }
            }

            console.log(`Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
        } catch (error) {
            console.error('Error sending multicast notification:', error);
            throw error;
        }
    }
}
