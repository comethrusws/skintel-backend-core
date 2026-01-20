import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

export class QuestionOfTheDayService {
    static async generateWeeklyQuestions(): Promise<void> {
        console.log('Generating weekly questions of the day...');

        const prompt = `
      Generate 7 distinct, engaging, and skincare-related "Questions of the Day" for the upcoming week.
      These questions should encourage users to reflect on their skin health, habits, or product usage.
      
      Requirements:
      - 4 options per question.
      - One correct option marked as correct.
      - Educational and fun.
      
      Respond strictly in the following JSON format:
      {
        "questions": [
          { 
            "question": "Which ingredient is best for hydration?", 
            "options": [
              { "text": "Hyaluronic Acid", "isCorrect": true },
              { "text": "Salicylic Acid", "isCorrect": false },
              { "text": "Retinol", "isCorrect": false },
              { "text": "Benzoyl Peroxide", "isCorrect": false }
            ],
            "category": "Ingredients"
          },
          ...
        ]
      }
    `;

        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a skincare expert.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content) as { questions: { question: string; options: { text: string; isCorrect: boolean }[]; category?: string }[] };

            if (!parsed.questions || parsed.questions.length !== 7) {
                console.error('Invalid response from OpenAI:', content);
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (let i = 0; i < 7; i++) {
                const questionDate = new Date(today);
                questionDate.setDate(today.getDate() + i);

                const q = parsed.questions[i];

                await prisma.questionOfTheDay.upsert({
                    where: { date: questionDate },
                    update: {
                        question: q.question,
                        options: q.options, // Prisma stores JSON automatically
                        category: q.category
                    },
                    create: {
                        date: questionDate,
                        question: q.question,
                        options: q.options,
                        category: q.category
                    }
                });
            }

            console.log('Weekly questions generated successfully.');
        } catch (error) {
            console.error('Error generating questions:', error);
            throw error;
        }
    }

    static async getQuestionForToday(): Promise<{ question: string; options: { text: string; isCorrect: boolean }[]; category: string | null } | null> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let q = await prisma.questionOfTheDay.findUnique({
            where: { date: today }
        });

        if (!q) {
            console.warn('No question found for today. Triggering generation...');
            try {
                await this.generateWeeklyQuestions();
                q = await prisma.questionOfTheDay.findUnique({
                    where: { date: today }
                });
            } catch (error) {
                console.error('Failed to generate fallback questions:', error);
            }
        }

        if (!q) {
            return {
                question: "How is your skin feeling today?",
                options: [
                    { text: "Great", isCorrect: true },
                    { text: "Okay", isCorrect: false },
                    { text: "Needs attention", isCorrect: false }
                ],
                category: "General"
            };
        }

        return {
            question: q.question,
            options: (q.options as unknown as { text: string; isCorrect: boolean }[]) || [],
            category: q.category
        };
    }

    static async ensureQuestionsForWeek(): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const count = await prisma.questionOfTheDay.count({
            where: {
                date: {
                    gte: today
                }
            }
        });

        if (count < 1) {
            console.log('No future questions found on startup. Generating...');
            await this.generateWeeklyQuestions();
        }
    }
}
