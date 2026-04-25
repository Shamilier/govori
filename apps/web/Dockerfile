FROM node:20-alpine AS base
WORKDIR /workspace

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

COPY . .
RUN npm run build -w apps/web \
  && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
