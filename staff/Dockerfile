FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY staff/package.json staff/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node staff/ ./

USER node

EXPOSE 3007

CMD ["npm", "start"]
