FROM node:24-alpine

# Install openssl for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

RUN npm i

COPY . .

RUN npm run db:generate

RUN npm run build

ARG NODE_ENV=${NODE_ENV:-development}

ARG PORT=${PORT:-3000}

ARG JWT_SECRET=${JWT_SECRET:-your-super-secret-jwt-key-change-this-in-production}

ARG DATABASE_URL=${DATABASE_URL:-postgresql://username:password@localhost:5432/skintel_db}

ARG OPENAI_API_KEY=${OPENAI_API_KEY:-your-openai-api-key}

ENV OPENAI_API_KEY=${OPENAI_API_KEY}

ENV PORT=${PORT}

ENV JWT_SECRET=${JWT_SECRET}

ENV DATABASE_URL=${DATABASE_URL}

ENV NODE_ENV=${NODE_ENV}

EXPOSE ${PORT}

CMD ["npm", "start"]
