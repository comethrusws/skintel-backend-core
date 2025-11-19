import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

interface WaterIntakeSuggestion {
    amount: number;
    unit: string;
    reason: string;
}

export class WaterIntakeService {
    static async getWaterIntakeSuggestion(userId: string): Promise<WaterIntakeSuggestion> {
        const latestLandmarks = await prisma.facialLandmarks.findFirst({
            where: {
                OR: [
                    { userId: userId },
                    { answer: { userId: userId } }
                ]
            },
            orderBy: { createdAt: 'desc' },
            include: {
                answer: true
            }
        });

        const defaultSuggestion: WaterIntakeSuggestion = {
            amount: 2500,
            unit: 'ml',
            reason: 'General recommendation for healthy skin hydration.'
        };

        if (!latestLandmarks) {
            return defaultSuggestion;
        }

        if ((latestLandmarks as any).waterIntakeSuggestion) {
            return (latestLandmarks as any).waterIntakeSuggestion as WaterIntakeSuggestion;
        }

        try {
            const analysis = latestLandmarks.analysis as any;
            const analysisSummary = analysis?.overall_assessment || 'No specific analysis available.';

            const prompt = `
        Based on the following skin analysis summary, suggest a daily water intake amount (in ml) and provide a brief reason (under 20 words).
        Skin Analysis: "${analysisSummary}"
        
        Respond strictly in the following example JSON format:
        {
          "amount": 2500,
          "unit": "ml",
          "reason": "To combat dryness..."
        }
      `;

            const completion = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a dermatologist assistant.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            let suggestion: WaterIntakeSuggestion;

            try {
                suggestion = JSON.parse(content) as WaterIntakeSuggestion;
            } catch (e) {
                console.error('Failed to parse OpenAI response for water intake:', content);
                return defaultSuggestion;
            }

            if (!suggestion.amount || !suggestion.unit || !suggestion.reason) {
                return defaultSuggestion;
            }

            await prisma.facialLandmarks.update({
                where: { id: latestLandmarks.id },
                data: {
                    waterIntakeSuggestion: suggestion
                } as any
            });

            return suggestion;

        } catch (error) {
            console.error('Error generating water intake suggestion:', error);
            return defaultSuggestion;
        }
    }
}
