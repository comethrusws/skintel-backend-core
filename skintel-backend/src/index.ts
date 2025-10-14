import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { sessionsRouter } from './routes/sessions';
import { onboardingRouter } from './routes/onboarding';
import { authRouter } from './routes/auth';
import { landmarksRouter } from './routes/landmarks';
import { productsRouter } from './routes/products';
import { prisma } from './lib/prisma';
import { vanalyseRouter } from './routes/vanalyse';
import { specs, swaggerUi } from './lib/swagger';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/v1/sessions', sessionsRouter);
app.use('/v1/onboarding', onboardingRouter);
app.use('/v1/auth', authRouter);
app.use('/v1/landmarks', landmarksRouter);
app.use('/v1/products', productsRouter);
app.use('/v1/vanalyse', vanalyseRouter);

// Swagger documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));

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

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
