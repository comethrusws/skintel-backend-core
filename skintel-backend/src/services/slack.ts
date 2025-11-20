import axios from 'axios';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export const sendSlackNotification = async (message: any) => {
    if (!SLACK_WEBHOOK_URL) {
        console.warn('SLACK_WEBHOOK_URL is not defined');
        return;
    }
    try {
        await axios.post(SLACK_WEBHOOK_URL, message);
    } catch (error) {
        console.error('Error sending Slack notification:', error);
    }
};
