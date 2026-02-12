# ABOUTME: Dockerfile for Datawrapper MCP standalone HTTP server
# ABOUTME: Lightweight image for visualization chart creation service

FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8080

ENV PORT=8080
CMD ["npm", "run", "start:http"]
