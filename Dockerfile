FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN addgroup -S app && adduser -S app -G app
USER app
ENV NODE_ENV=production
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node","src/server.js"]
