FROM node:20-slim

# Install Python 3 + pip for the Opus decoder sidecar
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip libopus-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps for Opus decoding
RUN pip3 install --break-system-packages sphn numpy

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files first for caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/bridge/package.json apps/bridge/build.js apps/bridge/tsconfig.json apps/bridge/
COPY apps/orchestrator/package.json apps/orchestrator/tsconfig.json apps/orchestrator/
COPY apps/workers/package.json apps/workers/tsconfig.json apps/workers/
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/storage/package.json packages/storage/tsconfig.json packages/storage/

RUN pnpm install

# Copy source and build
COPY . .
RUN pnpm build

EXPOSE 10000

CMD ["node", "apps/bridge/dist/server.js"]
