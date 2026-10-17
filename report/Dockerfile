FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY report/package.json report/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node report/ ./

USER node

EXPOSE 3008

CMD ["npm", "start"]
