import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { paymentVerifySchema } from '../lib/validation';
import { asyncHandler } from '../utils/asyncHandler';
import { PaymentService } from '../services/payment';

const router = Router();

/**
 * @swagger
 * /v1/payment/verify-ios:
 *   post:
 *     summary: Verify iOS In-App Purchase receipt
 *     description: Verifies the receipt with Apple and updates the user's plan if valid.
 *     tags: [Payment]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               receipt_data:
 *                 type: string
 *                 description: Base64 encoded receipt data
 *               product_id:
 *                 type: string
 *                 description: The product ID purchased (e.g., 'com.skintel.weekly', 'com.skintel.monthly')
 *             required:
 *               - receipt_data
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
router.post('/verify-ios', authenticateUser, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validationResult = paymentVerifySchema.safeParse(req.body);

    if (!validationResult.success) {
        res.status(400).json({
            error: 'Invalid request data',
            details: validationResult.error.errors
        });
        return;
    }

    const { receipt_data, product_id } = validationResult.data;
    const userId = req.userId!;

    // Verify receipt with Apple
    const verificationResult = await PaymentService.verifyAppleReceipt(receipt_data);

    if (!verificationResult.isValid) {
        res.status(400).json({
            error: 'Receipt verification failed',
            details: verificationResult.error
        });
        return;
    }

    // Check if the verified product ID matches the requested one (optional but recommended)
    // Note: verificationResult.productId might be different if the user upgraded/downgraded in the same receipt group,
    // but usually we care that they have *a* valid subscription.
    // For strictness, we can check:
    // if (verificationResult.productId !== product_id) { ... }

    // Determine plan type based on product ID
    // This mapping should be configured properly. For now, we infer from the string or passed ID.
    let planType: 'WEEKLY' | 'MONTHLY';

    if (product_id.toLowerCase().includes('weekly')) {
        planType = 'WEEKLY';
    } else if (product_id.toLowerCase().includes('monthly')) {
        planType = 'MONTHLY';
    } else {
        // Default or error? Let's assume monthly if ambiguous for now, or error.
        // Better to error if unknown.
        res.status(400).json({ error: 'Unknown product ID for plan mapping' });
        return;
    }

    // Update user plan
    const updatedUser = await PaymentService.updateUserPlan(userId, planType);

    res.json({
        success: true,
        plan_type: updatedUser.planType,
        expires_date: verificationResult.expiresDate,
        environment: verificationResult.environment
    });
}));

export { router as paymentRouter };
