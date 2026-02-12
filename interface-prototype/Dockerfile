# ABOUTME: Dockerfile for the chat interface prototype
# ABOUTME: Builds both frontend (Svelte) and backend (Express) components

FROM node:22-bookworm-slim

WORKDIR /app

# Copy and install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Copy and install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy source code
COPY . .

# Build frontend and backend
RUN cd frontend && npm run build
RUN cd backend && npm run build

EXPOSE 8080

ENV PORT=8080
CMD ["node", "backend/dist/server.js"]
