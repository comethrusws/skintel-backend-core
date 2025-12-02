import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { TaskGenerationRequest, TaskAdaptationResult } from '../types';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildTaskGenerationPrompt(): string {
  return `You are a skincare routine assistant AI.
You will receive a 4-week skincare improvement plan and need to generate specific daily tasks.

Your task:
1. Convert each week's preview into 3-5 actionable daily tasks
2. Assign appropriate timing (morning/evening/anytime)
3. Categorize tasks (cleansing, treatment, moisturizing, protection, lifestyle)
4. Set priority (critical, important, optional)
5. Consider product recommendations

Example input:
Week 1: "Start gentle cleansing routine with salicylic acid"

Example output:
{
  "week_1_tasks": [
    {
      "title": "Gentle Morning Cleanse",
      "description": "Wash face with gentle cleanser using lukewarm water",
      "timeOfDay": "morning",
      "category": "cleansing",
      "priority": "critical",
      "recommendedProducts": ["gentle cleanser", "face wash"]
    },
    {
      "title": "Salicylic Acid Treatment",
      "description": "Apply salicylic acid treatment to clean skin, start 3x per week",
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

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Generate daily tasks for this skincare plan:\n\n${planText}\n\n${userProductsText}\n\nReturn valid JSON only.`
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

    // Get all completions for this user
    const allCompletions = await prisma.taskCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' }
    });

    // Get active plan to determine date range
    const activePlan = await prisma.facialLandmarks.findFirst({
      where: {
        userId,
        planStartDate: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    });

    const today = new Date();
    const planStartDate = activePlan?.planStartDate || today;

    // Calculate which days have passed for each week
    const daysSinceStart = Math.floor((today.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentDay = Math.min(daysSinceStart + 1, 28);
    const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);

    // Filter tasks to only include current and past weeks
    const relevantTasks = tasks.filter(task => task.week <= currentWeek);

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

      // Get completion dates (excluding today)
      const todayStr = today.toISOString().split('T')[0];
      const completionDates = taskCompletions
        .map(c => c.completedAt.toISOString().split('T')[0])
        .filter(date => date !== todayStr);

      // Get unique completion dates to count actual days completed
      const uniqueCompletionDates = [...new Set(completionDates)];

      // Calculate which days this task was expected (only up to yesterday, excluding today)
      const weekStartDay = (task.week - 1) * 7 + 1;
      const weekEndDay = Math.min(task.week * 7, currentDay - 1); // Exclude today
      const daysExpected = Math.max(0, weekEndDay - weekStartDay + 1);

      // Count completed days (unique dates only) and missed days
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

    // Calculate overall stats
    const totalCompleted = formattedTasks.reduce((sum, t) => sum + t.completionStats.completedDays, 0);
    const totalMissed = formattedTasks.reduce((sum, t) => sum + t.completionStats.missedDays, 0);
    const totalExpected = formattedTasks.reduce((sum, t) => sum + t.completionStats.daysExpected, 0);

    return {
      tasks: formattedTasks,
      summary: {
        totalCompleted,
        totalMissed,
        totalExpected,
        completionRate: totalExpected > 0 ? Math.round((totalCompleted / totalExpected) * 100) : 0
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

    // Reset skip count on successful completion
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

      // Count unique task-day completions for the week
      const uniqueWeekCompletions = new Set(
        weekCompletions.map(c => `${c.taskId}-${c.completedAt.toISOString().split('T')[0]}`)
      );

      const criticalTasks = weekTasks.filter(t => t.priority === 'critical');
      const criticalCompletions = weekCompletions.filter(c => {
        const task = weekTasks.find(t => t.id === c.taskId);
        return task?.priority === 'critical';
      });

      // Count unique critical task-day completions
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

      // Count unique task completions for this day
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

      // if task was skipped 3+ times in last 3 days, we adapt it
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
    // This method ensures that the user has the correct tasks generated for their plan type.
    // Since we generate a 4-week plan by default during onboarding, we mostly need to ensure
    // that the tasks are active and potentially handle any future logic where we might
    // gate access to future weeks for weekly subscribers (though currently we allow full access).

    // Check if tasks exist
    const existingTasksCount = await prisma.task.count({
      where: { userId, isActive: true }
    });

    if (existingTasksCount === 0) {
      // If no tasks, try to generate from existing plan
      try {
        await this.generateTasksFromPlan(userId);
      } catch (error) {
        console.log(`Could not generate tasks for user ${userId} (likely no plan yet):`, error);
        // This is fine, they might be paying before analysis is complete
      }
    }

    // Future logic: If planType is WEEKLY, we could deactivate weeks 2-4 if we wanted to be strict.
    // For now, we follow the "Master Plan" strategy where paying unlocks the full roadmap.
    console.log(`Ensured tasks for user ${userId} with plan ${planType}`);
  }
}

export const generateTasksForUser = TasksService.generateTasksForUser;
export const getTodaysTasks = TasksService.getTodaysTasks;
export const completeTask = TasksService.completeTask;
export const uncompleteTask = TasksService.uncompleteTask;
export const getTaskProgress = TasksService.getTaskProgress;
export const adaptTasksForUser = TasksService.adaptTasksForUser;
