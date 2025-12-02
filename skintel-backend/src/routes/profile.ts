import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { profileUpdateRequestSchema, profileQuestionsAnswerRequestSchema, profileLocationUpdateSchema, addProfileQuestionSchema } from '../lib/validation';
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
 *     description: Retrieve user's facial analysis data with formatted labels for issues.
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Analysis retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                   example: user_2f9fb498-08c6-43e4-a56f-8e91c67007d6
 *                 analysis:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       answer_id:
 *                         type: string
 *                         example: progress_1764685586997_7007d6
 *                       question_id:
 *                         type: string
 *                         example: q_face_photo_front
 *                       screen_id:
 *                         type: string
 *                         example: progress_analysis
 *                       analysis:
 *                         type: object
 *                         description: Analysis data WITHOUT score and care_plan_4_weeks (those are at top level)
 *                         properties:
 *                           issues:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 type:
 *                                   type: string
 *                                   example: dark_circles
 *                                 type_label:
 *                                   type: string
 *                                   example: Dark Circles
 *                                 region:
 *                                   type: string
 *                                   example: left_under_eye
 *                                 region_label:
 *                                   type: string
 *                                   example: Left Under Eye
 *                                 severity:
 *                                   type: string
 *                                   example: mild
 *                                 severity_label:
 *                                   type: string
 *                                   example: Mild
 *                                 visible_in:
 *                                   type: array
 *                                   items:
 *                                     type: string
 *                                   example: [front, left]
 *                                 dlib_68_facial_landmarks:
 *                                   type: array
 *                                   items:
 *                                     type: object
 *                                     properties:
 *                                       x:
 *                                         type: number
 *                                       y:
 *                                         type: number
 *                           remaining_issues:
 *                             type: array
 *                             description: For PROGRESS analysis type - remaining issues with labels
 *                             items:
 *                               type: object
 *                               properties:
 *                                 type:
 *                                   type: string
 *                                 type_label:
 *                                   type: string
 *                                 region:
 *                                   type: string
 *                                 region_label:
 *                                   type: string
 *                                 severity:
 *                                   type: string
 *                                 severity_label:
 *                                   type: string
 *                                 visible_in:
 *                                   type: array
 *                                   items:
 *                                     type: string
 *                                 dlib_68_facial_landmarks:
 *                                   type: array
 *                                   items:
 *                                     type: object
 *                                     properties:
 *                                       x:
 *                                         type: number
 *                                       y:
 *                                         type: number
 *                           issues_improved:
 *                             type: array
 *                             description: For PROGRESS analysis type - issues that have improved with labels
 *                             items:
 *                               type: object
 *                               properties:
 *                                 issue_type:
 *                                   type: string
 *                                   example: dark_circles
 *                                 issue_type_label:
 *                                   type: string
 *                                   example: Dark Circles
 *                                 initial_severity:
 *                                   type: string
 *                                   example: moderate
 *                                 initial_severity_label:
 *                                   type: string
 *                                   example: Moderate
 *                                 current_severity:
 *                                   type: string
 *                                   example: mild
 *                                 current_severity_label:
 *                                   type: string
 *                                   example: Mild
 *                                 improvement_percentage:
 *                                   type: number
 *                                   example: 40
 *                           overall_assessment:
 *                             type: string
 *                             example: Generally healthy facial skin with mild acne
 *                           images_analyzed:
 *                             type: array
 *                             items:
 *                               type: string
 *                             example: [front, left, right]
 *                           important_notes:
 *                             type: string
 *                           estimated_improvement_score:
 *                             type: number
 *                             example: 88
 *                           estimated_weekly_scores:
 *                             type: array
 *                             items:
 *                               type: number
 *                             example: [80, 82, 85, 88]
 *                           updated_weekly_scores:
 *                             type: array
 *                             description: For PROGRESS analysis type
 *                             items:
 *                               type: number
 *                           overall_progress_score:
 *                             type: number
 *                             description: For PROGRESS analysis type
 *                           score_change:
 *                             type: number
 *                             description: For PROGRESS analysis type
 *                           plan_adherence:
 *                             type: object
 *                             description: For PROGRESS analysis type
 *                           visual_improvements:
 *                             type: array
 *                             description: For PROGRESS analysis type
 *                             items:
 *                               type: string
 *                           areas_needing_attention:
 *                             type: array
 *                             description: For PROGRESS analysis type
 *                             items:
 *                               type: string
 *                           updated_recommendations:
 *                             type: array
 *                             description: For PROGRESS analysis type
 *                             items:
 *                               type: string
 *                           next_week_focus:
 *                             type: string
 *                             description: For PROGRESS analysis type
 *                       score:
 *                         type: number
 *                         example: 78
 *                         description: Current skin health score (0-100)
 *                       weekly_plan:
 *                         type: array
 *                         description: 4-week skincare improvement plan
 *                         items:
 *                           type: object
 *                           properties:
 *                             week:
 *                               type: number
 *                               example: 1
 *                             preview:
 *                               type: string
 *                               example: Start gentle twice-daily cleansing routine
 *                             improvement_expected:
 *                               type: string
 *                               example: 10%
 *                             weekly_improvement_score:
 *                               type: number
 *                               example: 80
 *                       analysis_type:
 *                         type: string
 *                         enum: [INITIAL, PROGRESS]
 *                         example: PROGRESS
 *                       plan_start_date:
 *                         type: string
 *                         format: date-time
 *                       plan_end_date:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                         enum: [PROCESSING, COMPLETED, FAILED]
 *                         example: COMPLETED
 *                       processed_at:
 *                         type: string
 *                         format: date-time
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       error:
 *                         type: string
 *                         nullable: true
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
 *                       question_text:
 *                         type: string
 *                         description: The human-readable question text
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

/**
 * @swagger
 * /v1/profile/onboarding-answers:
 *   get:
 *     summary: Get all onboarding answers
 *     description: Retrieve all onboarding questions and their answers with label mapping for better readability
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding answers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 answers:
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
 *                         enum: [single, multi, slider, image, boolean, derived]
 *                       status:
 *                         type: string
 *                         enum: [answered, skipped]
 *                       value:
 *                         oneOf:
 *                           - type: object
 *                             properties:
 *                               value:
 *                                 type: string
 *                               label:
 *                                 type: string
 *                           - type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 value:
 *                                   type: string
 *                                 label:
 *                                   type: string
 *                           - type: number
 *                           - type: boolean
 *                           - type: object
 *                       options:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             value:
 *                               type: string
 *                             label:
 *                               type: string
 *                       saved_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 */
router.get('/onboarding-answers', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const response = await ProfileService.getOnboardingAnswers(req.userId!);
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

/**
 * @swagger
 * /v1/profile/questions/add:
 *   post:
 *     summary: Add a custom profile question
 *     description: Add a new custom question to the user's profile questions list
 *     tags: [Profile]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question_id
 *               - question_text
 *               - type
 *             properties:
 *               question_id:
 *                 type: string
 *                 description: Unique identifier for the question (must start with 'q_profile_')
 *                 example: q_profile_custom_meditation
 *               question_text:
 *                 type: string
 *                 maxLength: 200
 *                 description: The question text to display
 *                 example: Do you practice meditation regularly?
 *               type:
 *                 type: string
 *                 enum: [single, slider]
 *                 description: Type of question
 *               options:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Options for single-choice questions (required if type is 'single')
 *                 example: ['never', 'sometimes', 'daily']
 *               min_value:
 *                 type: number
 *                 description: Minimum value for slider questions (required if type is 'slider')
 *                 example: 0
 *               max_value:
 *                 type: number
 *                 description: Maximum value for slider questions (required if type is 'slider')
 *                 example: 60
 *               default_value:
 *                 type: number
 *                 description: Default value for slider questions (required if type is 'slider')
 *                 example: 15
 *     responses:
 *       200:
 *         description: Custom question added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 question_id:
 *                   type: string
 *                 question_text:
 *                   type: string
 *                 type:
 *                   type: string
 *                   enum: [single, slider]
 *                 options:
 *                   type: array
 *                   items:
 *                     type: string
 *                 min_value:
 *                   type: number
 *                 max_value:
 *                   type: number
 *                 default_value:
 *                   type: number
 *                 status:
 *                   type: string
 *                   enum: [new]
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 *       409:
 *         description: Question with this ID already exists
 */
router.post('/questions/add', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validationResult = addProfileQuestionSchema.safeParse(req.body);
  if (!validationResult.success) {
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult.error.errors
    });
    return;
  }

  const response = await ProfileService.addCustomQuestion(req.userId!, validationResult.data);
  res.json(response);
}));

export { router as profileRouter };