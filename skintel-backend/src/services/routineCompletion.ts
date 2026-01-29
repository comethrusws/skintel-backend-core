import { prisma } from '../lib/prisma';
import { MetaConversionService } from './meta';

export class RoutineCompletionService {
    /**
     * Calculate daily routine completion for a specific user and date.
     * Returns the number of tasks completed, total tasks, and completion rate.
     */
    static async calculateDailyCompletion(userId: string, date: Date): Promise<{
        tasksCompleted: number;
        totalTasks: number;
        completionRate: number;
    }> {
        const dateStr = date.toISOString().split('T')[0];
        const startOfDay = new Date(dateStr);
        const endOfDay = new Date(dateStr);
        endOfDay.setDate(endOfDay.getDate() + 1);

        // Get user's active plan to determine current week
        const activePlan = await prisma.facialLandmarks.findFirst({
            where: {
                userId,
                planStartDate: { not: null }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!activePlan || !activePlan.planStartDate) {
            return { tasksCompleted: 0, totalTasks: 0, completionRate: 0 };
        }

        // Calculate which week the user is in
        const daysSinceStart = Math.floor(
            (date.getTime() - activePlan.planStartDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);

        // Get all active tasks for the user's current week
        const tasks = await prisma.task.findMany({
            where: {
                userId,
                isActive: true,
                week: currentWeek
            }
        });

        const totalTasks = tasks.length;

        if (totalTasks === 0) {
            return { tasksCompleted: 0, totalTasks: 0, completionRate: 0 };
        }

        // Get completions for this specific date
        const completions = await prisma.taskCompletion.findMany({
            where: {
                userId,
                completedAt: {
                    gte: startOfDay,
                    lt: endOfDay
                }
            }
        });

        // Count unique task completions for the day
        const uniqueCompletedTaskIds = new Set(completions.map(c => c.taskId));
        const tasksCompleted = uniqueCompletedTaskIds.size;
        const completionRate = (tasksCompleted / totalTasks) * 100;

        return {
            tasksCompleted,
            totalTasks,
            completionRate: Math.round(completionRate * 100) / 100 // Round to 2 decimal places
        };
    }

    /**
     * Main cron job function: Track daily routine completions for all active subscribers.
     * Calculates completion rates, sends data to Meta, and saves to database.
     */
    static async trackDailyCompletionsForActiveUsers(): Promise<{
        processed: number;
        succeeded: number;
        failed: number;
    }> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateStr = today.toISOString().split('T')[0];

        console.log(`[RoutineCompletion] Starting daily tracking for ${dateStr}`);

        // Get all users with active subscriptions
        const activeUsers = await prisma.user.findMany({
            where: {
                isActive: true,
                deletedAt: null,
                subscriptionExpiresAt: {
                    gt: new Date() // Subscription not expired
                }
            },
            select: {
                userId: true,
                email: true
            }
        });

        console.log(`[RoutineCompletion] Found ${activeUsers.length} active subscribers`);

        let processed = 0;
        let succeeded = 0;
        let failed = 0;

        for (const user of activeUsers) {
            try {
                processed++;

                // Calculate daily completion
                const completion = await this.calculateDailyCompletion(user.userId, today);

                // Skip users with no tasks configured
                if (completion.totalTasks === 0) {
                    console.log(`[RoutineCompletion] User ${user.userId}: No tasks configured, skipping`);
                    continue;
                }

                // Save to database (upsert to handle re-runs)
                await prisma.dailyRoutineCompletion.upsert({
                    where: {
                        userId_date: {
                            userId: user.userId,
                            date: today
                        }
                    },
                    update: {
                        tasksCompleted: completion.tasksCompleted,
                        totalTasks: completion.totalTasks,
                        completionRate: completion.completionRate
                    },
                    create: {
                        userId: user.userId,
                        date: today,
                        tasksCompleted: completion.tasksCompleted,
                        totalTasks: completion.totalTasks,
                        completionRate: completion.completionRate,
                        sentToMeta: false
                    }
                });

                // Send to Meta CAPI
                const metaSuccess = await MetaConversionService.sendEvent(
                    'routine_completion_tracked',
                    {
                        externalId: user.userId,
                        email: user.email || undefined
                    },
                    {
                        tasksCompleted: completion.tasksCompleted,
                        totalTasks: completion.totalTasks,
                        completionRate: completion.completionRate,
                        date: dateStr
                    },
                    undefined,
                    'app'
                );

                // Update sentToMeta flag
                if (metaSuccess) {
                    await prisma.dailyRoutineCompletion.update({
                        where: {
                            userId_date: {
                                userId: user.userId,
                                date: today
                            }
                        },
                        data: { sentToMeta: true }
                    });
                }

                console.log(
                    `[RoutineCompletion] User ${user.userId}: ${completion.tasksCompleted}/${completion.totalTasks} (${completion.completionRate}%) - Meta: ${metaSuccess ? 'sent' : 'failed'}`
                );

                succeeded++;
            } catch (error) {
                failed++;
                console.error(`[RoutineCompletion] Error processing user ${user.userId}:`, error);
            }
        }

        console.log(
            `[RoutineCompletion] Completed: ${succeeded} succeeded, ${failed} failed out of ${processed} processed`
        );

        return { processed, succeeded, failed };
    }

    /**
     * Get routine completion history for a user.
     * Useful for analytics dashboards.
     */
    static async getCompletionHistory(userId: string, days: number = 30): Promise<any[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        return prisma.dailyRoutineCompletion.findMany({
            where: {
                userId,
                date: { gte: startDate }
            },
            orderBy: { date: 'desc' },
            select: {
                date: true,
                tasksCompleted: true,
                totalTasks: true,
                completionRate: true
            }
        });
    }
}
