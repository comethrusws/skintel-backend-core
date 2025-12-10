import axios from 'axios';
import { prisma } from '../lib/prisma';
import { PlanType } from '@prisma/client';
import { TasksService } from './tasks';
import jwt from 'jsonwebtoken';

const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;
const APPLE_PRIVATE_KEY_RAW = process.env.APPLE_PRIVATE_KEY;

// App Store Server API Configuration
const ISSUER_ID = process.env.APPLE_ISSUER_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID;

const APPLE_TRANSACTION_URL_PRODUCTION = 'https://api.storekit.itunes.apple.com/inApps/v2/transactions';
const APPLE_TRANSACTION_URL_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com/inApps/v2/transactions';

const APPLE_SUBSCRIPTION_URL_PRODUCTION = 'https://api.storekit.itunes.apple.com/inApps/v2/subscriptions';
const APPLE_SUBSCRIPTION_URL_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com/inApps/v2/subscriptions';

const ERROR_CODE_TRANSACTION_NOT_FOUND = 4040010;

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
     * Formats the private key properly for JWT signing.
     * Handles keys that are on a single line or have literal \n characters.
     */
    private static formatPrivateKey(key: string): string {
        if (!key) {
            throw new Error('Private key is empty');
        }

        let formattedKey = key.trim().replace(/^["']|["']$/g, '');

        if (formattedKey.includes('\\n')) {
            formattedKey = formattedKey.replace(/\\n/g, '\n');
        }

        if (!formattedKey.includes('-----BEGIN PRIVATE KEY-----')) {
            throw new Error('Invalid private key format: missing BEGIN header');
        }
        if (!formattedKey.includes('-----END PRIVATE KEY-----')) {
            throw new Error('Invalid private key format: missing END footer');
        }

        return formattedKey;
    }



    /**
     * Verifies an Apple In-App Purchase using the JWS (JSON Web Signature) from StoreKit 2.
     * The JWS is a signed JWT that contains all transaction information.
     * This method decodes the JWS and extracts the transaction details.
     */
    static verifyJWSTransaction(jwsTransaction: string): IAPVerificationResult {
        try {
            if (!jwsTransaction || typeof jwsTransaction !== 'string') {
                return {
                    isValid: false,
                    error: 'Invalid JWS transaction: must be a non-empty string'
                };
            }

            const decoded: any = jwt.decode(jwsTransaction);

            if (!decoded) {
                return {
                    isValid: false,
                    error: 'Failed to decode JWS transaction'
                };
            }

            if (!decoded.transactionId) {
                return {
                    isValid: false,
                    error: 'Missing transactionId in decoded JWS'
                };
            }

            const environment: 'Sandbox' | 'Production' =
                decoded.environment === 'Production' ? 'Production' : 'Sandbox';

            return {
                isValid: true,
                productId: decoded.productId,
                transactionId: decoded.transactionId,
                originalTransactionId: decoded.originalTransactionId,
                purchaseDate: decoded.purchaseDate ? new Date(decoded.purchaseDate).toISOString() : undefined,
                expiresDate: decoded.expiresDate ? new Date(decoded.expiresDate).toISOString() : undefined,
                environment: environment,
            };
        } catch (error: any) {
            console.error('JWS Transaction Verification Error:', error);
            return {
                isValid: false,
                error: error instanceof Error ? error.message : 'Unknown error during JWS verification'
            };
        }
    }

    /**
     * Verifies an Apple In-App Purchase using the Transaction ID via App Store Server API.
     * Uses Get Transaction History (v2) to find the latest transaction for the original transaction ID.
     */
    static async verifyTransactionId(transactionId: string): Promise<IAPVerificationResult> {
        try {
            const token = this.generateAppStoreJWT();

            const historyPath = `/inApps/v2/history/${transactionId}?sort=DESCENDING`;

            let url = `https://api.storekit-sandbox.itunes.apple.com${historyPath}`;
            let response;
            let environment: 'Sandbox' | 'Production' = 'Sandbox';

            console.log('Attempting to verify transaction history in Sandbox...');
            try {
                response = await axios.get(url, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log('Transaction history found in Sandbox');
            } catch (sandboxError: any) {
                if (sandboxError.response?.status === 404 || sandboxError.response?.status === 401) {
                    console.log('Transaction history not found in Sandbox, trying Production...');
                    url = `https://api.storekit.itunes.apple.com${historyPath}`;
                    environment = 'Production';

                    try {
                        response = await axios.get(url, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        console.log('Transaction history found in Production');
                    } catch (productionError: any) {
                        if (productionError.response?.status === 404 &&
                            productionError.response?.data?.errorCode === ERROR_CODE_TRANSACTION_NOT_FOUND) {
                            return {
                                isValid: false,
                                error: 'Transaction id not found in either sandbox or production environment',
                            };
                        }

                        console.error('Production API Error:', {
                            status: productionError.response?.status,
                            errorCode: productionError.response?.data?.errorCode,
                            errorMessage: productionError.response?.data?.errorMessage,
                            data: productionError.response?.data
                        });
                        throw productionError;
                    }
                } else {
                    console.error('Sandbox API Error:', {
                        status: sandboxError.response?.status,
                        errorCode: sandboxError.response?.data?.errorCode,
                        errorMessage: sandboxError.response?.data?.errorMessage,
                        data: sandboxError.response?.data
                    });
                    throw sandboxError;
                }
            }

            const data = response.data;
            if (!data || !data.signedTransactions || data.signedTransactions.length === 0) {
                return {
                    isValid: false,
                    error: 'No signedTransactions found in history response',
                };
            }

            const latestSignedTransaction = data.signedTransactions[0];
            const decoded: any = jwt.decode(latestSignedTransaction);

            if (!decoded) {
                return {
                    isValid: false,
                    error: 'Failed to decode signedTransactionInfo',
                };
            }

            return {
                isValid: true,
                productId: decoded.productId,
                transactionId: decoded.transactionId,
                originalTransactionId: decoded.originalTransactionId,
                purchaseDate: decoded.purchaseDate ? new Date(decoded.purchaseDate).toISOString() : undefined,
                expiresDate: decoded.expiresDate ? new Date(decoded.expiresDate).toISOString() : undefined,
                environment: environment,
            };

        } catch (error: any) {
            console.error('Apple Transaction Verification Error:', error);

            if (error.response?.status === 401) {
                return {
                    isValid: false,
                    error: 'Authentication failed. Please verify your Apple credentials (ISSUER_ID, KEY_ID, BUNDLE_ID, PRIVATE_KEY)',
                };
            }

            return {
                isValid: false,
                error: error instanceof Error ? error.message : 'Unknown error during verification',
            };
        }
    }



    static async updateUserPlan(userId: string, planType: 'WEEKLY' | 'MONTHLY', originalTransactionId?: string, expiresDate?: string, isActive: boolean = true) {
        const user = await prisma.user.update({
            where: { userId },
            data: {
                planType: planType === 'WEEKLY' ? PlanType.WEEKLY : PlanType.MONTHLY,
                isActive: isActive,
                ...(originalTransactionId ? { originalTransactionId } : {}),
                ...(expiresDate ? { subscriptionExpiresAt: new Date(expiresDate) } : {})
            },
            select: {
                userId: true,
                planType: true,
                email: true,
                subscriptionExpiresAt: true,
                isActive: true
            }
        });

        await TasksService.ensureTasksForPlanType(userId, planType);

        return user;
    }

    /**
     * Generates a JWT for App Store Server API authentication.
     * This JWT works for both production and sandbox environments.
     */
    private static generateAppStoreJWT(): string {
        if (!APPLE_PRIVATE_KEY_RAW) {
            throw new Error('APPLE_PRIVATE_KEY is missing');
        }
        if (!ISSUER_ID) {
            throw new Error('APPLE_ISSUER_ID is missing');
        }
        if (!KEY_ID) {
            throw new Error('APPLE_KEY_ID is missing');
        }
        if (!BUNDLE_ID) {
            throw new Error('APPLE_BUNDLE_ID is missing');
        }

        try {
            const formattedKey = this.formatPrivateKey(APPLE_PRIVATE_KEY_RAW);

            const keyLines = formattedKey.split('\n');
            const now = Math.floor(Date.now() / 1000);

            const payload = {
                iss: ISSUER_ID,
                iat: now,
                exp: now + 3600, // 1 hour expiration (max allowed is 60 minutes)
                aud: 'appstoreconnect-v1',
                bid: BUNDLE_ID
            };

            const header = {
                alg: 'ES256',
                kid: KEY_ID,
                typ: 'JWT'
            };

            const token = jwt.sign(payload, formattedKey, {
                algorithm: 'ES256',
                header: header
            });

            const decoded = jwt.decode(token, { complete: true });

            return token;
        } catch (error) {
            console.error('JWT Generation Error:', error);
            throw new Error(`Failed to generate JWT: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Fetches subscription status from App Store Server API.
     * Tries sandbox first, then production if not found.
     */
    static async getSubscriptionStatus(originalTransactionId: string): Promise<{ isActive: boolean; expiresDate?: string; planType?: 'WEEKLY' | 'MONTHLY' }> {
        try {
            const token = this.generateAppStoreJWT();

            let url = `${APPLE_SUBSCRIPTION_URL_SANDBOX}/${originalTransactionId}`;
            let response;

            try {
                response = await axios.get(url, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log('Subscription found in Sandbox');
            } catch (sandboxError: any) {
                if (sandboxError.response?.status === 404 || sandboxError.response?.status === 401) {
                    console.log('Subscription not found in Sandbox, trying Production...');
                    url = `${APPLE_SUBSCRIPTION_URL_PRODUCTION}/${originalTransactionId}`;

                    try {
                        response = await axios.get(url, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        console.log('Subscription found in Production');
                    } catch (productionError: any) {
                        if (productionError.response?.status === 404 &&
                            productionError.response?.data?.errorCode === ERROR_CODE_TRANSACTION_NOT_FOUND) {
                            console.log('Subscription not found in either sandbox or production environment');
                            return { isActive: false };
                        }

                        console.error('Production API Error:', {
                            status: productionError.response?.status,
                            errorCode: productionError.response?.data?.errorCode,
                            errorMessage: productionError.response?.data?.errorMessage
                        });
                        throw productionError;
                    }
                } else {
                    console.error('Sandbox API Error:', {
                        status: sandboxError.response?.status,
                        errorCode: sandboxError.response?.data?.errorCode,
                        errorMessage: sandboxError.response?.data?.errorMessage
                    });
                    throw sandboxError;
                }
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                return { isActive: false };
            }

            let activeSubscription = null;

            for (const group of data.data) {
                for (const transaction of group.lastTransactions) {
                    if (transaction.status === 1 || transaction.status === 4) {
                        activeSubscription = transaction;
                        break;
                    }
                }
                if (activeSubscription) break;
            }

            if (activeSubscription) {
                const decoded: any = jwt.decode(activeSubscription.signedTransactionInfo);

                let planType: 'WEEKLY' | 'MONTHLY' | undefined;
                if (decoded && decoded.productId) {
                    const productId = decoded.productId.toLowerCase();
                    if (productId.includes('weekly')) planType = 'WEEKLY';
                    else if (productId.includes('monthly')) planType = 'MONTHLY';
                }

                return {
                    isActive: true,
                    expiresDate: decoded && decoded.expiresDate ? new Date(decoded.expiresDate).toISOString() : undefined,
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