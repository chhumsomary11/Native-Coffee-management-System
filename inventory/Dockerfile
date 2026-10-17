FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY inventory/package.json inventory/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node inventory/ ./

USER node

EXPOSE 3004

CMD ["npm", "start"]
