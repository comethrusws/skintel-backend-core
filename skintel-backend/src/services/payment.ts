import axios from 'axios';
import { prisma } from '../lib/prisma';
import { PlanType } from '@prisma/client';
import { TasksService } from './tasks';
import jwt from 'jsonwebtoken';

const APPLE_VERIFY_RECEIPT_URL_SANDBOX = process.env.APPLE_VERIFY_RECEIPT_URL_SANDBOX || 'https://sandbox.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_RECEIPT_URL_PRODUCTION = process.env.APPLE_VERIFY_RECEIPT_URL_PRODUCTION || 'https://buy.itunes.apple.com/verifyReceipt';

const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

// App Store Server API Configuration
const ISSUER_ID = process.env.APPLE_ISSUER_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID;
const APPLE_API_URL_PRODUCTION = process.env.APPLE_API_URL_PRODUCTION;
const APPLE_API_URL_SANDBOX = process.env.APPLE_API_URL_SANDBOX;

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

    static async updateUserPlan(userId: string, planType: 'WEEKLY' | 'MONTHLY', originalTransactionId?: string, expiresDate?: string) {
        const user = await prisma.user.update({
            where: { userId },
            data: {
                planType: planType === 'WEEKLY' ? PlanType.WEEKLY : PlanType.MONTHLY,
                ...(originalTransactionId ? { originalTransactionId } : {}),
                ...(expiresDate ? { subscriptionExpiresAt: new Date(expiresDate) } : {})
            },
            select: {
                userId: true,
                planType: true,
                email: true,
                subscriptionExpiresAt: true
            }
        });

        await TasksService.ensureTasksForPlanType(userId, planType);

        return user;
    }

    /**
     * Generates a JWT for App Store Server API authentication.
     */
    private static generateAppStoreJWT(): string {
        if (!APPLE_SHARED_SECRET) {
            throw new Error('APPLE_SHARED_SECRET (Private Key) is missing');
        }

        const payload = {
            iss: ISSUER_ID,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiration
            aud: 'appstoreconnect-v1',
            bid: BUNDLE_ID
        };

        const headers = {
            alg: 'ES256',
            kid: KEY_ID,
            typ: 'JWT'
        };

        return jwt.sign(payload, APPLE_SHARED_SECRET, { header: headers });
    }

    /**
     * Fetches subscription status from App Store Server API.
     */
    static async getSubscriptionStatus(originalTransactionId: string): Promise<{ isActive: boolean; expiresDate?: string; planType?: 'WEEKLY' | 'MONTHLY' }> {
        try {
            const token = this.generateAppStoreJWT();

            let url = `${APPLE_API_URL_PRODUCTION}/${originalTransactionId}`;
            let response;

            try {
                response = await axios.get(url, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } catch (error: any) {
                if (error.response?.status === 404) {
                    console.log('Transaction not found in Production, trying Sandbox...');
                    url = `${APPLE_API_URL_SANDBOX}/${originalTransactionId}`;
                    response = await axios.get(url, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                } else {
                    throw error;
                }
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                return { isActive: false };
            }

            const lastTransaction = data.data[0].lastTransactions.find((t: any) => t.originalTransactionId === originalTransactionId);

            if (!lastTransaction) {
                return { isActive: false };
            }

           const status = lastTransaction.status;
           const signedTransactionInfo = lastTransaction.signedTransactionInfo;

           let activeSubscription = null;

           for (const group of data.data) {
                for (const transaction of group.lastTransactions) {
                    if (transaction.status === 1 || transaction.status === 4) { // Active or Grace Period
                        activeSubscription = transaction;
                        break;
                    }
                }
            }

            if (activeSubscription) {
                const decoded: any = jwt.decode(activeSubscription.signedTransactionInfo);

                let planType: 'WEEKLY' | 'MONTHLY' | undefined;
                if (decoded && decoded.productId) {
                    if (decoded.productId.toLowerCase().includes('weekly')) planType = 'WEEKLY';
                    if (decoded.productId.toLowerCase().includes('monthly')) planType = 'MONTHLY';
                }

                return {
                    isActive: true,
                    expiresDate: decoded ? new Date(decoded.expiresDate).toISOString() : undefined,
                    planType
                };
            }

            return { isActive: false };

        } catch (error) {
            console.error('Get Subscription Status Error:', error);
            return { isActive: false };
        }
    }
}
