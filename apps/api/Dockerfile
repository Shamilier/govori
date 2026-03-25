FROM node:20-alpine AS base
WORKDIR /workspace

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

COPY . .
RUN npm run prisma:generate -w apps/api
RUN npm run build -w apps/api

EXPOSE 4000
CMD ["sh", "-c", "npm run prisma:migrate -w apps/api && npm run seed -w apps/api && npm run start -w apps/api"]
