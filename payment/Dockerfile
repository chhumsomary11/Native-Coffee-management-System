FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY payment/package.json payment/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node payment/ ./

USER node

EXPOSE 3006

CMD ["npm", "start"]
