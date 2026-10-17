FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY api-gateway/package.json api-gateway/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node api-gateway/ ./

USER node

EXPOSE 4000

CMD ["npm", "start"]
