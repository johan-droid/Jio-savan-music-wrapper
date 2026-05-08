# 📄 Dockerfile
FROM node:18-alpine

# Setup non-root user and app directory
WORKDIR /usr/src/app
RUN chown node:node /usr/src/app

# Install dependencies (leverage Docker cache)
COPY package*.json ./
USER node
RUN npm ci --only=production

# Copy application code
COPY --chown=node:node src/ ./src/
COPY --chown=node:node index.js ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "index.js"]
