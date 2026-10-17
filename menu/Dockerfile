# PRODUCTION READY
# Use the official Node.js 24 Alpine image
FROM node:24-alpine


ENV NODE_ENV=production

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY menu/package.json menu/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY --chown=node:node menu/ ./

# Document the port the application listens on
EXPOSE 3003

# Run the container as a non-root user for security
USER node

# Start the application
CMD ["npm", "start"]