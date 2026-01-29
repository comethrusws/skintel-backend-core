import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { sendSlackNotification } from './slack';
import { MetaConversionService } from './meta';

// Apple Notification Types (V2)
// https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
type AppleNotificationType =
    | 'CONSUMPTION_REQUEST'
    | 'DID_CHANGE_RENEWAL_PREF'
    | 'DID_CHANGE_RENEWAL_STATUS'
    | 'DID_FAIL_TO_RENEW'
    | 'DID_RENEW'
    | 'EXPIRED'
    | 'GRACE_PERIOD_EXPIRED'
    | 'OFFER_REDEEMED'
    | 'PRICE_INCREASE'
    | 'REFUND'
    | 'REFUND_DECLINED'
    | 'REFUND_REVERSED'
    | 'RENEWAL_EXTENDED'
    | 'RENEWAL_EXTENSION'
    | 'REVOKE'
    | 'SUBSCRIBED'
    | 'TEST';

type AppleSubtype =
    | 'INITIAL_BUY'
    | 'RESUBSCRIBE'
    | 'DOWNGRADE'
    | 'UPGRADE'
    | 'AUTO_RENEW_ENABLED'
    | 'AUTO_RENEW_DISABLED'
    | 'VOLUNTARY'
    | 'BILLING_RETRY'
    | 'PRICE_INCREASE'
    | 'GRACE_PERIOD'
    | 'BILLING_RECOVERY'
    | 'PENDING'
    | 'ACCEPTED'
    | 'SUMMARY'
    | 'FAILURE';

interface NotificationPayload {
    notificationType: AppleNotificationType;
    subtype?: AppleSubtype;
    notificationUUID: string;
    data: {
        appAppleId: number;
        bundleId: string;
        bundleVersion: string;
        environment: 'Sandbox' | 'Production';
        signedTransactionInfo: string;
        signedRenewalInfo?: string;
    };
    version: string;
    signedDate: number;
}

interface TransactionInfo {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    purchaseDate: number;
    expiresDate?: number;
    environment: 'Sandbox' | 'Production';
    type: string;
}

interface RenewalInfo {
    autoRenewProductId: string;
    autoRenewStatus: number; // 1 = will renew, 0 = won't renew
    expirationIntent?: number;
    gracePeriodExpiresDate?: number;
    isInBillingRetryPeriod?: boolean;
    offerIdentifier?: string;
    offerType?: number;
    originalTransactionId: string;
    priceIncreaseStatus?: number;
    productId: string;
    signedDate: number;
}

interface ProcessResult {
    success: boolean;
    notificationType?: string;
    userId?: string;
    error?: string;
}

export class AppleNotificationService {
    /**
     * Process an Apple S2S notification
     */
    static async processNotification(signedPayload: string): Promise<ProcessResult> {
        try {
            // Decode the outer JWS (we're not verifying Apple's signature for now,
            // but in production you should verify using Apple's root certificate)
            const payload = jwt.decode(signedPayload) as NotificationPayload;

            if (!payload) {
                return { success: false, error: 'Failed to decode notification payload' };
            }

            const { notificationType, subtype, data } = payload;

            console.log(`Processing Apple notification: ${notificationType}${subtype ? ` (${subtype})` : ''}`);

            // Decode transaction info
            const transactionInfo = jwt.decode(data.signedTransactionInfo) as TransactionInfo;
            if (!transactionInfo) {
                return { success: false, error: 'Failed to decode transaction info' };
            }

            // Decode renewal info if present
            let renewalInfo: RenewalInfo | null = null;
            if (data.signedRenewalInfo) {
                renewalInfo = jwt.decode(data.signedRenewalInfo) as RenewalInfo;
            }

            // Find user by originalTransactionId
            const user = await prisma.user.findFirst({
                where: { originalTransactionId: transactionInfo.originalTransactionId }
            });

            if (!user) {
                console.warn(`No user found for originalTransactionId: ${transactionInfo.originalTransactionId}`);
                // Still return success - this might be a valid notification for a transaction we haven't seen
                return { success: true, notificationType, error: 'User not found' };
            }

            // Process based on notification type
            await this.handleNotification(
                user.userId,
                notificationType,
                subtype,
                transactionInfo,
                renewalInfo,
                data.environment
            );

            return { success: true, notificationType, userId: user.userId };

        } catch (error) {
            console.error('Apple notification processing error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Handle specific notification types
     */
    private static async handleNotification(
        userId: string,
        notificationType: AppleNotificationType,
        subtype: AppleSubtype | undefined,
        transactionInfo: TransactionInfo,
        renewalInfo: RenewalInfo | null,
        environment: 'Sandbox' | 'Production'
    ): Promise<void> {
        const now = new Date();

        switch (notificationType) {
            case 'SUBSCRIBED':
                // New subscription or resubscribe
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: true,
                        autoRenewEnabled: true,
                        cancellationDate: null,
                        subscriptionExpiresAt: transactionInfo.expiresDate
                            ? new Date(transactionInfo.expiresDate)
                            : null,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `✅ New Subscription\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nSubtype: ${subtype || 'N/A'}\nEnvironment: ${environment}`
                });
                break;

            case 'DID_RENEW':
                // Subscription renewed successfully
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: true,
                        autoRenewEnabled: true,
                        subscriptionExpiresAt: transactionInfo.expiresDate
                            ? new Date(transactionInfo.expiresDate)
                            : null,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `🔄 Subscription Renewed\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nNew Expiry: ${transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate).toISOString() : 'N/A'}`
                });
                break;

            case 'DID_CHANGE_RENEWAL_STATUS':
                // User enabled or disabled auto-renew
                const autoRenewEnabled = renewalInfo?.autoRenewStatus === 1;

                await prisma.user.update({
                    where: { userId },
                    data: {
                        autoRenewEnabled,
                        cancellationDate: !autoRenewEnabled ? now : null,
                        lastAppleNotification: now
                    }
                });

                if (!autoRenewEnabled) {
                    // User turned off auto-renew (pending cancellation)
                    await sendSlackNotification({
                        text: `⚠️ Auto-Renew Disabled (Pending Cancellation)\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nWill expire: ${transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate).toISOString() : 'N/A'}`
                    });

                    // Track cancellation intent in Meta
                    MetaConversionService.sendEvent(
                        'subscription_cancelled',
                        { externalId: userId },
                        { status: 'pending', productId: transactionInfo.productId },
                        'webhook/cancel_intent'
                    ).catch(() => { });
                } else {
                    await sendSlackNotification({
                        text: `✅ Auto-Renew Re-enabled\nUser: ${userId}\nProduct: ${transactionInfo.productId}`
                    });
                }
                break;

            case 'EXPIRED':
                // Subscription expired
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: false,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `❌ Subscription Expired\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nReason: ${subtype || 'Unknown'}`
                });
                break;

            case 'DID_FAIL_TO_RENEW':
                // Billing issue - subscription failed to renew
                if (subtype === 'GRACE_PERIOD') {
                    // User is in grace period - still has access
                    await prisma.user.update({
                        where: { userId },
                        data: {
                            lastAppleNotification: now
                            // Keep isActive true during grace period
                        }
                    });

                    await sendSlackNotification({
                        text: `⚠️ Renewal Failed - Grace Period\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nGrace Period Expires: ${renewalInfo?.gracePeriodExpiresDate ? new Date(renewalInfo.gracePeriodExpiresDate).toISOString() : 'N/A'}`
                    });
                } else {
                    await sendSlackNotification({
                        text: `⚠️ Renewal Failed\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nIn Billing Retry: ${renewalInfo?.isInBillingRetryPeriod || false}`
                    });
                }
                break;

            case 'GRACE_PERIOD_EXPIRED':
                // Grace period ended without successful billing
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: false,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `❌ Grace Period Expired\nUser: ${userId}\nProduct: ${transactionInfo.productId}`
                });
                break;

            case 'REFUND':
                // User got a refund
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: false,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `💰 Refund Issued\nUser: ${userId}\nProduct: ${transactionInfo.productId}\nTransaction: ${transactionInfo.transactionId}`
                });
                break;

            case 'REVOKE':
                // Family sharing revoked or other revocation
                await prisma.user.update({
                    where: { userId },
                    data: {
                        isActive: false,
                        lastAppleNotification: now
                    }
                });

                await sendSlackNotification({
                    text: `🚫 Subscription Revoked\nUser: ${userId}\nProduct: ${transactionInfo.productId}`
                });
                break;

            case 'TEST':
                // Test notification from Apple
                console.log('Received Apple test notification');
                await sendSlackNotification({
                    text: `🧪 Apple Test Notification Received\nEnvironment: ${environment}`
                });
                break;

            default:
                console.log(`Unhandled notification type: ${notificationType}`);
                await sendSlackNotification({
                    text: `ℹ️ Unhandled Apple Notification\nType: ${notificationType}\nSubtype: ${subtype || 'N/A'}\nUser: ${userId}`
                });
        }
    }
}
