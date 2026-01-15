import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

type TimeSlot = 'morning' | 'afternoon' | 'evening';

interface RoutineMessageContent {
    title: string;
    body: string;
}

export class RoutineMessageService {
    static async generateWeeklyMessages(): Promise<void> {
        console.log('Generating weekly routine messages...');

        const prompt = `
You are a GenZ skincare app notification writer. Generate 21 unique push notification messages for a skincare routine reminder app.

Requirements:
- 7 messages for MORNING (bright, energizing, fun to start the day)
- 7 messages for AFTERNOON (chill check-in, encourage logging progress)
- 7 messages for EVENING (cozy, relaxing, pre-bedtime vibes)

Style guidelines:
- Use GenZ language naturally (bestie, slay, no cap, lowkey, vibes, main character, etc.)
- Include 2-3 relevant emojis per message
- Apply psychology: curiosity, FOMO, positive reinforcement, streaks mentality
- Keep titles under 30 characters
- Keep body under 80 characters
- NEVER feel spammy or annoying - be a supportive friend
- Vary the tone and approach each day
- Sometimes be funny, sometimes motivational, sometimes chill

Respond strictly in this JSON format:
{
  "morning": [
    { "title": "Rise & slay ☀️", "body": "Your skin is waiting bestie! AM routine time ✨" },
    ...6 more
  ],
  "afternoon": [
    { "title": "Midday check ✨", "body": "How's that glow holding up? Log your progress! 📝" },
    ...6 more
  ],
  "evening": [
    { "title": "Wind down time 🌙", "body": "Wash the day away before bed! Your skin will thank u 🧖‍♀️" },
    ...6 more
  ]
}
`;

        try {
            const completion = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a creative GenZ copywriter for a skincare app. Your notifications should feel like texts from a supportive friend, not a brand.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content) as {
                morning: RoutineMessageContent[];
                afternoon: RoutineMessageContent[];
                evening: RoutineMessageContent[];
            };

            if (!parsed.morning || parsed.morning.length !== 7 ||
                !parsed.afternoon || parsed.afternoon.length !== 7 ||
                !parsed.evening || parsed.evening.length !== 7) {
                console.error('Invalid response from OpenAI:', content);
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const timeSlots: TimeSlot[] = ['morning', 'afternoon', 'evening'];

            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
                const messageDate = new Date(today);
                messageDate.setDate(today.getDate() + dayOffset);

                for (const slot of timeSlots) {
                    const msg = parsed[slot][dayOffset];

                    await prisma.routineMessage.upsert({
                        where: {
                            date_timeSlot: {
                                date: messageDate,
                                timeSlot: slot
                            }
                        },
                        update: {
                            title: msg.title,
                            body: msg.body
                        },
                        create: {
                            date: messageDate,
                            timeSlot: slot,
                            title: msg.title,
                            body: msg.body
                        }
                    });
                }
            }

            console.log('Weekly routine messages generated successfully.');
        } catch (error) {
            console.error('Error generating routine messages:', error);
            throw error;
        }
    }

    static async getMessageForToday(timeSlot: TimeSlot): Promise<RoutineMessageContent> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let message = await prisma.routineMessage.findUnique({
            where: {
                date_timeSlot: {
                    date: today,
                    timeSlot: timeSlot
                }
            }
        });

        if (!message) {
            console.warn(`No ${timeSlot} message found for today. Triggering generation...`);
            try {
                await this.generateWeeklyMessages();
                message = await prisma.routineMessage.findUnique({
                    where: {
                        date_timeSlot: {
                            date: today,
                            timeSlot: timeSlot
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to generate fallback messages:', error);
            }
        }

        // Fallback messages
        const fallbacks: Record<TimeSlot, RoutineMessageContent> = {
            morning: {
                title: 'Good Morning! ☀️',
                body: "Time for your morning skincare routine. Let's glow! ✨"
            },
            afternoon: {
                title: 'Afternoon Check-in 🌤️',
                body: "How's your skin feeling? Don't forget to log your progress! 📝"
            },
            evening: {
                title: 'Evening Routine 🌙',
                body: "Wind down with your skincare routine before bed! 🧖‍♀️"
            }
        };

        if (!message) {
            return fallbacks[timeSlot];
        }

        return {
            title: message.title,
            body: message.body
        };
    }

    static async ensureMessagesForWeek(): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const count = await prisma.routineMessage.count({
            where: {
                date: {
                    gte: today
                }
            }
        });

        if (count < 3) {
            console.log('No future routine messages found on startup. Generating...');
            await this.generateWeeklyMessages();
        }
    }
}
