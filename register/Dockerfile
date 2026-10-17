FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY register/package.json register/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node register/ ./

USER node

EXPOSE 3001

CMD ["npm", "start"]
