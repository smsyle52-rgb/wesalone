FROM node:22-bookworm-slim
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-color-emoji ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8090
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
