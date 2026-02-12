# ABOUTME: Dockerfile for Masterportal MCP standalone HTTP server
# ABOUTME: Generates Masterportal zip packages from geodata

FROM node:22-bookworm-slim

# Install curl and unzip for runtime download
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Download Masterportal runtime (pre-built from official website)
# Cache bust: v4 - preserve 3_12_0 folder name for webpack paths
RUN chmod +x scripts/download-runtime.sh && ./scripts/download-runtime.sh

# Create directories for downloads
RUN mkdir -p downloads

EXPOSE 8080

ENV PORT=8080
CMD ["npm", "run", "start:http"]
