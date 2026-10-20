FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=31012
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js easytier-peers.cjs lolping-protocol.cjs chat-store.cjs ./
RUN mkdir -p /app/data \
  && chown -R node:node /app \
  && chmod -R u+rwX,go+rX /app
VOLUME ["/app/data"]
USER node
EXPOSE 31012
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||31012)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
