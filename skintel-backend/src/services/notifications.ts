import { firebaseAdmin } from '../lib/firebase';
import { prisma } from '../lib/prisma';
import { describeUVRisk, fetchUVIndex } from '../lib/uv';
import { RoutineMessageService } from './routineMessage';

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

            const message = await RoutineMessageService.getMessageForToday('morning');

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                message.title,
                message.body,
                { type: 'routine', time: 'morning' }
            );
        } catch (error) {
            console.error('Error sending morning reminders:', error);
        }
    }

    /**
     * Send afternoon routine reminders (progress logging)
     */
    static async sendAfternoonReminders() {
        try {
            console.log('Sending afternoon reminders...');
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

            const message = await RoutineMessageService.getMessageForToday('afternoon');

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                message.title,
                message.body,
                { type: 'routine', time: 'afternoon' }
            );
        } catch (error) {
            console.error('Error sending afternoon reminders:', error);
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

            const message = await RoutineMessageService.getMessageForToday('evening');

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                message.title,
                message.body,
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

    /**
     * Send ingredient recommendations based on stored products
     */
    static async sendIngredientRecommendations() {
        try {
            console.log('Sending ingredient recommendations...');

            const users = await prisma.user.findMany({
                where: {
                    notificationPreferences: {
                        ingredientRecommendations: true,
                    },
                    products: {
                        some: {},
                    },
                    deviceTokens: {
                        some: {},
                    },
                },
                select: {
                    userId: true,
                    products: {
                        select: {
                            id: true,
                            productData: true,
                        },
                    },
                    deviceTokens: {
                        select: { token: true },
                    },
                },
            });

            if (users.length === 0) {
                console.log('No ingredient recommendation subscribers with products + device tokens.');
                return;
            }

            const ingredientTips = [
                {
                    keyword: /retinol/i,
                    label: 'retinol',
                    title: 'Retinol reminder',
                    message: (name: string) => `${name} works best at night. Apply after moisturizer and lock in with SPF the next morning.`,
                },
                {
                    keyword: /niacinamide/i,
                    label: 'niacinamide',
                    title: 'Niacinamide boost',
                    message: (name: string) => `${name} plays nicely with moisturizers. Layer it after toner to calm inflammation.`,
                },
                {
                    keyword: /hyaluronic/i,
                    label: 'hyaluronic acid',
                    title: 'Hydration hack',
                    message: (name: string) => `${name} loves damp skin. Mist your face first so hyaluronic acid can seal in moisture.`,
                },
                {
                    keyword: /vitamin\s*c|ascorbic/i,
                    label: 'vitamin c',
                    title: 'Vitamin C glow',
                    message: (name: string) => `Use ${name} in the AM under SPF to fight dullness and protect from pollution.`,
                },
                {
                    keyword: /bha|salicylic/i,
                    label: 'salicylic acid',
                    title: 'Clarifying moment',
                    message: (name: string) => `${name} clears pores. Spot treat after cleansing and follow with a light moisturizer.`,
                },
                {
                    keyword: /aha|glycolic|lactic/i,
                    label: 'exfoliating acids',
                    title: 'Smooth operator',
                    message: (name: string) => `Keep ${name} for evenings and skip other actives that night to avoid irritation.`,
                },
                {
                    keyword: /peptide/i,
                    label: 'peptides',
                    title: 'Peptide support',
                    message: (name: string) => `${name} loves being sandwiched between hydrating layers. Try serum → peptide → moisturizer.`,
                },
            ];

            const parseProductData = (productData: any) => {
                if (!productData) {
                    return {};
                }

                if (typeof productData === 'string') {
                    try {
                        return JSON.parse(productData);
                    } catch (error) {
                        console.warn('Failed to parse productData JSON', error);
                        return {};
                    }
                }

                return productData;
            };

            const extractIngredients = (raw: any): string[] => {
                if (!raw) return [];

                if (Array.isArray(raw)) {
                    return raw
                        .map((item) => (typeof item === 'string' ? item : ''))
                        .filter(Boolean);
                }

                if (typeof raw === 'string') {
                    return raw
                        .split(/[,|]/)
                        .map((part) => part.trim())
                        .filter(Boolean);
                }

                return [];
            };

            const buildSuggestion = (product: { productData: any }): { title: string; body: string; data: Record<string, string> } | null => {
                const details = parseProductData(product.productData);
                const productName = details?.product_name || details?.name || 'This product';
                const ingredients = extractIngredients(details?.ingredients);

                for (const tip of ingredientTips) {
                    if (ingredients.some((ingredient: string) => tip.keyword.test(ingredient))) {
                        return {
                            title: tip.title,
                            body: tip.message(productName),
                            data: {
                                type: 'ingredient',
                                ingredient: tip.label,
                                product_name: productName,
                            },
                        };
                    }
                }

                if (ingredients.length > 0) {
                    return {
                        title: 'Product wardrobe tip',
                        body: `Use ${productName} more consistently this week—pair it with your nightly routine for the best payoff.`,
                        data: {
                            type: 'ingredient',
                            ingredient: 'general',
                            product_name: productName,
                        },
                    };
                }

                return null;
            };

            for (const user of users) {
                const tokens = user.deviceTokens.map((dt) => dt.token);
                if (tokens.length === 0) continue;

                let suggestion: { title: string; body: string; data: Record<string, string> } | null = null;

                for (const product of user.products) {
                    suggestion = buildSuggestion(product);
                    if (suggestion) break;
                }

                if (!suggestion) {
                    continue;
                }

                await this.sendMulticastNotification(
                    tokens,
                    suggestion.title,
                    suggestion.body,
                    suggestion.data
                );
            }
        } catch (error) {
            console.error('Error sending ingredient recommendations:', error);
        }
    }

    /**
     * Send question of the day
     */
    static async sendQuestionOfTheDay() {
        try {
            console.log('Sending question of the day...');
            const tokens = await prisma.deviceToken.findMany({
                where: {
                    user: {
                        notificationPreferences: {
                            questionsOfTheDay: true,
                        },
                    },
                },
                select: { token: true },
            });

            // Fetch today's question
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const q = await prisma.questionOfTheDay.findUnique({
                where: { date: today },
            });

            const body = q ? q.question : 'Check out today\'s question!';

            const tokenStrings = tokens.map((t) => t.token);
            await this.sendMulticastNotification(
                tokenStrings,
                'Question of the Day ❓',
                body,
                { type: 'question' }
            );
        } catch (error) {
            console.error('Error sending question of the day:', error);
        }
    }

    /**
     * Send UV alerts to users who opted in and shared their location
     */
    static async sendUVAlerts() {
        try {
            console.log('Sending UV alerts...');

            const users = await prisma.user.findMany({
                where: {
                    notificationPreferences: {
                        uvIndexAlerts: true,
                    },
                    latitude: {
                        not: null,
                    },
                    longitude: {
                        not: null,
                    },
                    deviceTokens: {
                        some: {},
                    },
                },
                select: {
                    userId: true,
                    latitude: true,
                    longitude: true,
                    deviceTokens: {
                        select: { token: true },
                    },
                },
            });

            if (users.length === 0) {
                console.log('No UV alert subscribers with location + device tokens.');
                return;
            }

            const cache = new Map<string, ReturnType<typeof fetchUVIndex>>();

            const getUVSummary = (lat: number, lon: number) => {
                const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
                if (!cache.has(key)) {
                    cache.set(key, fetchUVIndex(lat, lon));
                }
                return cache.get(key)!;
            };

            for (const user of users) {
                const latitude = user.latitude!;
                const longitude = user.longitude!;
                const tokens = user.deviceTokens.map((dt) => dt.token);

                if (tokens.length === 0) {
                    continue;
                }

                let summary;
                try {
                    summary = await getUVSummary(latitude, longitude);
                } catch (error) {
                    console.error(`Failed to fetch UV summary for ${latitude},${longitude}:`, error);
                    continue;
                }

                const uvIndex = summary.uvIndex;

                // Only alert when UV is high (>=5) to avoid spamming users.
                if (uvIndex < 5) {
                    continue;
                }

                const advice = describeUVRisk(uvIndex);
                const body = `${advice.detail} ${advice.recommendation}`;

                await this.sendMulticastNotification(
                    tokens,
                    advice.headline,
                    body,
                    {
                        type: 'uv',
                        uv_index: uvIndex.toFixed(1),
                        level: advice.level,
                        observed_at: summary.observedAt,
                        latitude: latitude.toFixed(4),
                        longitude: longitude.toFixed(4),
                    }
                );
            }
        } catch (error) {
            console.error('Error sending UV alerts:', error);
        }
    }
}
