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
            const deviceTokens = await prisma.deviceToken.findMany({
                where: { userId },
                select: { token: true },
            });

            if (deviceTokens.length === 0) {
                console.log(`No device tokens found for user ${userId}`);
                return;
            }

            const tokens = deviceTokens.map((dt) => dt.token);

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

    /**
     * Send morning routine reminders
     */
    static async sendMorningReminders() {
        try {
            console.log('Sending morning reminders...');
            const tokens = await prisma.deviceToken.findMany({
                where: {
                    user: {
                        notificationPreferences: {
                            dailyRoutineReminders: true,
                        },
                    },
                },
                select: { token: true },
            });

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                'Good Morning! ☀️',
                'Time for your morning skincare routine. Let\'s start the day glowing!',
                { type: 'routine', time: 'morning' }
            );
        } catch (error) {
            console.error('Error sending morning reminders:', error);
        }
    }

    /**
     * Send evening routine reminders
     */
    static async sendEveningReminders() {
        try {
            console.log('Sending evening reminders...');
            const tokens = await prisma.deviceToken.findMany({
                where: {
                    user: {
                        notificationPreferences: {
                            dailyRoutineReminders: true,
                        },
                    },
                },
                select: { token: true },
            });

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                'Time to Unwind 🌙',
                'Don\'t forget your evening skincare routine before bed.',
                { type: 'routine', time: 'evening' }
            );
        } catch (error) {
            console.error('Error sending evening reminders:', error);
        }
    }

    /**
     * Send hydration reminders
     */
    static async sendHydrationReminders() {
        try {
            console.log('Sending hydration reminders...');
            const tokens = await prisma.deviceToken.findMany({
                where: {
                    user: {
                        notificationPreferences: {
                            hydrationAlerts: true,
                        },
                    },
                },
                select: { token: true },
            });

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                'Stay Hydrated! 💧',
                'Remember to drink water for healthy, glowing skin.',
                { type: 'hydration' }
            );
        } catch (error) {
            console.error('Error sending hydration reminders:', error);
        }
    }

    /**
     * Send tip of the day
     */
    static async sendTipOfTheDay() {
        try {
            console.log('Sending tip of the day...');
            const tokens = await prisma.deviceToken.findMany({
                where: {
                    user: {
                        notificationPreferences: {
                            tipOfTheDay: true,
                        },
                    },
                },
                select: { token: true },
            });

            // Fetch today's tip
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tip = await prisma.skinTip.findUnique({
                where: { date: today },
            });

            const body = tip ? tip.content : 'Consistency is key to great skin!';

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                'Tip of the Day 💡',
                body,
                { type: 'tip' }
            );
        } catch (error) {
            console.error('Error sending tip of the day:', error);
        }
    }
}
