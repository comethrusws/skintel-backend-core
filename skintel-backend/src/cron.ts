import cron from 'node-cron';
import { SkinTipService } from './services/skinTip';
import { NotificationService } from './services/notifications';
import { QuestionOfTheDayService } from './services/questionOfTheDay';

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

    // Morning Routine Reminder (8:00 AM)
    cron.schedule('0 8 * * *', async () => {
        await NotificationService.sendMorningReminders();
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

    // Weekly Question of the Day Generation (Sunday at midnight)
    /*
    cron.schedule('0 0 * * 0', async () => {
        console.log('Running weekly question generation cron job...');
        try {
            await QuestionOfTheDayService.generateWeeklyQuestions();
        } catch (error) {
            console.error('Error in weekly question generation cron job:', error);
        }
    });
    */

    // Question of the Day Notification (11:00 AM)
    /*
    cron.schedule('0 11 * * *', async () => {
        await NotificationService.sendQuestionOfTheDay();
    });
    */
    console.log('Cron jobs initialized.');
}
