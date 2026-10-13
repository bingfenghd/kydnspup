FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production KY_HOST=127.0.0.1 KY_PORT=4178 KY_DATA_DIR=/app/var
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY server ./server
COPY shared ./shared
COPY scripts/deployment-data.mjs ./scripts/deployment-data.mjs
RUN mkdir /app/var && chown node:node /app/var
USER node
CMD ["node", "server/index.mjs"]
