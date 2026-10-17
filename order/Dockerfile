FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY order/package.json order/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node order/ ./

USER node

EXPOSE 3005

CMD ["npm", "start"]
