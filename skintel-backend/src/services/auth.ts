import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import {
    generateUserId,
    generateAccessToken,
    generateRefreshToken,
    generatePasswordResetToken,
    hashPassword,
    verifyPassword
} from '../utils/auth';
import { generateTasksForUser } from './tasks';
import { verifyClerkSessionToken } from '../lib/clerk';
import { AuthResponse, RefreshTokenResponse, LogoutResponse } from '../types';

export class AuthService {
    static async signup(data: { session_id: string; email: string; password: string }): Promise<AuthResponse> {
        const { session_id, email, password } = data;

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new Error('User already exists');
        }

        const session = await prisma.anonymousSession.findUnique({
            where: { sessionId: session_id },
            include: { answers: true },
        });

        if (!session || session.expiresAt < new Date()) {
            throw new Error('Session not found or expired');
        }

        const userId = generateUserId();
        const accessToken = generateAccessToken(userId);
        const refreshToken = generateRefreshToken();
        const passwordHash = await hashPassword(password);

        await prisma.user.create({
            data: {
                userId,
                email,
                passwordHash,
            },
        });

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });

        const sessionMerged = await this.mergeSessionToUser(session_id, userId);

        return {
            user_id: userId,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
            session_merged: sessionMerged,
        };
    }

    static async login(data: { session_id: string; email: string; password: string }): Promise<AuthResponse> {
        const { session_id, email, password } = data;

        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.passwordHash) {
            throw new Error('Invalid credentials');
        }

        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
            throw new Error('Invalid credentials');
        }

        // Reactivate user if soft deleted
        if (user.deletedAt) {
            await prisma.user.update({
                where: { userId: user.userId },
                data: { deletedAt: null }
            });
        }

        const session = await prisma.anonymousSession.findUnique({
            where: { sessionId: session_id },
        });

        if (!session || session.expiresAt < new Date()) {
            throw new Error('Session not found or expired');
        }

        const accessToken = generateAccessToken(user.userId);
        const refreshToken = generateRefreshToken();

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.userId,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });

        const sessionMerged = await this.mergeSessionToUser(session_id, user.userId);

        return {
            user_id: user.userId,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
            session_merged: sessionMerged,
        };
    }

    static async sso(data: { session_id: string; provider: string; clerk_token: string; clerk_session_id: string }): Promise<AuthResponse> {
        const { session_id, provider, clerk_token, clerk_session_id } = data;

        const session = await prisma.anonymousSession.findUnique({
            where: { sessionId: session_id },
        });

        if (!session || session.expiresAt < new Date()) {
            throw new Error('Session not found or expired');
        }

        const verifiedSession = await verifyClerkSessionToken(clerk_token);

        if (!verifiedSession) {
            throw new Error('Invalid or expired Clerk token');
        }

        if (verifiedSession.sessionId !== clerk_session_id) {
            throw new Error('Mismatched Clerk session');
        }

        const detectedProvider = verifiedSession.provider;

        if (provider !== detectedProvider) {
            console.warn(`Clerk provider mismatch: client sent ${provider}, but Clerk verified as ${detectedProvider}. Using detected provider.`);
        }

        const ssoId = verifiedSession.clerkUserId;

        let user = await prisma.user.findUnique({
            where: {
                ssoProvider_ssoId: {
                    ssoProvider: detectedProvider,
                    ssoId,
                },
            },
        });

        if (!user && verifiedSession.email) {
            user = await prisma.user.findUnique({
                where: {
                    email: verifiedSession.email,
                },
            });

            if (user && !user.ssoProvider && !user.ssoId) {
                user = await prisma.user.update({
                    where: { userId: user.userId },
                    data: {
                        ssoProvider: detectedProvider,
                        ssoId,
                        name: user.name || ([verifiedSession.firstName, verifiedSession.lastName]
                            .filter(Boolean)
                            .join(' ')
                            .trim() || undefined),
                    },
                });
            } else if (user && user.ssoProvider && user.ssoProvider !== detectedProvider) {
                console.log(`User ${user.userId} switching from ${user.ssoProvider} to ${detectedProvider}`);
                user = await prisma.user.update({
                    where: { userId: user.userId },
                    data: {
                        ssoProvider: detectedProvider,
                        ssoId,
                        name: user.name || ([verifiedSession.firstName, verifiedSession.lastName]
                            .filter(Boolean)
                            .join(' ')
                            .trim() || undefined),
                    },
                });
            }
        }

        if (!user) {
            const userId = generateUserId();
            user = await prisma.user.create({
                data: {
                    userId,
                    ssoProvider: detectedProvider,
                    ssoId,
                    email: verifiedSession.email || undefined,
                    name: [verifiedSession.firstName, verifiedSession.lastName]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || undefined,
                },
            });
        }

        // Reactivate user if soft deleted
        if (user.deletedAt) {
            await prisma.user.update({
                where: { userId: user.userId },
                data: { deletedAt: null }
            });
        }

        const accessToken = generateAccessToken(user.userId);
        const refreshToken = generateRefreshToken();

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.userId,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });

        const sessionMerged = await this.mergeSessionToUser(session_id, user.userId);

        return {
            user_id: user.userId,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
            session_merged: sessionMerged,
        };
    }

    static async refreshToken(token: string): Promise<RefreshTokenResponse> {
        const tokenRecord = await prisma.refreshToken.findUnique({
            where: { token },
            include: { user: true },
        });

        if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
            throw new Error('Invalid refresh token');
        }

        const newAccessToken = generateAccessToken(tokenRecord.userId);
        const newRefreshToken = generateRefreshToken();

        await prisma.$transaction([
            prisma.refreshToken.delete({
                where: { token },
            }),
            prisma.refreshToken.create({
                data: {
                    token: newRefreshToken,
                    userId: tokenRecord.userId,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
            }),
        ]);

        return {
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            expires_in: 3600,
        };
    }

    static async logout(userId: string, refreshToken: string): Promise<LogoutResponse> {
        await prisma.refreshToken.deleteMany({
            where: {
                token: refreshToken,
                userId,
            },
        });

        return {
            status: 'logged_out',
        };
    }

    static async requestPasswordReset(email: string): Promise<{ reset_token: string; expires_at: string }> {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new Error('User not found');
        }

        await prisma.passwordResetToken.deleteMany({
            where: { userId: user.userId },
        });

        const resetToken = generatePasswordResetToken();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.passwordResetToken.create({
            data: {
                token: resetToken,
                userId: user.userId,
                expiresAt,
            },
        });

        return {
            reset_token: resetToken,
            expires_at: expiresAt.toISOString(),
        };
    }

    static async confirmPasswordReset(data: { reset_token: string; new_password: string }): Promise<{ message: string }> {
        const { reset_token, new_password } = data;

        const resetTokenRecord = await prisma.passwordResetToken.findUnique({
            where: { token: reset_token },
            include: { user: true },
        });

        if (!resetTokenRecord || resetTokenRecord.expiresAt < new Date()) {
            throw new Error('Invalid or expired reset token');
        }

        const passwordHash = await hashPassword(new_password);

        await prisma.$transaction([
            prisma.user.update({
                where: { userId: resetTokenRecord.userId },
                data: { passwordHash },
            }),
            prisma.passwordResetToken.delete({
                where: { token: reset_token },
            }),
            prisma.refreshToken.deleteMany({
                where: { userId: resetTokenRecord.userId },
            }),
        ]);

        return {
            message: 'Password reset successfully',
        };
    }

    static async mergeSessionToUser(sessionId: string, userId: string): Promise<boolean> {
        try {
            const answers = await prisma.onboardingAnswer.findMany({
                where: { sessionId },
                select: { answerId: true },
            });
            const answerIds = answers.map((a: { answerId: string }) => a.answerId);

            const existingUserSession = await prisma.onboardingSession.findUnique({
                where: { userId },
            });

            await prisma.$transaction([
                prisma.facialLandmarks.updateMany({
                    where: { answerId: { in: answerIds } },
                    data: { userId }
                }),

                prisma.onboardingAnswer.updateMany({
                    where: { sessionId },
                    data: {
                        userId,
                        sessionId: null,
                    },
                }),

                ...(existingUserSession
                    ? [
                        prisma.onboardingSession.deleteMany({
                            where: { sessionId },
                        })
                    ]
                    : [
                        prisma.onboardingSession.updateMany({
                            where: { sessionId },
                            data: {
                                userId,
                                sessionId: null,
                            },
                        })
                    ]
                ),

                prisma.anonymousSession.update({
                    where: { sessionId },
                    data: { mergedToUserId: userId },
                }),
            ]);

            // trigger task generation for any new user
            try {
                console.log(`[TaskGen] Attempting to generate tasks for user ${userId}`);
                const facialLandmark = await prisma.facialLandmarks.findFirst({
                    where: {
                        userId,
                        status: 'COMPLETED',
                        weeklyPlan: { not: Prisma.DbNull }
                    },
                    orderBy: { createdAt: 'desc' }
                });

                console.log(`[TaskGen] Found landmark:`, facialLandmark ? 'yes' : 'no');

                if (facialLandmark && facialLandmark.weeklyPlan) {
                    console.log(`[TaskGen] Landmark has weekly plan, proceeding...`);
                    const weeklyPlan = typeof facialLandmark.weeklyPlan === 'string'
                        ? JSON.parse(facialLandmark.weeklyPlan)
                        : facialLandmark.weeklyPlan;

                    const userProducts = await prisma.product.findMany({
                        where: { userId },
                        select: {
                            id: true,
                            productData: true
                        }
                    });

                    const formattedProducts = userProducts.map(p => {
                        const data = p.productData as any;
                        return {
                            id: p.id,
                            category: data?.category || 'unknown',
                            name: data?.product_name || 'Unknown Product',
                            ingredients: data?.ingredients
                        };
                    });

                    await generateTasksForUser({
                        userId,
                        weeklyPlan,
                        userProducts: formattedProducts
                    });
                    console.log(`[TaskGen] Task generation triggered successfully`);
                } else {
                    console.log(`[TaskGen] Skipping task generation: No weekly plan found (Plan exists: ${!!facialLandmark?.weeklyPlan})`);
                }
            } catch (taskError) {
                console.error('[TaskGen] Failed to generate tasks after signup/login:', taskError);
                // Don't fail the auth request if task generation fails
            }

            return true;
        } catch (error) {
            console.error('Session merge error:', error);
            return false;
        }
    }
}
