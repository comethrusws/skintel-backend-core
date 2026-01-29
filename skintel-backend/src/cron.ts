import cron from 'node-cron';
import { SkinTipService } from './services/skinTip';
import { NotificationService } from './services/notifications';
import { ProfileService } from './services/profile';
import { RoutineMessageService } from './services/routineMessage';
import { QuestionOfTheDayService } from './services/questionOfTheDay';
import { CheckInService } from './services/checkIn';
import { RoutineCompletionService } from './services/routineCompletion';

export function initCronJobs() {
    console.log('Initializing cron jobs...');

    cron.schedule('0 0 * * 0', async () => {
        console.log('Running weekly skin tip generation cron job...');
        try {
            await SkinTipService.generateWeeklyTips();
        } catch (error) {
            console.error('Error in weekly skin tip generation cron job:', error);
        }
    });

    // Weekly routine message generation (Sunday at midnight)
    cron.schedule('0 0 * * 0', async () => {
        console.log('Running weekly routine message generation cron job...');
        try {
            await RoutineMessageService.generateWeeklyMessages();
        } catch (error) {
            console.error('Error in weekly routine message generation cron job:', error);
        }
    });

    // Weekly Question of the Day Generation (Sunday at midnight)
    cron.schedule('0 0 * * 0', async () => {
        console.log('Running weekly question generation cron job...');
        try {
            await QuestionOfTheDayService.generateWeeklyQuestions();
        } catch (error) {
            console.error('Error in weekly question generation cron job:', error);
        }
    });

    // Weekly Daily Check-in Generation (Sunday at midnight)
    cron.schedule('0 0 * * 0', async () => {
        console.log('Running weekly check-in generation cron job...');
        try {
            await CheckInService.generateWeeklyCheckIns();
        } catch (error) {
            console.error('Error in weekly check-in generation cron job:', error);
        }
    });

    // Morning Routine Reminder (8:00 AM)
    cron.schedule('0 8 * * *', async () => {
        await NotificationService.sendMorningReminders();
    });

    // Afternoon Routine Reminder (2:00 PM)
    cron.schedule('0 14 * * *', async () => {
        await NotificationService.sendAfternoonReminders();
    });

    // Evening Routine Reminder (9:00 PM)
    cron.schedule('0 21 * * *', async () => {
        await NotificationService.sendEveningReminders();
    });

    // Hydration Alerts (Every 2 hours between 9 AM and 8 PM)
    cron.schedule('0 9-20/2 * * *', async () => {
        await NotificationService.sendHydrationReminders();
    });

    // Tip of the Day (10:00 AM)
    cron.schedule('0 10 * * *', async () => {
        await NotificationService.sendTipOfTheDay();
    });

    // UV Alerts (every 2 hours between 9 AM and 5 PM)
    cron.schedule('0 9-17/2 * * *', async () => {
        await NotificationService.sendUVAlerts();
    });

    // Ingredient recommendations (4:00 PM)
    cron.schedule('0 16 * * *', async () => {
        await NotificationService.sendIngredientRecommendations();
    });

    // Cleanup deleted users (3:00 AM)
    cron.schedule('0 3 * * *', async () => {
        console.log('Running deleted user cleanup cron job...');
        try {
            await ProfileService.cleanupDeletedUsers();
        } catch (error) {
            console.error('Error in deleted user cleanup cron job:', error);
        }
    });

    // Question of the Day Notification (11:00 AM)
    cron.schedule('0 11 * * *', async () => {
        await NotificationService.sendQuestionOfTheDay();
    });

    // Daily Routine Completion Tracking (11:59 PM)
    cron.schedule('59 23 * * *', async () => {
        console.log('Running daily routine completion tracking...');
        try {
            await RoutineCompletionService.trackDailyCompletionsForActiveUsers();
        } catch (error) {
            console.error('Error in daily routine completion tracking:', error);
        }
    });

    console.log('Cron jobs initialized.');
}
