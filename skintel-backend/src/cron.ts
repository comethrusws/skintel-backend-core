import cron from 'node-cron';
import { SkinTipService } from './services/skinTip';
import { NotificationService } from './services/notifications';

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

    console.log('Cron jobs initialized.');
}
