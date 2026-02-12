# ABOUTME: Legacy Dockerfile - kept for backward compatibility
# ABOUTME: For new deployments, use service-specific Dockerfiles

# This monorepo contains multiple services with their own Dockerfiles:
# - berlin-open-data-mcp/Dockerfile (bod-mcp service)
# - datawrapper-mcp/Dockerfile (datawrapper-mcp service)
# - interface-prototype/Dockerfile (interface service)
#
# For Railway deployment, configure each service to use its respective Dockerfile.

# Legacy build (builds all components as single service)
FROM node:22-bookworm-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY berlin-open-data-mcp/package*.json ./berlin-open-data-mcp/
COPY datawrapper-mcp/package*.json ./datawrapper-mcp/
COPY interface-prototype/package*.json ./interface-prototype/
COPY interface-prototype/backend/package*.json ./interface-prototype/backend/
COPY interface-prototype/frontend/package*.json ./interface-prototype/frontend/

# Install root dependencies
RUN npm install

# Copy source code
COPY . .

# Build all components
RUN npm run build

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
