import dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    Sentry.httpIntegration(),
    Sentry.expressIntegration(),
  ],
  tracesSampleRate: 1.0,
});

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { clerkMiddleware } from '@clerk/express';
import { sessionsRouter } from './routes/sessions';
import { onboardingRouter } from './routes/onboarding';
import { authRouter } from './routes/auth';
import { landmarksRouter } from './routes/landmarks';
import { productsRouter } from './routes/products';
import { uploadRouter } from './routes/upload';
import { profileRouter } from './routes/profile';
import { versionRouter } from './routes/version';
import { prisma } from './lib/prisma';
import { vanalyseRouter } from './routes/vanalyse';
import { tasksRouter } from './routes/tasks';
import { specs, swaggerUi } from './lib/swagger';
import { locationRouter } from './routes/location';
import { initCronJobs } from './cron';
import { skinTipRouter } from './routes/skinTip.routes';
import { waterIntakeRouter } from './routes/waterIntake.routes';
import { skinFeelRouter } from './routes/skinFeel';
import { SkinTipService } from './services/skinTip';
import { QuestionOfTheDayService } from './services/questionOfTheDay';
import { reportRouter } from './routes/report';
import { notificationsRouter } from './routes/notifications';
import { clerk } from './lib/clerk';
import { paymentRouter } from './routes/payment';
import { errorHandler, notFoundHandler } from './middleware/error';

const app: Express = express();

const port = process.env.PORT || 3000;

const maxRequestSize = process.env.MAX_REQUEST_SIZE || '50mb';
const morganFormat = process.env.MORGAN_FORMAT || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev');
console.log(`Server starting with MAX_REQUEST_SIZE: ${maxRequestSize}`);

app.use(helmet());
app.use(cors());
app.use(morgan(morganFormat));

app.use(express.json({
  limit: maxRequestSize,
  verify: (req: any, res: any, buf: Buffer) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: maxRequestSize
}));

app.use(clerkMiddleware({ clerkClient: clerk }));

app.use('/v1/sessions', sessionsRouter);
app.use('/v1/onboarding', onboardingRouter);
app.use('/v1/auth', authRouter);
app.use('/v1/landmarks', landmarksRouter);
app.use('/v1/products', productsRouter);
app.use('/v1/upload', uploadRouter);
app.use('/v1/profile', profileRouter);
app.use('/v1/version', versionRouter);
app.use('/v1/vanalyse', vanalyseRouter);
app.use('/v1/tasks', tasksRouter);
app.use('/v1/location', locationRouter);
app.use('/v1/skin-tip', skinTipRouter);
app.use('/v1/water-intake', waterIntakeRouter);
app.use('/v1/skin-feel', skinFeelRouter);
app.use('/v1/report', reportRouter);
app.use('/v1/notifications', notificationsRouter);
app.use('/v1/payment', paymentRouter);

// Swagger documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs, {
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
    validatorUrl: null,
  },
}));

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Skintel Backend API', version: '1.0.0' });
});

app.get('/health', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', error: 'Database connection failed' });
  }
});

Sentry.setupExpressErrorHandler(app);

app.use(notFoundHandler);
app.use(errorHandler);

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(port, async () => {
  console.log(`Server is listening on port ${port}`);
  initCronJobs();
  await SkinTipService.ensureTipsForWeek();
  await QuestionOfTheDayService.ensureQuestionsForWeek();
});
