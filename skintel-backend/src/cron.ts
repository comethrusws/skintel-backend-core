import cron from 'node-cron';
import { SkinTipService } from './services/skinTip';

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

    console.log('Cron jobs initialized.');
}
