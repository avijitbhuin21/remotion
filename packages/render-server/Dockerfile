FROM node:22-bookworm-slim

RUN apt-get update && apt install -y \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  curl \
  unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

COPY packages/render-server/package.json ./package.json
RUN bun install --frozen-lockfile

RUN bunx remotion browser ensure

COPY packages/render-server/tsconfig.json ./tsconfig.json
COPY packages/render-server/src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV MAX_CONCURRENT_RENDERS=8

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
