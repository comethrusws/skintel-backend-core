import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { profileUpdateRequestSchema, profileQuestionsAnswerRequestSchema, profileLocationUpdateSchema } from '../lib/validation';
import { asyncHandler } from '../utils/asyncHandler';
import { ProfileService } from '../services/profile';

const router = Router();

/**
 * @swagger
 * /v1/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve complete user profile information including name, phone, profile image, and date of birth
 *     tags: [Profile]
 *     security:
 *       - BasicAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 name:
 *                   type: string
 *                   nullable: true
 *                 phone_number:
 *                   type: string
 *                   nullable: true
 *                 date_of_birth:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 profile_image:
 *                   type: string
 *                   format: uri
 *                   nullable: true
 *                   description: Front face photo from onboarding
 *                 email:
 *                   type: string
 *                   format: email
 *                   nullable: true
 *                 sso_provider:
 *                   type: string
 *                   nullable: true
 *                 gender:
 *                   type: string
 *                   nullable: true
 *                 skin_score:
 *                   type: number
 *                   nullable: true
 *                   description: Latest skin analysis score (0-100)
 *                 score_change:
 *                   type: number
 *                   description: Change in skin score from previous analysis
 *                 tasks_score:
 *                   type: number
 *                   nullable: true
 *                   description: Current skincare tasks completion score (0-100)
 *                 tasks_count:
 *                   type: object
 *                   properties:
 *                     completed:
 *                       type: number
 *                     total:
 *                       type: number
 *                 plan_details:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [MONTHLY, WEEKLY]
 *                 total_products_in_use:
 *                   type: number
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 * 
 *   put:
 *     summary: Update user profile
 *     description: Update user profile information (only name and phone number can be updated)
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: "John Doe"
 *               phone_number:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 20
 *                 example: "+1234567890"
 *             minProperties: 1
 *             description: At least one field must be provided
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 name:
 *                   type: string
 *                   nullable: true
 *                 phone_number:
 *                   type: string
 *                   nullable: true
 *                 date_of_birth:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 profile_image:
 *                   type: string
 *                   format: uri
 *                   nullable: true
 *                 email:
 *                   type: string
 *                   format: email
 *                   nullable: true
 *                 sso_provider:
 *                   type: string
 *                   nullable: true
 *                 skin_score:
 *                   type: number
 *                   nullable: true
 *                   description: Latest skin analysis score (0-100)
 *                 tasks_score:
 *                   type: number
 *                   nullable: true
 *                   description: Current skincare tasks completion score (0-100)
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                 updated:
 *                   type: boolean
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 * 
 *   delete:
 *     summary: Delete user profile
 *     description: Delete user account and all associated data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     responses:
 *       200:
 *         description: Profile deleted successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 * 
 * 
 * /v1/profile/analysis:
 *   get:
 *     summary: Get user facial analysis
 *     description: Retrieve user's facial analysis data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Analysis retrieved successfully
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/landmarks:
 *   get:
 *     summary: Get user facial landmarks
 *     description: Retrieve user's facial landmarks data
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Landmarks retrieved successfully
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/weekly:
 *   get:
 *     summary: Get user's weekly progress info
 *     description: Retrieve the most recent weekly progress for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Weekly plan retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 analysis_type:
 *                   type: string
 *                   enum: [INITIAL, PROGRESS]
 *                 skin_score:
 *                   type: number
 *                 tasks_score:
 *                   type: number
 *                 tasks_missing:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       category:
 *                         type: string
 *                       priority:
 *                         type: string
 *                 improvements:
 *                   type: array
 *                   items:
 *                     type: string
 *                 plan_start_date:
 *                   type: string
 *                   format: date-time
 *                 plan_end_date:
 *                   type: string
 *                   format: date-time
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No weekly plan found
 * 
 * /v1/profile/onboarding-status:
 *   get:
 *     summary: Get user onboarding status
 *     description: Check the current onboarding status and progress for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 onboarding_status:
 *                   type: string
 *                   enum: [not_started, in_progress, completed, skipped]
 *                 answers_count:
 *                   type: number
 *                   description: Total number of answered questions
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was started
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was last updated
 *                 completed_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When onboarding was completed (if status is completed)
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/annotated-image:
 *   get:
 *     summary: Get user annotated image
 *     description: Retrieve the latest annotated image URL for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Annotated image retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 annotated_image_url:
 *                   type: string
 *                   format: uri
 *                   description: Presigned URL for the annotated image
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No annotated image found
 * 
 * /v1/profile/questions:
 *   get:
 *     summary: Get profile questions with status
 *     description: Retrieve all profile questions for "Tell Us A Bit More About You" section with their current status (answered/skipped/new)
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile questions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 questions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       question_id:
 *                         type: string
 *                       question_text:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [single, slider]
 *                       status:
 *                         type: string
 *                         enum: [answered, skipped, new]
 *                       value:
 *                         oneOf:
 *                           - type: string
 *                           - type: number
 *                           - type: 'null'
 *                       options:
 *                         type: array
 *                         items:
 *                           type: string
 *                       min_value:
 *                         type: number
 *                       max_value:
 *                         type: number
 *                       default_value:
 *                         type: number
 *                       saved_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *       401:
 *         description: Authentication required
 * 
 * /v1/profile/questions/answer:
 *   post:
 *     summary: Save profile question answers
 *     description: Save or update answers to profile questions
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     question_id:
 *                       type: string
 *                     value:
 *                       oneOf:
 *                         - type: string
 *                         - type: number
 *                         - type: 'null'
 *                     status:
 *                       type: string
 *                       enum: [answered, skipped]
 *             required:
 *               - answers
 *     responses:
 *       200:
 *         description: Answers saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 saved:
 *                   type: boolean
 *                 answers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       question_id:
 *                         type: string
 *                       saved:
 *                         type: boolean
 *                       saved_at:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 */

router.get('/', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getProfile(req.userId!);
  res.json(response);
}));

router.get('/analysis', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getAnalysis(req.userId!);
  res.json(response);
}));

router.get('/landmarks', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getLandmarks(req.userId!);
  res.json(response);
}));

router.get('/annotated-image', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getAnnotatedImage(req.userId!);
  res.json(response);
}));

router.put('/', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = profileUpdateRequestSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await ProfileService.updateProfile(req.userId!, validationResult.data);
  res.json(response);
}));

/**
 * @swagger
 * /v1/profile/location:
 *   put:
 *     summary: Update the user's location for UV alerts
 *     description: Stores the latest latitude and longitude provided by the client once the user enables UV alerts.
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *               longitude:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *     responses:
 *       200:
 *         description: Location stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 latitude:
 *                   type: number
 *                 longitude:
 *                   type: number
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid coordinates
 *       401:
 *         description: Authentication required
 */
router.put('/location', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = profileLocationUpdateSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid coordinates',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await ProfileService.updateLocation(req.userId!, validationResult.data);
  res.json(response);
}));

router.delete('/', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.deleteProfile(req.userId!);
  res.json(response);
}));

router.get('/onboarding-status', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getOnboardingStatus(req.userId!);
  res.json(response);
}));

router.get('/weekly', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getWeeklyPlan(req.userId!);
  res.json(response);
}));

router.get('/questions', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getQuestions(req.userId!);
  res.json(response);
}));

router.post('/questions/answer', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = profileQuestionsAnswerRequestSchema.safeParse(req.body);
  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await ProfileService.saveAnswers(req.userId!, validationResult.data.answers);
  res.json(response);
}));

export { router as profileRouter };