import { Router, Request, Response } from 'express';
import { versionCheckRequestSchema } from '../lib/validation';

const router = Router();

interface iTunesResponse {
  resultCount: number;
  results: Array<{
    version: string;
    trackViewUrl: string;
    bundleId: string;
  }>;
}

/**
 * @swagger
 * /v1/version:
 *   post:
 *     summary: Check app version
 *     description: Compare user's app version with latest App Store version
 *     tags: [Version]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               current_version:
 *                 type: string
 *                 example: "1.2.3"
 *               platform:
 *                 type: string
 *                 enum: [ios]
 *                 example: "ios"
 *             required:
 *               - current_version
 *               - platform
 *     responses:
 *       200:
 *         description: Version check completed
 *       400:
 *         description: Invalid request data
 *       503:
 *         description: App Store unavailable
 */

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = versionCheckRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { current_version, platform } = validationResult.data;

    if (platform !== 'ios') {
      res.status(400).json({ error: 'Only iOS platform supported currently' });
      return;
    }

    const bundleId = process.env.IOS_BUNDLE_ID;
    if (!bundleId) {
      res.status(500).json({ error: 'App configuration missing' });
      return;
    }

    try {
      const itunesUrl = `https://itunes.apple.com/lookup?bundleId=${bundleId}`;
      const response = await fetch(itunesUrl);

      if (!response.ok) {
        throw new Error(`iTunes API error: ${response.status}`);
      }

      const data: iTunesResponse = await response.json();

      if (data.resultCount === 0) {
        res.status(404).json({ error: 'App not found in App Store' });
        return;
      }

      const appInfo = data.results[0];
      const latestVersion = appInfo.version;
      const updateAvailable = compareVersions(current_version, latestVersion) < 0;
      const updateRequired = isUpdateRequired(current_version, latestVersion);

      const responseData = {
        minimum_version: current_version,
        latest_version: latestVersion,
        force_update: updateRequired,
        update_url: appInfo.trackViewUrl,
      };

      res.json(responseData);
    } catch (error) {
      console.error('App Store API error:', error);
      res.status(503).json({ error: 'Unable to check App Store version' });
    }
  } catch (error) {
    console.error('Version check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function compareVersions(current: string, latest: string): number {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  const maxLength = Math.max(currentParts.length, latestParts.length);

  for (let i = 0; i < maxLength; i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }

  return 0;
}

function isUpdateRequired(current: string, latest: string): boolean {
  const minRequiredVersion = process.env.MIN_REQUIRED_VERSION;
  if (!minRequiredVersion) return false;

  return compareVersions(current, minRequiredVersion) < 0;
}

export { router as versionRouter };