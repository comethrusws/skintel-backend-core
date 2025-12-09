import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { TasksService } from '../services/tasks';

const router = Router();

const taskCompletionSchema = z.object({
  completedAt: z.string().datetime().optional()
});

/**
 * @swagger
 * /v1/tasks/all:
 *   get:
 *     summary: Get all missed and completed tasks
 *     description: Retrieve all tasks from previous days only (excludes today and future) with completion history
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All past tasks with completion statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   description: Array of past tasks (excludes today and future)
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       week:
 *                         type: integer
 *                         description: Week number (1-4)
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       timeOfDay:
 *                         type: string
 *                         enum: [morning, evening, anytime]
 *                       category:
 *                         type: string
 *                         enum: [cleansing, treatment, moisturizing, protection, lifestyle]
 *                       priority:
 *                         type: string
 *                         enum: [critical, important, optional]
 *                       isActive:
 *                         type: boolean
 *                       recommendedProducts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       userProducts:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             name:
 *                               type: string
 *                             category:
 *                               type: string
 *                       completionStats:
 *                         type: object
 *                         properties:
 *                           completedDays:
 *                             type: integer
 *                             description: Number of days this task was completed
 *                           missedDays:
 *                             type: integer
 *                             description: Number of days this task was missed
 *                           daysExpected:
 *                             type: integer
 *                             description: Total days this task should have been done
 *                           completionRate:
 *                             type: integer
 *                             description: Percentage (0-100) of completion
 *                           completionDates:
 *                             type: array
 *                             items:
 *                               type: string
 *                               format: date
 *                             description: Array of dates when task was completed (excludes today)
                previousTasks:
                  type: array
                  description: Detailed history of all past task instances
                  items:
                    type: object
                    properties:
                      taskId:
                        type: string
                      taskTitle:
                        type: string
                      date:
                        type: string
                        format: date
                      isCompleted:
                        type: boolean
                      status:
                        type: string
                        enum: [completed, missed]
                      week:
                        type: integer
                      priority:
                        type: string
                      category:
                        type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalCompleted:
 *                       type: integer
 *                       description: Total completed task instances across all tasks
 *                     totalMissed:
 *                       type: integer
 *                       description: Total missed task instances across all tasks
 *                     totalExpected:
 *                       type: integer
 *                       description: Total expected task instances
 *                     completionRate:
 *                       type: integer
 *                       description: Overall completion percentage (0-100)
 *       401:
 *         description: Authentication required
 */
router.get('/all', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const allTasks = await TasksService.getAllTasks(userId);
  res.json(allTasks);
}));

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
router.get('/today', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const todaysTasks = await TasksService.getTodaysTasksWithFallback(userId);
  res.json(todaysTasks);
}));

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
router.get('/week/:week', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const week = parseInt(req.params.week);
  if (isNaN(week) || week < 1 || week > 4) {
    res.status(400).json({ error: 'Week must be between 1 and 4' });
    return;
  }

  const userId = req.userId!;
  const response = await TasksService.getWeekTasks(userId, week);
  res.json(response);
}));

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
router.post('/:taskId/complete', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { taskId } = req.params;
  const userId = req.userId!;

  const validationResult = taskCompletionSchema.safeParse(req.body);
  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const { completedAt } = validationResult.data;

  const success = await TasksService.completeTask(userId, taskId, completedAt);

  if (!success) {
    res.status(400).json({ error: 'Task already completed for this date' });
    return;
  }

  res.json({
    success: true,
    message: 'Task completed successfully',
    taskId,
    completedAt: completedAt || new Date().toISOString()
  });
}));

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
router.delete('/:taskId/complete', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { taskId } = req.params;
  const userId = req.userId!;
  const { date } = req.query;

  const success = await TasksService.uncompleteTask(userId, taskId, date as string);

  if (!success) {
    res.status(404).json({ error: 'Task completion not found for this date' });
    return;
  }

  res.json({
    success: true,
    message: 'Task completion removed successfully',
    taskId
  });
}));

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
router.get('/progress', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const progress = await TasksService.getTaskProgress(userId);
  res.json(progress);
}));

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
router.post('/generate', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  await TasksService.generateTasksFromPlan(userId);

  res.json({
    success: true,
    message: 'Tasks generated successfully'
  });
}));

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
router.post('/adapt', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const adaptations = await TasksService.adaptTasksForUser(userId);

  res.json({
    success: true,
    adaptations,
    message: `${adaptations.length} tasks adapted based on completion patterns`
  });
}));

/**
 * @swagger
 * /v1/tasks/history:
 *   get:
 *     summary: Get task completion history
 *     description: Retrieve the user's task completion history
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: History retrieved successfully
 *       401:
 *         description: Authentication required
 */
router.get('/history', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const history = await TasksService.getTaskHistory(userId);
  res.json(history);
}));

export { router as tasksRouter };
