# The wall dashboard: one Node process serving the built site and its API.
# Music isn't controlled from here in production; the kiosk browser talks to the
# helper on the PC (MUSIC_SOURCE=helper).

FROM node:24-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
COPY music/package.json music/
RUN npm ci
COPY dashboard dashboard
RUN npm run build -w dashboard

FROM node:24-alpine AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
COPY music/package.json music/
RUN npm ci --omit=dev --workspace=dashboard

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app/dashboard
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/dashboard/package.json ./
COPY --from=build /app/dashboard/dist ./dist
COPY --from=build /app/dashboard/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist-server/index.js"]
