import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Skintel Backend API',
      version: '1.0.0',
      description: 'API for Skintel onboarding and user authentication',
    },
    tags: [
      { name: 'Authentication', description: 'User signup/login and tokens' },
      { name: 'Sessions', description: 'Anonymous session management' },
      { name: 'Onboarding', description: 'Onboarding flow and answers' },
      { name: 'Landmarks', description: 'Facial landmarks retrieval' },
      { name: 'Products', description: 'Skincare product identification and management' },
      { name: 'Analysis', description: 'Skin analysis for face images' },
    ],
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        SessionToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Session-Token',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        BasicAuth: {
          type: 'http',
          scheme: 'basic',
          description: 'Username and password authentication',
        },
      },
      schemas: {
        DeviceInfo: {
          type: 'object',
          properties: {
            os: { type: 'string', example: 'ios' },
            os_version: { type: 'string', example: '17.4' },
            app_version: { type: 'string', example: '1.0.0' },
          },
          required: ['os', 'os_version', 'app_version'],
        },
        OnboardingAnswer: {
          type: 'object',
          properties: {
            answer_id: { type: 'string' },
            screen_id: { type: 'string' },
            question_id: { type: 'string' },
            type: {
              type: 'string',
              enum: ['single', 'multi', 'slider', 'image', 'boolean', 'derived'],
            },
            value: {
              oneOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array', items: { type: 'string' } },
                { type: 'object', properties: { image_id: { type: 'string' } } },
                { type: 'object', properties: { image_url: { type: 'string', format: 'uri', example: 'https://example.com/face.jpg' } } },
              ],
            },
            status: { type: 'string', enum: ['answered', 'skipped'] },
            saved_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const specs = swaggerJsdoc(options);
export { swaggerUi };
