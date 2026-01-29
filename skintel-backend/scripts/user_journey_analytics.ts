import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface UserJourneyReport {
    userId: string;
    email: string | null;
    createdAt: Date;
    // Subscription
    isActive: boolean;
    planType: string;
    subscriptionExpiresAt: Date | null;
    totalTransactions: number;
    hasActiveSubscription: boolean;
    hasCancelledSubscription: boolean;
    // Onboarding
    onboardingStatus: string;
    totalOnboardingAnswers: number;
    // Analysis
    totalAnalyses: number;
    latestAnalysisScore: number | null;
    initialAnalysisDate: Date | null;
    // Tasks/Routines
    totalTasksAssigned: number;
    totalTasksCompleted: number;
    taskCompletionRate: number;
    currentStreak: number;
    // Engagement
    totalSkinFeels: number;
    totalWaterLogs: number;
    totalProducts: number;
    daysActive: number;
    lastActivityDate: Date | null;
}

async function main() {
    console.error('Starting user journey analytics...\n');

    const users = await prisma.user.findMany({
        include: {
            transactions: { orderBy: { createdAt: 'desc' } },
            onboardingSession: true,
            answers: true,
            facialLandmarks: { orderBy: { createdAt: 'asc' } },
            Task: true,
            TaskCompletion: { orderBy: { completedAt: 'desc' } },
            skinFeels: true,
            waterIntakeLogs: true,
            products: true,
        },
        orderBy: { createdAt: 'desc' },
    });

    const reports: UserJourneyReport[] = [];
    const now = new Date();

    for (const user of users) {
        // Subscription Analysis
        const hasActiveSubscription = user.isActive &&
            (user.subscriptionExpiresAt ? user.subscriptionExpiresAt > now : false);

        const hasCancelledSubscription = !user.isActive && user.transactions.length > 0;

        // Task Completion Analysis
        const totalTasksAssigned = user.Task.length;
        const totalTasksCompleted = user.TaskCompletion.length;
        const taskCompletionRate = totalTasksAssigned > 0
            ? Math.round((totalTasksCompleted / totalTasksAssigned) * 100)
            : 0;

        // Calculate streak (consecutive days with completions)
        let currentStreak = 0;
        if (user.TaskCompletion.length > 0) {
            const completionDates = [...new Set(
                user.TaskCompletion.map(tc => tc.completedAt.toISOString().split('T')[0])
            )].sort().reverse();

            const today = now.toISOString().split('T')[0];
            let checkDate = new Date(today);

            for (const dateStr of completionDates) {
                const diffDays = Math.floor((checkDate.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays <= 1) {
                    currentStreak++;
                    checkDate = new Date(dateStr);
                } else {
                    break;
                }
            }
        }

        // Latest analysis score
        const completedAnalyses = user.facialLandmarks.filter(fl => fl.status === 'COMPLETED');
        const latestAnalysis = completedAnalyses[completedAnalyses.length - 1];
        const initialAnalysis = completedAnalyses[0];

        // Days active (unique days with any activity)
        const activityDates = new Set<string>();
        user.TaskCompletion.forEach(tc => activityDates.add(tc.completedAt.toISOString().split('T')[0]));
        user.skinFeels.forEach(sf => activityDates.add(sf.createdAt.toISOString().split('T')[0]));
        user.waterIntakeLogs.forEach(wl => activityDates.add(wl.date.toISOString().split('T')[0]));

        // Last activity
        const activityTimestamps = [
            ...user.TaskCompletion.map(tc => tc.timestamp),
            ...user.skinFeels.map(sf => sf.createdAt),
            ...user.waterIntakeLogs.map(wl => wl.updatedAt),
        ].filter(Boolean).sort((a, b) => b.getTime() - a.getTime());

        reports.push({
            userId: user.userId,
            email: user.email,
            createdAt: user.createdAt,
            isActive: user.isActive,
            planType: user.planType,
            subscriptionExpiresAt: user.subscriptionExpiresAt,
            totalTransactions: user.transactions.length,
            hasActiveSubscription,
            hasCancelledSubscription,
            onboardingStatus: user.onboardingSession?.status || 'not_started',
            totalOnboardingAnswers: user.answers.length,
            totalAnalyses: completedAnalyses.length,
            latestAnalysisScore: latestAnalysis?.score || null,
            initialAnalysisDate: initialAnalysis?.createdAt || null,
            totalTasksAssigned,
            totalTasksCompleted,
            taskCompletionRate,
            currentStreak,
            totalSkinFeels: user.skinFeels.length,
            totalWaterLogs: user.waterIntakeLogs.length,
            totalProducts: user.products.length,
            daysActive: activityDates.size,
            lastActivityDate: activityTimestamps[0] || null,
        });
    }

    // Print Header
    console.log([
        'User ID',
        'Email',
        'Created At',
        'Is Active',
        'Plan Type',
        'Subscription Expires',
        'Total Transactions',
        'Has Active Subscription',
        'Has Cancelled',
        'Onboarding Status',
        'Onboarding Answers',
        'Total Analyses',
        'Latest Score',
        'Initial Analysis Date',
        'Tasks Assigned',
        'Tasks Completed',
        'Completion Rate %',
        'Current Streak',
        'Skin Feels Logged',
        'Water Logs',
        'Products Scanned',
        'Days Active',
        'Last Activity',
    ].join('\t'));

    // Print each user
    for (const r of reports) {
        console.log([
            r.userId,
            r.email || 'N/A',
            r.createdAt.toISOString().split('T')[0],
            r.isActive ? 'Yes' : 'No',
            r.planType,
            r.subscriptionExpiresAt?.toISOString().split('T')[0] || 'N/A',
            r.totalTransactions,
            r.hasActiveSubscription ? 'Yes' : 'No',
            r.hasCancelledSubscription ? 'Yes' : 'No',
            r.onboardingStatus,
            r.totalOnboardingAnswers,
            r.totalAnalyses,
            r.latestAnalysisScore ?? 'N/A',
            r.initialAnalysisDate?.toISOString().split('T')[0] || 'N/A',
            r.totalTasksAssigned,
            r.totalTasksCompleted,
            r.taskCompletionRate,
            r.currentStreak,
            r.totalSkinFeels,
            r.totalWaterLogs,
            r.totalProducts,
            r.daysActive,
            r.lastActivityDate?.toISOString().split('T')[0] || 'N/A',
        ].join('\t'));
    }

    // Summary Stats
    const totalUsers = reports.length;
    const activeSubscribers = reports.filter(r => r.hasActiveSubscription).length;
    const cancelledSubscribers = reports.filter(r => r.hasCancelledSubscription).length;
    const avgCompletionRate = reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + r.taskCompletionRate, 0) / reports.length)
        : 0;
    const usersWithAnalysis = reports.filter(r => r.totalAnalyses > 0).length;

    console.error('\n--- SUMMARY ---');
    console.error(`Total Users: ${totalUsers}`);
    console.error(`Active Subscribers: ${activeSubscribers}`);
    console.error(`Cancelled Subscribers: ${cancelledSubscribers}`);
    console.error(`Users with Analysis: ${usersWithAnalysis}`);
    console.error(`Avg Task Completion Rate: ${avgCompletionRate}%`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
