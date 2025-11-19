import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

export class SkinTipService {
    static async generateWeeklyTips(): Promise<void> {
        console.log('Generating weekly skin tips...');

        const prompt = `
      Generate 7 distinct, practical, and scientifically accurate skin care tips for the upcoming week.
      Each tip should be concise (under 30 words) and helpful for a general audience.
      Include a category for each tip (e.g., "Hydration", "Sun Protection", "Cleansing", "Lifestyle", "Diet").
      
      Respond strictly in the following JSON format:
      {
        "tips": [
          { "content": "Drink at least 8 glasses of water...", "category": "Hydration" },
          ...
        ]
      }
    `;

        try {
            const completion = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a dermatologist assistant.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content) as { tips: { content: string; category: string }[] };

            if (!parsed.tips || parsed.tips.length !== 7) {
                console.error('Invalid response from OpenAI:', content);
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (let i = 0; i < 7; i++) {
                const tipDate = new Date(today);
                tipDate.setDate(today.getDate() + i);

                const tip = parsed.tips[i];

                await prisma.skinTip.upsert({
                    where: { date: tipDate },
                    update: {
                        content: tip.content,
                        category: tip.category
                    },
                    create: {
                        date: tipDate,
                        content: tip.content,
                        category: tip.category
                    }
                });
            }

            console.log('Weekly skin tips generated successfully.');
        } catch (error) {
            console.error('Error generating skin tips:', error);
            throw error;
        }
    }

    static async getTipForToday(): Promise<{ content: string; category: string | null } | null> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let tip = await prisma.skinTip.findUnique({
            where: { date: today }
        });

        if (!tip) {
            console.warn('No tip found for today. Triggering generation...');
            try {
                await this.generateWeeklyTips();
                tip = await prisma.skinTip.findUnique({
                    where: { date: today }
                });
            } catch (error) {
                console.error('Failed to generate fallback tips:', error);
            }
        }

        if (!tip) {
            return {
                content: "Stay hydrated and wear sunscreen every day!",
                category: "General"
            };
        }

        return {
            content: tip.content,
            category: tip.category
        };
    }

    static async ensureTipsForWeek(): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const count = await prisma.skinTip.count({
            where: {
                date: {
                    gte: today
                }
            }
        });

        if (count < 1) {
            console.log('No future tips found on startup. Generating...');
            await this.generateWeeklyTips();
        }
    }
}
