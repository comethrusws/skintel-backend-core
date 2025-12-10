import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { paymentVerifySchema, cancelReasonSchema } from '../lib/validation';
import { asyncHandler } from '../utils/asyncHandler';
import { PaymentService } from '../services/payment';
import { prisma } from '../lib/prisma';
import { sendSlackNotification } from '../services/slack';

const router = Router();


/**
 * @swagger
 * /v1/payment/verify-ios:
 *   post:
 *     summary: Verify iOS In-App Purchase using JWS from StoreKit 2
 *     description: Verifies the purchase by decoding the JWS (jwsRepresentation) from StoreKit 2 and updates the user's plan if valid.
 *     tags: [Subscription]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jws_transaction:
 *                 type: string
 *                 description: The JWS (jwsRepresentation) from StoreKit 2 transaction
 *             required:
 *               - jws_transaction
 *     responses:
 *       200:
 *         description: Payment verified and plan updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 plan_type:
 *                   type: string
 *                   enum: [WEEKLY, MONTHLY]
 *                 expires_date:
 *                   type: string
 *                 environment:
 *                   type: string
 *                   enum: [Sandbox, Production]
 *       400:
 *         description: Invalid request or verification failed
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/verify-ios', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { jws_transaction } = req.body;

    if (!jws_transaction) {
        res.status(400).json({
            error: 'Invalid request data',
            details: 'jws_transaction is required'
        });
        return;
    }

    const userId = req.userId!;

    // Verify the JWS transaction
    const verificationResult = PaymentService.verifyJWSTransaction(jws_transaction);

    if (!verificationResult.isValid) {
        res.status(400).json({
            error: 'Transaction verification failed',
            details: verificationResult.error
        });
        return;
    }

    let planType: 'WEEKLY' | 'MONTHLY';

    const verifiedProductId = verificationResult.productId || '';

    if (verifiedProductId.toLowerCase().includes('weekly')) {
        planType = 'WEEKLY';
    } else if (verifiedProductId.toLowerCase().includes('monthly')) {
        planType = 'MONTHLY';
    } else {
        res.status(400).json({
            error: 'Unknown product ID for plan mapping',
            details: `Product ID: ${verifiedProductId}`
        });
        return;
    }

    const updatedUser = await PaymentService.updateUserPlan(
        userId,
        planType,
        verificationResult.originalTransactionId,
        verificationResult.expiresDate,
        true // isActive
    );

    res.json({
        success: true,
        plan_type: updatedUser.planType,
        expires_date: verificationResult.expiresDate,
        environment: verificationResult.environment
    });
}));



/**
 * @swagger
 * /v1/payment/verify-transaction:
 *   post:
 *     summary: Verify iOS In-App Purchase using Transaction ID
 *     description: Verifies the purchase with Apple using the Transaction ID and updates the user's plan if valid.
 *     tags: [Subscription]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transaction_id:
 *                 type: string
 *                 description: The transaction ID from the client
 *               product_id:
 *                 type: string
 *                 description: The product ID purchased (e.g., 'com.skintel.weekly', 'com.skintel.monthly')
 *             required:
 *               - transaction_id
 *               - product_id
 *     responses:
 *       200:
 *         description: Payment verified and plan updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 plan_type:
 *                   type: string
 *                   enum: [WEEKLY, MONTHLY]
 *                 expires_date:
 *                   type: string
 *       400:
 *         description: Invalid request or verification failed
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/verify-transaction', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { transaction_id, product_id } = req.body;

    if (!transaction_id || !product_id) {
        res.status(400).json({
            error: 'Invalid request data',
            details: 'transaction_id and product_id are required'
        });
        return;
    }

    const userId = req.userId!;

    const verificationResult = await PaymentService.verifyTransactionId(transaction_id);

    if (!verificationResult.isValid) {
        res.status(400).json({
            error: 'Transaction verification failed',
            details: verificationResult.error
        });
        return;
    }

    let planType: 'WEEKLY' | 'MONTHLY';

    // Use the product_id from the verification result if available, otherwise fallback to request
    const verifiedProductId = verificationResult.productId || product_id;

    if (verifiedProductId.toLowerCase().includes('weekly')) {
        planType = 'WEEKLY';
    } else if (verifiedProductId.toLowerCase().includes('monthly')) {
        planType = 'MONTHLY';
    } else {
        res.status(400).json({ error: 'Unknown product ID for plan mapping' });
        return;
    }

    // Update user plan
    const updatedUser = await PaymentService.updateUserPlan(
        userId,
        planType,
        verificationResult.originalTransactionId,
        verificationResult.expiresDate,
        true // isActive
    );

    res.json({
        success: true,
        plan_type: updatedUser.planType,
        expires_date: verificationResult.expiresDate,
        environment: verificationResult.environment
    });
}));

/**
 * @swagger
 * /v1/payment/cancel-reason:
 *   post:
 *     summary: Submit cancellation reason
 *     description: Submit a reason for cancelling the subscription. Sends a notification to Slack.
 *     tags: [Subscription]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               otherDetails:
 *                 type: string
 *             required:
 *               - reason
 *     responses:
 *       200:
 *         description: Reason submitted successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 */
router.post('/cancel-reason', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validationResult = cancelReasonSchema.safeParse(req.body);

    if (!validationResult.success) {
        res.status(400).json({
            error: 'Invalid request data',
            details: validationResult.error.errors
        });
        return;
    }

    const { reason, otherDetails } = validationResult.data;
    const userId = req.userId!;

    await sendSlackNotification({
        text: `⚠️ Subscription Cancelled\nUser ID: ${userId}\nReason: ${reason}\nDetails: ${otherDetails || 'N/A'}`
    });

    res.json({ success: true });
}));

/**
 * @swagger
 * /v1/payment/plans:
 *   get:
 *     summary: Get available payment plans
 *     description: Retrieve a list of available subscription plans (Product IDs).
 *     tags: [Subscription]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [WEEKLY, MONTHLY]
 *       401:
 *         description: Authentication required
 */
router.get('/plans', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
    const plans = [
        { id: 'weekly_subscription', name: 'Weekly Plan', type: 'WEEKLY' },
        { id: 'monthly_subscription', name: 'Monthly Plan', type: 'MONTHLY' }
    ];
    res.json({ plans });
});

/**
 * @swagger
 * /v1/payment/status:
 *   get:
 *     summary: Get current subscription status
 *     description: Fetches the latest subscription status directly from Apple.
 *     tags: [Subscription]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isActive:
 *                   type: boolean
 *                 planType:
 *                   type: string
 *                   enum: [WEEKLY, MONTHLY]
 *                 expiresDate:
 *                   type: string
 *       401:
 *         description: Authentication required
 */
router.get('/status', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
        where: { userId },
        select: {
            isActive: true,
            planType: true,
            subscriptionExpiresAt: true
        }
    });

    if (!user) {
        return res.json({
            isActive: false,
            message: 'User not found'
        });
    }

    res.json({
        isActive: user.isActive,
        planType: user.planType,
        expiresDate: user.subscriptionExpiresAt ? user.subscriptionExpiresAt.toISOString() : null
    });
}));

export { router as paymentRouter };
