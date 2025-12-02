import { prisma } from '../lib/prisma';
import { openai, OPENAI_MODEL } from './analysis';

interface WaterIntakeSuggestion {
  amount: number;
  unit: string;
  reason: string;
}

export interface WaterIntakeResponse {
  date: string;
  recommended: WaterIntakeSuggestion;
  actual: {
    amount: number;
    unit: string;
  } | null;
  progress: number | null;
}

export interface DailyWaterIntakeSummary {
  date: string; // ISO date (yyyy-mm-dd)
  actualAmount: number | null;
  actualUnit: string;
  recommended: WaterIntakeSuggestion;
  progress: number | null;
}

export class WaterIntakeService {
  static async getWaterIntakeSuggestion(userId: string): Promise<WaterIntakeResponse> {
    // Get today's date normalized to UTC midnight
    const today = this.normalizeDate();

    // Fetch recommendation
    const recommendation = await this.getRecommendation(userId);

    // Fetch today's actual intake
    const log = await prisma.waterIntakeLog.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    const actualAmount = log?.amountMl ?? null;
    const progress = actualAmount && recommendation.amount
      ? Math.min(1, actualAmount / recommendation.amount)
      : null;

    return {
      date: today.toISOString().slice(0, 10),
      recommended: recommendation,
      actual: actualAmount ? { amount: actualAmount, unit: 'ml' } : null,
      progress,
    };
  }

  private static async getRecommendation(userId: string): Promise<WaterIntakeSuggestion> {
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

  private static normalizeDate(date?: string | Date): Date {
    const d = date ? new Date(date) : new Date();
    // Normalize to UTC midnight using local date components
    // This ensures the same calendar date is used regardless of timezone
    const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return utc;
  }

  static async upsertDailyIntake(userId: string, params: { date?: string; amount: number; unit?: string }): Promise<DailyWaterIntakeSummary> {
    const { amount, unit = 'ml', date } = params;

    if (!Number.isFinite(amount)) {
      throw new Error('Amount must be a valid number');
    }

    const normalizedDate = this.normalizeDate(date);

    // Convert any future units to ml; currently we only accept ml
    let amountMl = amount;
    if (unit === 'l' || unit === 'L') {
      amountMl = Math.round(amount * 1000);
    }

    const recommendation = await this.getRecommendation(userId);

    const log = await prisma.waterIntakeLog.upsert({
      where: {
        userId_date: {
          userId,
          date: normalizedDate,
        },
      },
      create: {
        userId,
        date: normalizedDate,
        amountMl,
      },
      update: {
        amountMl: {
          increment: amountMl,
        },
      },
    });

    // Use the updated amount from the log for the return value
    const finalAmount = log.amountMl;

    const progress = finalAmount && recommendation.amount
      ? Math.min(1, finalAmount / recommendation.amount)
      : null;

    // Return normalized summary
    return {
      date: normalizedDate.toISOString().slice(0, 10),
      actualAmount: finalAmount,
      actualUnit: 'ml',
      recommended: recommendation,
      progress,
    };
  }
}
