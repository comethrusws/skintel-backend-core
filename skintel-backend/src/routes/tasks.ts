import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { 
  generateTasksForUser, 
  getTodaysTasks, 
  completeTask, 
  uncompleteTask, 
  getTaskProgress,
  adaptTasksForUser
} from '../services/tasks';

const router = Router();

const taskCompletionSchema = z.object({
  completedAt: z.string().datetime().optional()
});

/**
 * @swagger
 * /v1/tasks/today:
 *   get:
 *     summary: Get today's tasks
 *     description: Retrieve all tasks for the current user for today with completion status
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Today's tasks retrieved successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No active plan found
 */
router.get('/today', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const todaysTasks = await getTodaysTasks(userId);
    res.json(todaysTasks);
  } catch (error) {
    console.error('Get today tasks error:', error);
    if (error instanceof Error && error.message === 'No active plan found') {
      return res.status(404).json({ error: 'No active skincare plan found' });
    }
    res.status(500).json({ error: 'Failed to retrieve tasks' });
  }
});

/**
 * @swagger
 * /v1/tasks/week/{week}:
 *   get:
 *     summary: Get tasks for specific week
 *     description: Retrieve all tasks for a specific week (1-4) of the skincare plan
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: week
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 4
 *     responses:
 *       200:
 *         description: Week tasks retrieved successfully
 *       400:
 *         description: Invalid week number
 *       401:
 *         description: Authentication required
 */
router.get('/week/:week', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const week = parseInt(req.params.week);
    if (isNaN(week) || week < 1 || week > 4) {
      return res.status(400).json({ error: 'Week must be between 1 and 4' });
    }

    const userId = req.userId!;
    
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

    res.json({
      week,
      tasks: formattedTasks,
      totalTasks: formattedTasks.length
    });
  } catch (error) {
    console.error('Get week tasks error:', error);
    res.status(500).json({ error: 'Failed to retrieve week tasks' });
  }
});

/**
 * @swagger
 * /v1/tasks/{taskId}/complete:
 *   post:
 *     summary: Mark task as complete
 *     description: Mark a specific task as completed for today (or specified date)
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               completedAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional completion date (defaults to now)
 *     responses:
 *       200:
 *         description: Task marked as complete
 *       400:
 *         description: Task already completed or invalid data
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Task not found
 */
router.post('/:taskId/complete', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const userId = req.userId!;

    const validationResult = taskCompletionSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: validationResult.error.errors 
      });
    }

    const { completedAt } = validationResult.data;
    
    const success = await completeTask(userId, taskId, completedAt);
    
    if (!success) {
      return res.status(400).json({ error: 'Task already completed for this date' });
    }

    res.json({ 
      success: true, 
      message: 'Task completed successfully',
      taskId,
      completedAt: completedAt || new Date().toISOString()
    });
  } catch (error) {
    console.error('Complete task error:', error);
    if (error instanceof Error && error.message === 'Task not found') {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

/**
 * @swagger
 * /v1/tasks/{taskId}/complete:
 *   delete:
 *     summary: Unmark task completion
 *     description: Remove task completion for today (or specified date)
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task completion removed
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Task completion not found
 */
router.delete('/:taskId/complete', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const userId = req.userId!;
    const { date } = req.query;
    
    const success = await uncompleteTask(userId, taskId, date as string);
    
    if (!success) {
      return res.status(404).json({ error: 'Task completion not found for this date' });
    }

    res.json({ 
      success: true, 
      message: 'Task completion removed successfully',
      taskId
    });
  } catch (error) {
    console.error('Uncomplete task error:', error);
    res.status(500).json({ error: 'Failed to uncomplete task' });
  }
});

/**
 * @swagger
 * /v1/tasks/progress:
 *   get:
 *     summary: Get task completion progress
 *     description: Retrieve comprehensive progress statistics for the user's skincare plan
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Progress data retrieved successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No plan found
 */
router.get('/progress', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const progress = await getTaskProgress(userId);
    res.json(progress);
  } catch (error) {
    console.error('Get task progress error:', error);
    if (error instanceof Error && error.message === 'No plan found') {
      return res.status(404).json({ error: 'No skincare plan found' });
    }
    res.status(500).json({ error: 'Failed to retrieve progress' });
  }
});

/**
 * @swagger
 * /v1/tasks/generate:
 *   post:
 *     summary: Generate tasks from weekly plan
 *     description: Generate daily tasks based on the user's weekly skincare plan (called automatically after analysis)
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tasks generated successfully
 *       400:
 *         description: No weekly plan found or tasks already exist
 *       401:
 *         description: Authentication required
 */
router.post('/generate', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // Get user's latest weekly plan
    const latestAnalysis = await prisma.facialLandmarks.findFirst({
      where: { 
        userId,
        status: 'COMPLETED',
        weeklyPlan: { not: Prisma.DbNull }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestAnalysis || !latestAnalysis.weeklyPlan) {
      return res.status(400).json({ error: 'No weekly plan found. Complete analysis first.' });
    }

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

    await generateTasksForUser({
      userId,
      weeklyPlan,
      userProducts: formattedProducts
    });

    res.json({ 
      success: true, 
      message: 'Tasks generated successfully' 
    });
  } catch (error) {
    console.error('Generate tasks error:', error);
    res.status(500).json({ error: 'Failed to generate tasks' });
  }
});

/**
 * @swagger
 * /v1/tasks/adapt:
 *   post:
 *     summary: Adapt tasks based on completion patterns
 *     description: Analyze user's task completion patterns and adapt tasks for better adherence
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tasks adapted successfully
 *       401:
 *         description: Authentication required
 */
router.post('/adapt', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const adaptations = await adaptTasksForUser(userId);
    
    res.json({
      success: true,
      adaptations,
      message: `${adaptations.length} tasks adapted based on completion patterns`
    });
  } catch (error) {
    console.error('Adapt tasks error:', error);
    res.status(500).json({ error: 'Failed to adapt tasks' });
  }
});

export { router as tasksRouter };
