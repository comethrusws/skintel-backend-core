import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

export class CheckInService {
    static async generateWeeklyCheckIns(): Promise<void> {
        console.log('Generating weekly daily check-in questions...');

        const prompt = `
      Generate 7 distinct, friendly, and engaging "Daily Check-in" questions for a skincare app for the upcoming week.
      These questions should ask the user about their skincare progress, any changes they've noticed, allergies, skin conditions, or general well-being related to their skin.
      
      Requirements:
      - Unique and non-repetitive.
      - Friendly, supportive, and "GenZ" but professional tone (like a skin coach).
      - varied topics: improvements, reactions, routine adherence, skin feel.
      
      Respond strictly in the following JSON format:
      {
        "questions": [
          "Have you noticed any new glow after using your Vitamin C serum?",
          "Did your skin feel hydrated enough throughout the day yesterday?",
          "Any new redness or sensitivity pop up this week?",
          ...
        ]
      }
    `;

        try {
            const completion = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a supportive skincare coach.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content) as { questions: string[] };

            if (!parsed.questions || parsed.questions.length !== 7) {
                console.error('Invalid response from OpenAI:', content);
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (let i = 0; i < 7; i++) {
                const checkInDate = new Date(today);
                checkInDate.setDate(today.getDate() + i);

                const question = parsed.questions[i];

                await prisma.checkInQuestion.upsert({
                    where: { date: checkInDate },
                    update: {
                        question: question
                    },
                    create: {
                        date: checkInDate,
                        question: question
                    }
                });
            }

            console.log('Weekly check-in questions generated successfully.');
        } catch (error) {
            console.error('Error generating check-in questions:', error);
            throw error;
        }
    }

    static async getCheckInForToday(): Promise<{ question: string } | null> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let q = await prisma.checkInQuestion.findUnique({
            where: { date: today }
        });

        if (!q) {
            console.warn('No check-in question found for today. Triggering generation...');
            try {
                await this.generateWeeklyCheckIns();
                q = await prisma.checkInQuestion.findUnique({
                    where: { date: today }
                });
            } catch (error) {
                console.error('Failed to generate fallback check-in questions:', error);
            }
        }

        if (!q) {
            return {
                question: "How is your skin feeling today?"
            };
        }

        return {
            question: q.question
        };
    }

    static async ensureCheckInsForWeek(): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const count = await prisma.checkInQuestion.count({
            where: {
                date: {
                    gte: today
                }
            }
        });

        if (count < 1) {
            console.log('No future check-in questions found on startup. Generating...');
            await this.generateWeeklyCheckIns();
        }
    }
}
