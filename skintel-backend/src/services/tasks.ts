import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { TaskGenerationRequest, TaskAdaptationResult } from '../types';
import { getUserOnboardingProfile, formatProfileContext } from './analysis';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildTaskGenerationPrompt(): string {
  return `You are a skincare routine assistant AI specializing in personalized task generation.
You will receive a 4-week or a one week skincare improvement plan, user products, and the user's profile information.

IMPORTANT: Use the user profile to generate HYPER-PERSONALIZED daily tasks:
- ETHNICITY: Tailor products and techniques for their skin tone and ethnicity-specific needs
- AGE: Adjust product application and routine complexity based on age
- CLIMATE/WEATHER: Recommend climate-appropriate products and timings (e.g., heavier moisturizers in cold/dry climates)
- SKIN TYPE & SENSITIVITY: Adjust product quantities, frequency, and gentleness
- MEDICAL CONDITIONS: Avoid contraindicated ingredients and suggest appropriate alternatives
- SUN EXPOSURE: Emphasize sun protection based on outdoor time

Your task:
1. Convert each week's preview into 3-5 actionable daily tasks
2. Assign appropriate timing (morning/evening/anytime)
3. Categorize tasks (cleansing, treatment, moisturizing, protection, lifestyle)
4. Set priority (critical, important, optional)
5. Consider product recommendations tailored to user's profile
6. Make descriptions SPECIFIC to the user's ethnicity, climate, and skin profile

IMPORTANT FORMATTING RULES:
- Title: MUST be short (2-4 words) and high-level (e.g., "Morning Cleanse", "Vitamin C Serum", "Hydrating Moisturizer"). Do NOT include dosage or detailed instructions in the title.
- Description: MUST be actionable and include specific product quantity/dosage recommendations (e.g., "Apply a pea-sized amount", "Use 2-3 pumps", "Apply generously"). Reference user's profile when relevant (e.g., "Given your dry climate, apply extra moisturizer").

Example input:
Week 1: "Start gentle cleansing routine with salicylic acid suitable for combination skin"
User Profile: Ethnicity: South Asian, Climate: Hot, Skin Type: Combination

Example output:
{
  "week_1_tasks": [
    {
      "title": "Gentle Morning Cleanse",
      "description": "Wash face with a gentle cleanser using lukewarm water. Use about a coin-sized amount. For your combination skin in hot climate, focus on T-zone.",
      "timeOfDay": "morning",
      "category": "cleansing",
      "priority": "critical",
      "recommendedProducts": ["gentle cleanser", "face wash"]
    },
    {
      "title": "Salicylic Acid Treatment",
      "description": "Apply a pea-sized amount of salicylic acid treatment to clean, dry skin. Start 3x per week. For your skin tone, use targeted application to avoid irritation.",
      "timeOfDay": "evening",
      "category": "treatment",
      "priority": "important",
      "recommendedProducts": ["salicylic acid", "BHA treatment"]
    }
  ]
}

Return JSON with week_1_tasks, week_2_tasks, week_3_tasks, week_4_tasks arrays.`;
}

export class TasksService {
  static async generateTasksForUser(request: TaskGenerationRequest): Promise<void> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const { userId, weeklyPlan, userProducts, force } = request;

    const existingTasks = await prisma.task.findMany({
      where: { userId, isActive: true }
    });

    if (existingTasks.length > 0) {
      if (force) {
        console.log(`Forcing task regeneration for user ${userId}, deactivating ${existingTasks.length} existing tasks`);
        await prisma.task.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false }
        });
      } else {
        console.log(`Tasks already exist for user ${userId}, skipping generation`);
        return;
      }
    }

    const prompt = buildTaskGenerationPrompt();
    const planText = weeklyPlan.map(w => `Week ${w.week}: "${w.preview}"`).join('\n');

    const userProductsText = userProducts?.length
      ? `User's available products: ${userProducts.map(p => `${p.name} (${p.category})`).join(', ')}`
      : 'No user products available';

    // Fetch user profile for personalized task generation
    const userProfile = await getUserOnboardingProfile(userId, null);
    const profileContext = formatProfileContext(userProfile);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Generate daily tasks for this skincare plan:\n\n${planText}\n\n${userProductsText}${profileContext}\n\nReturn valid JSON only.`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = completion.choices?.[0]?.message?.content ?? '';

    try {
      const generatedTasks = JSON.parse(content);

      const tasksToCreate: any[] = [];

      for (let week = 1; week <= 4; week++) {
        const weekTasks = generatedTasks[`week_${week}_tasks`] || [];

        for (const task of weekTasks) {
          const matchedUserProducts = userProducts?.filter(product =>
            task.recommendedProducts?.some((rec: string) =>
              product.category.toLowerCase().includes(rec.toLowerCase()) ||
              product.name.toLowerCase().includes(rec.toLowerCase())
            )
          ).map(p => p.id) || [];

          tasksToCreate.push({
            userId,
            week,
            title: task.title,
            description: task.description,
            timeOfDay: task.timeOfDay,
            category: task.category,
            priority: task.priority,
            recommendedProducts: task.recommendedProducts,
            userProducts: matchedUserProducts.length > 0 ? matchedUserProducts : null,
            isActive: true,
            adaptations: {
              skipCount: 0
            }
          });
        }
      }

      if (tasksToCreate.length > 0) {
        await prisma.task.createMany({
          data: tasksToCreate
        });

        console.log(`Generated ${tasksToCreate.length} tasks for user ${userId}`);
      }

    } catch (error) {
      console.error('Failed to parse or create generated tasks:', error);
      throw new Error('Task generation failed');
    }
  }

  static async getTodaysTasks(userId: string): Promise<any> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const activePlan = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        planStartDate: { not: null },
        planEndDate: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!activePlan || !activePlan.planStartDate) {
      throw new Error('No active plan found');
    }

    const daysSinceStart = Math.floor(
      (today.getTime() - activePlan.planStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);
    const dayOfPlan = daysSinceStart + 1;

    const tasks = await prisma.task.findMany({
      where: {
        userId,
        week: currentWeek,
        isActive: true
      },
      orderBy: [
        { priority: 'asc' }, // critical first
        { timeOfDay: 'asc' }
      ]
    });

    const completions = await prisma.taskCompletion.findMany({
      where: {
        userId,
        completedAt: new Date(todayStr)
      }
    });

    const completionMap = new Map(completions.map(c => [c.taskId, c]));

    const userProducts = await prisma.product.findMany({
      where: { userId },
      select: {
        id: true,
        productData: true
      }
    });

    const formattedTasks = await Promise.all(tasks.map(async task => {
      const completion = completionMap.get(task.id);
      const taskUserProducts = task.userProducts ?
        userProducts.filter(p => (task.userProducts as string[]).includes(p.id))
          .map(p => {
            const data = p.productData as any;
            return {
              id: p.id,
              name: data?.product_name || 'Unknown Product',
              category: data?.category || 'unknown'
            };
          }) : [];

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        timeOfDay: task.timeOfDay,
        category: task.category,
        priority: task.priority,
        recommendedProducts: task.recommendedProducts as string[] || [],
        userProducts: taskUserProducts,
        isCompleted: !!completion,
        completedAt: completion?.timestamp
      };
    }));

    const completedCount = formattedTasks.filter(t => t.isCompleted).length;
    const totalCount = formattedTasks.length;
    const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    let dailyScore = 0;
    if (totalCount > 0) {
      let totalWeight = 0;
      let weightedScore = 0;

      formattedTasks.forEach(task => {
        const weight = task.priority === 'critical' ? 3 : task.priority === 'important' ? 2 : 1;
        totalWeight += weight;
        if (task.isCompleted) {
          weightedScore += weight * 100;
        }
      });

      dailyScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    }

    return {
      date: todayStr,
      week: currentWeek,
      dayOfPlan,
      tasks: formattedTasks,
      completionRate,
      dailyScore: Math.round(dailyScore)
    };
  }

  static async getTodaysTasksWithFallback(userId: string): Promise<any> {
    let todaysTasks = await this.getTodaysTasks(userId).catch(err => {
      if (err.message === 'No active plan found') {
        throw err;
      }
      return { tasks: [] };
    });

    if (todaysTasks.tasks.length === 0) {
      const activeTasksCount = await prisma.task.count({
        where: { userId, isActive: true }
      });

      if (activeTasksCount === 0) {
        await this.generateTasksFromPlan(userId);
        todaysTasks = await this.getTodaysTasks(userId);
      }
    }

    return todaysTasks;
  }

  static async generateTasksFromPlan(userId: string): Promise<void> {
    const latestAnalysis = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        weeklyPlan: { not: Prisma.DbNull }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (latestAnalysis && latestAnalysis.weeklyPlan) {
      const userProducts = await prisma.product.findMany({
        where: { userId },
        select: {
          id: true,
          productData: true
        }
      });

      const formattedProducts = userProducts.map(p => {
        const data = p.productData as any;
        return {
          id: p.id,
          name: data?.product_name || 'Unknown Product',
          category: data?.category || 'unknown',
          ingredients: data?.ingredients || []
        };
      });

      const weeklyPlan = typeof latestAnalysis.weeklyPlan === 'string'
        ? JSON.parse(latestAnalysis.weeklyPlan)
        : latestAnalysis.weeklyPlan;

      await this.generateTasksForUser({
        userId,
        weeklyPlan,
        userProducts: formattedProducts
      });
    } else {
      throw new Error('No weekly plan found. Complete analysis first.');
    }
  }

  static async getWeekTasks(userId: string, week: number): Promise<any> {
    const tasks = await prisma.task.findMany({
      where: {
        userId,
        week,
        isActive: true
      },
      orderBy: [
        { priority: 'asc' },
        { timeOfDay: 'asc' }
      ]
    });

    const userProducts = await prisma.product.findMany({
      where: { userId },
      select: {
        id: true,
        productData: true
      }
    });

    const formattedTasks = tasks.map(task => {
      const taskUserProducts = task.userProducts ?
        userProducts.filter(p => (task.userProducts as string[]).includes(p.id))
          .map(p => {
            const data = p.productData as any;
            return {
              id: p.id,
              name: data?.product_name || 'Unknown Product',
              category: data?.category || 'unknown'
            };
          }) : [];

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        timeOfDay: task.timeOfDay,
        category: task.category,
        priority: task.priority,
        recommendedProducts: task.recommendedProducts as string[] || [],
        userProducts: taskUserProducts
      };
    });

    return {
      week,
      tasks: formattedTasks,
      totalTasks: formattedTasks.length
    };
  }

  static async getAllTasks(userId: string): Promise<any> {
    const tasks = await prisma.task.findMany({
      where: {
        userId
      },
      orderBy: [
        { week: 'asc' },
        { priority: 'asc' },
        { timeOfDay: 'asc' }
      ]
    });

    const userProducts = await prisma.product.findMany({
      where: { userId },
      select: {
        id: true,
        productData: true
      }
    });

    const allCompletions = await prisma.taskCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' }
    });

    const activePlan = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        planStartDate: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });

    const today = new Date();
    const planStartDate = activePlan?.planStartDate || today;

    const todayMidnight = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z');
    const planStartMidnight = new Date(planStartDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    const daysSinceStart = Math.floor((todayMidnight.getTime() - planStartMidnight.getTime()) / (1000 * 60 * 60 * 24));
    const currentDay = Math.min(daysSinceStart + 1, 28);
    const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);

    const activeTasks = tasks.filter(task => task.isActive);
    const relevantTasks = activeTasks.filter(task => task.week <= currentWeek);

    const formattedTasks = relevantTasks.map(task => {
      const taskUserProducts = task.userProducts ?
        userProducts.filter(p => (task.userProducts as string[]).includes(p.id))
          .map(p => {
            const data = p.productData as any;
            return {
              id: p.id,
              name: data?.product_name || 'Unknown Product',
              category: data?.category || 'unknown'
            };
          }) : [];

      const taskCompletions = allCompletions.filter(c => c.taskId === task.id);

      const todayStr = today.toISOString().split('T')[0];

      const weekStartDay = (task.week - 1) * 7 + 1;
      const weekEndDay = Math.min(task.week * 7, currentDay - 1);
      const daysExpected = Math.max(0, weekEndDay - weekStartDay + 1);

      const taskWeekStart = new Date(planStartDate);
      taskWeekStart.setDate(taskWeekStart.getDate() + (task.week - 1) * 7);
      const taskWeekStartStr = taskWeekStart.toISOString().split('T')[0];

      const taskWeekEnd = new Date(planStartDate);
      taskWeekEnd.setDate(taskWeekEnd.getDate() + task.week * 7 - 1);
      const taskWeekEndStr = taskWeekEnd.toISOString().split('T')[0];

      const completionDates = taskCompletions
        .map(c => c.completedAt.toISOString().split('T')[0])
        .filter(date => date < todayStr && date >= taskWeekStartStr && date <= taskWeekEndStr);

      const uniqueCompletionDates = [...new Set(completionDates)];
      const completedDays = uniqueCompletionDates.length;
      const missedDays = Math.max(0, daysExpected - completedDays);

      return {
        id: task.id,
        week: task.week,
        title: task.title,
        description: task.description,
        timeOfDay: task.timeOfDay,
        category: task.category,
        priority: task.priority,
        isActive: task.isActive,
        recommendedProducts: task.recommendedProducts as string[] || [],
        userProducts: taskUserProducts,
        completionStats: {
          completedDays,
          missedDays,
          daysExpected,
          completionRate: daysExpected > 0 ? Math.round((completedDays / daysExpected) * 100) : 0,
          completionDates
        }
      };
    }).filter(task => task.completionStats.daysExpected > 0); // Only include tasks with past expected days

    const totalCompleted = formattedTasks.reduce((sum, t) => sum + t.completionStats.completedDays, 0);
    const totalMissed = formattedTasks.reduce((sum, t) => sum + t.completionStats.missedDays, 0);
    const totalExpected = formattedTasks.reduce((sum, t) => sum + t.completionStats.daysExpected, 0);

    const previousTasks: any[] = [];
    const todayStr = today.toISOString().split('T')[0];

    const allPlanStartDates = await prisma.facialLandmarks.findMany({
      where: {
        userId,
        planStartDate: { not: null }
      },
      select: { planStartDate: true },
      orderBy: { planStartDate: 'asc' }
    });

    let earliestDate = planStartMidnight;

    if (allPlanStartDates.length > 0 && allPlanStartDates[0].planStartDate) {
      const earliestPlanStart = new Date(allPlanStartDates[0].planStartDate.toISOString().split('T')[0] + 'T00:00:00.000Z');
      if (earliestPlanStart < earliestDate) {
        earliestDate = earliestPlanStart;
      }
    }

    if (allCompletions.length > 0) {
      const earliestCompletion = allCompletions[allCompletions.length - 1]; // Last in desc order = earliest
      const earliestCompletionDate = new Date(earliestCompletion.completedAt.toISOString().split('T')[0] + 'T00:00:00.000Z');
      if (earliestCompletionDate < earliestDate) {
        earliestDate = earliestCompletionDate;
      }
    }

    const totalDaysSinceEarliest = Math.floor((todayMidnight.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));

    for (let d = 0; d < totalDaysSinceEarliest; d++) {
      const date = new Date(earliestDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const dayWeek = Math.min(Math.floor(d / 7) + 1, 4);

      let weeksTasks = tasks.filter(t => t.week === dayWeek);

      if (weeksTasks.length === 0) {
        for (let fallbackWeek = dayWeek - 1; fallbackWeek >= 1; fallbackWeek--) {
          weeksTasks = tasks.filter(t => t.week === fallbackWeek);
          if (weeksTasks.length > 0) break;
        }
      }

      for (const task of weeksTasks) {
        const isCompleted = allCompletions.some(c =>
          c.taskId === task.id &&
          c.completedAt.toISOString().split('T')[0] === dateStr
        );

        const isToday = dateStr === todayStr;

        previousTasks.push({
          taskId: task.id,
          taskTitle: task.title,
          description: task.description,
          timeOfDay: task.timeOfDay,
          date: dateStr,
          isCompleted,
          isActive: task.isActive, // Include this so frontend knows if task is from current plan
          status: isCompleted ? 'completed' : (isToday ? 'pending' : 'missed'),
          week: dayWeek,
          priority: task.priority,
          category: task.category
        });
      }
    }

    // Calculate summary from previousTasks for accuracy (excluding today's pending tasks)
    const pastTasks = previousTasks.filter(t => t.date < todayStr);
    const summaryTotalCompleted = pastTasks.filter(t => t.isCompleted).length;
    const summaryTotalMissed = pastTasks.filter(t => !t.isCompleted).length;
    const summaryTotalExpected = pastTasks.length;

    return {
      tasks: formattedTasks,
      previousTasks,
      summary: {
        totalCompleted: summaryTotalCompleted,
        totalMissed: summaryTotalMissed,
        totalExpected: summaryTotalExpected,
        completionRate: summaryTotalExpected > 0 ? Math.round((summaryTotalCompleted / summaryTotalExpected) * 100) : 0
      }
    };
  }

  static async completeTask(userId: string, taskId: string, completedAt?: string): Promise<boolean> {
    const completionDate = completedAt ? new Date(completedAt) : new Date();
    const dateStr = completionDate.toISOString().split('T')[0];
    const normalizedDate = new Date(dateStr);

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId }
    });

    if (!task) {
      throw new Error('Task not found');
    }

    const existing = await prisma.taskCompletion.findUnique({
      where: {
        taskId_userId_completedAt: {
          taskId,
          userId,
          completedAt: normalizedDate
        }
      }
    });

    if (existing) {
      return false; // already completed
    }

    await prisma.taskCompletion.create({
      data: {
        taskId,
        userId,
        completedAt: normalizedDate
      }
    });

    if ((task.adaptations as any)?.skipCount > 0) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          adaptations: {
            ...(task.adaptations as any),
            skipCount: 0
          }
        }
      });
    }

    return true;
  }

  static async uncompleteTask(userId: string, taskId: string, date?: string): Promise<boolean> {
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    const normalizedDate = new Date(dateStr);

    const deleted = await prisma.taskCompletion.deleteMany({
      where: {
        taskId,
        userId,
        completedAt: normalizedDate
      }
    });

    return deleted.count > 0;
  }

  static async getTaskProgress(userId: string): Promise<any> {
    const activePlan = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        planStartDate: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!activePlan || !activePlan.planStartDate || !activePlan.planEndDate) {
      throw new Error('No plan found');
    }

    const today = new Date();
    const planStart = activePlan.planStartDate;
    const planEnd = activePlan.planEndDate;

    const daysSinceStart = Math.floor((today.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);
    const currentDay = Math.min(daysSinceStart + 1, 28);

    const allTasks = await prisma.task.findMany({
      where: { userId, isActive: true }
    });

    const allCompletions = await prisma.taskCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' }
    });

    const weeklyScores = [];
    for (let week = 1; week <= 4; week++) {
      const weekTasks = allTasks.filter(t => t.week === week);
      const weekStart = new Date(planStart);
      weekStart.setDate(weekStart.getDate() + (week - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekCompletions = allCompletions.filter(c =>
        c.completedAt >= weekStart && c.completedAt <= weekEnd
      );

      const uniqueWeekCompletions = new Set(
        weekCompletions.map(c => `${c.taskId}-${c.completedAt.toISOString().split('T')[0]}`)
      );

      const criticalTasks = weekTasks.filter(t => t.priority === 'critical');
      const criticalCompletions = weekCompletions.filter(c => {
        const task = weekTasks.find(t => t.id === c.taskId);
        return task?.priority === 'critical';
      });

      const uniqueCriticalCompletions = new Set(
        criticalCompletions.map(c => `${c.taskId}-${c.completedAt.toISOString().split('T')[0]}`)
      );

      const weekDaysPassed = Math.min(7, Math.max(0,
        Math.floor((today.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
      ));

      const totalTasksPossible = weekTasks.length * Math.min(weekDaysPassed, 7);
      const score = totalTasksPossible > 0 ? (uniqueWeekCompletions.size / totalTasksPossible) * 100 : 0;

      weeklyScores.push({
        week,
        score: Math.round(score),
        completedTasks: uniqueWeekCompletions.size,
        totalTasks: totalTasksPossible,
        criticalTasksCompleted: uniqueCriticalCompletions.size,
        criticalTasksTotal: criticalTasks.length * Math.min(weekDaysPassed, 7)
      });
    }

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayWeek = Math.min(Math.floor((date.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1, 4);
      const dayTasks = allTasks.filter(t => t.week === dayWeek);
      const dayCompletions = allCompletions.filter(c =>
        c.completedAt.toISOString().split('T')[0] === dateStr
      );

      const uniqueDayCompletions = new Set(dayCompletions.map(c => c.taskId));

      const dayScore = dayTasks.length > 0 ? (uniqueDayCompletions.size / dayTasks.length) * 100 : 0;

      last7Days.push({
        date: dateStr,
        score: Math.round(dayScore),
        tasksCompleted: uniqueDayCompletions.size,
        tasksTotal: dayTasks.length
      });
    }

    let dailyStreak = 0;
    let longestStreak = 0;
    let currentStreak = 0;

    for (let i = last7Days.length - 1; i >= 0; i--) {
      if (last7Days[i].score >= 80) { // 80% completion threshold
        currentStreak++;
        if (i === last7Days.length - 1) dailyStreak = currentStreak;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 0;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    const uniqueCompletions = new Set(
      allCompletions.map(c => `${c.taskId}-${c.completedAt.toISOString().split('T')[0]}`)
    );
    const totalTasksCompleted = uniqueCompletions.size;

    const totalTasksPossible = allTasks.length * Math.min(currentDay, 28);
    const overallScore = totalTasksPossible > 0 ? (totalTasksCompleted / totalTasksPossible) * 100 : 0;

    return {
      userId,
      currentWeek,
      currentDay,
      overallScore: Math.round(overallScore),
      weeklyScores,
      dailyStreak,
      longestStreak,
      totalTasksCompleted,
      totalTasksPossible,
      planStartDate: planStart.toISOString(),
      planEndDate: planEnd.toISOString(),
      recentActivity: last7Days
    };
  }

  static async adaptTasksForUser(userId: string): Promise<TaskAdaptationResult[]> {
    const adaptations: TaskAdaptationResult[] = [];

    const tasks = await prisma.task.findMany({
      where: { userId, isActive: true }
    });

    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    for (const task of tasks) {
      const recentCompletions = await prisma.taskCompletion.count({
        where: {
          taskId: task.id,
          completedAt: { gte: threeDaysAgo }
        }
      });

      if (recentCompletions === 0) {
        let adaptationType: any = 'made_optional';
        let reason = 'Task consistently skipped, making optional';

        if (task.timeOfDay === 'evening') {
          adaptationType = 'time_adjusted';
          reason = 'Switching to morning routine for better adherence';

          await prisma.task.update({
            where: { id: task.id },
            data: {
              timeOfDay: 'morning',
              adaptations: {
                ...(task.adaptations as any),
                timeAdjusted: true
              }
            }
          });
        } else {
          await prisma.task.update({
            where: { id: task.id },
            data: {
              priority: 'optional',
              adaptations: {
                ...(task.adaptations as any),
                skipCount: (task.adaptations as any)?.skipCount + 1
              }
            }
          });
        }

        adaptations.push({
          taskId: task.id,
          adaptationType,
          reason,
          newTimeOfDay: adaptationType === 'time_adjusted' ? 'morning' : undefined
        });
      }
    }

    return adaptations;
  }

  static async getTaskHistory(userId: string): Promise<any> {
    const history = await prisma.taskCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      include: {
        task: true
      }
    });

    return history;
  }

  static async ensureTasksForPlanType(userId: string, planType: 'WEEKLY' | 'MONTHLY'): Promise<void> {
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { userId },
      select: { subscriptionExpiresAt: true }
    });

    const latestAnalysis = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        weeklyPlan: { not: Prisma.DbNull }
      },
      orderBy: { createdAt: 'desc' }
    });

    let subscriptionStartDate: Date | null = null;
    if (user?.subscriptionExpiresAt) {
      subscriptionStartDate = new Date(user.subscriptionExpiresAt);
      if (planType === 'WEEKLY') {
        subscriptionStartDate.setDate(subscriptionStartDate.getDate() - 7);
      } else {
        subscriptionStartDate.setDate(subscriptionStartDate.getDate() - 28);
      }
    }

    const wasExpired = user?.subscriptionExpiresAt && user.subscriptionExpiresAt < now;
    const planEndExpired = latestAnalysis?.planEndDate && latestAnalysis.planEndDate < now;

    const tasksAreStale = subscriptionStartDate && latestAnalysis?.planStartDate &&
      latestAnalysis.planStartDate < subscriptionStartDate;

    const needsReset = wasExpired || !latestAnalysis?.planStartDate || planEndExpired || tasksAreStale;

    if (needsReset && latestAnalysis) {
      console.log(`Plan was expired for user ${userId}, resetting tasks and plan dates`);

      // Store old values in case we need to rollback
      const oldPlanStartDate = latestAnalysis.planStartDate;
      const oldPlanEndDate = latestAnalysis.planEndDate;

      const planEndDate = new Date(now);
      if (planType === 'WEEKLY') {
        planEndDate.setDate(planEndDate.getDate() + 7);
      } else {
        planEndDate.setDate(planEndDate.getDate() + 28);
      }

      await prisma.facialLandmarks.update({
        where: { id: latestAnalysis.id },
        data: {
          planStartDate: now,
          planEndDate: planEndDate
        }
      });

      await prisma.task.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false }
      });

      try {
        await this.generateTasksFromPlan(userId);
        console.log(`Generated fresh tasks for user ${userId} after plan renewal`);
      } catch (error) {
        console.error(`Could not generate tasks for user ${userId}:`, error);

        console.log(`Rolling back: re-activating old tasks for user ${userId}`);
        await prisma.task.updateMany({
          where: { userId, isActive: false },
          data: { isActive: true }
        });

        await prisma.facialLandmarks.update({
          where: { id: latestAnalysis.id },
          data: {
            planStartDate: oldPlanStartDate,
            planEndDate: oldPlanEndDate
          }
        });
      }
    } else {
      const existingTasksCount = await prisma.task.count({
        where: { userId, isActive: true }
      });

      if (existingTasksCount === 0) {
        try {
          await this.generateTasksFromPlan(userId);
        } catch (error) {
          console.log(`Could not generate tasks for user ${userId} (likely no plan yet):`, error);
        }
      }
    }

    console.log(`Ensured tasks for user ${userId} with plan ${planType}`);
  }
}

export const generateTasksForUser = TasksService.generateTasksForUser;
export const getTodaysTasks = TasksService.getTodaysTasks;
export const completeTask = TasksService.completeTask;
export const uncompleteTask = TasksService.uncompleteTask;
export const getTaskProgress = TasksService.getTaskProgress;
export const adaptTasksForUser = TasksService.adaptTasksForUser;
