import axios from 'axios';
import { prisma } from '../lib/prisma';
import { PlanType } from '@prisma/client';
import { TasksService } from './tasks';

const APPLE_VERIFY_RECEIPT_URL_SANDBOX = process.env.APPLE_VERIFY_RECEIPT_URL_SANDBOX || 'https://sandbox.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_RECEIPT_URL_PRODUCTION = process.env.APPLE_VERIFY_RECEIPT_URL_PRODUCTION || 'https://buy.itunes.apple.com/verifyReceipt';

const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

interface IAPVerificationResult {
    isValid: boolean;
    productId?: string;
    transactionId?: string;
    originalTransactionId?: string;
    purchaseDate?: string;
    expiresDate?: string;
    environment?: 'Sandbox' | 'Production';
    error?: string;
}

export class PaymentService {
    /**
     * Verifies an Apple In-App Purchase receipt.
     * Tries production first, then sandbox if production returns status 21007.
     */
    static async verifyAppleReceipt(receiptData: string): Promise<IAPVerificationResult> {
        if (!APPLE_SHARED_SECRET) {
            console.warn('APPLE_SHARED_SECRET is not set. Verification might fail for auto-renewable subscriptions.');
        }

        try {
            let response = await this.verifyReceiptWithApple(APPLE_VERIFY_RECEIPT_URL_PRODUCTION, receiptData);

            // Status 21007 means "This receipt is from the test environment, but it was sent to the production environment for verification."
            if (response.status === 21007) {
                console.log('Receipt is from Sandbox. Retrying with Sandbox URL...');
                response = await this.verifyReceiptWithApple(APPLE_VERIFY_RECEIPT_URL_SANDBOX, receiptData);
            }

            if (response.status !== 0) {
                return {
                    isValid: false,
                    error: `Apple verification failed with status: ${response.status}`,
                };
            }

            const latestReceiptInfo = response.latest_receipt_info || response.receipt?.in_app || [];

            if (!latestReceiptInfo || latestReceiptInfo.length === 0) {
                if (response.receipt) {
                    return {
                        isValid: true,
                        productId: response.receipt.product_id,
                        transactionId: response.receipt.transaction_id,
                        originalTransactionId: response.receipt.original_transaction_id,
                        purchaseDate: response.receipt.purchase_date,
                        expiresDate: response.receipt.expires_date,
                        environment: response.environment
                    }
                }

                return {
                    isValid: false,
                    error: 'No receipt info found in response',
                };
            }

            const latestTransaction = latestReceiptInfo.sort((a: any, b: any) => {
                return parseInt(b.purchase_date_ms) - parseInt(a.purchase_date_ms);
            })[0];

            return {
                isValid: true,
                productId: latestTransaction.product_id,
                transactionId: latestTransaction.transaction_id,
                originalTransactionId: latestTransaction.original_transaction_id,
                purchaseDate: latestTransaction.purchase_date,
                expiresDate: latestTransaction.expires_date,
                environment: response.environment,
            };

        } catch (error) {
            console.error('Apple Receipt Verification Error:', error);
            return {
                isValid: false,
                error: error instanceof Error ? error.message : 'Unknown error during verification',
            };
        }
    }

    private static async verifyReceiptWithApple(url: string, receiptData: string): Promise<any> {
        const payload: any = { 'receipt-data': receiptData };
        if (APPLE_SHARED_SECRET) {
            payload['password'] = APPLE_SHARED_SECRET;
        }

        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
        });

        return response.data;
    }

    static async updateUserPlan(userId: string, planType: 'WEEKLY' | 'MONTHLY') {
        const user = await prisma.user.update({
            where: { userId },
            data: {
                planType: planType === 'WEEKLY' ? PlanType.WEEKLY : PlanType.MONTHLY,
            },
            select: {
                userId: true,
                planType: true,
                email: true,
            }
        });

        await TasksService.ensureTasksForPlanType(userId, planType);

        return user;
    }
}
