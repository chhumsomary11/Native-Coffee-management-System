FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY login/package.json login/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node login/ ./

USER node

EXPOSE 3002

CMD ["npm", "start"]
