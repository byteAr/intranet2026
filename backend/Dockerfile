FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM base AS builder
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
# poppler-utils: pdftotext, para buscar los términos de "Mis alertas" en los PDF adjuntos
RUN apk add --no-cache libreoffice font-noto font-noto-cjk poppler-utils
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY assets ./assets
EXPOSE 3000
CMD ["node", "dist/main"]
