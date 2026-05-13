# syntax=docker/dockerfile:1.7
# Three targets:
#   * deps    — shared `npm ci` cache layer
#   * dev     — Astro dev server, content hot-reloads via bind-mounted ./src
#   * runtime — production nginx serving the built static site

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ----- dev: live reload via bound source -----
FROM deps AS dev
ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=4321 \
    # macOS Docker Desktop sometimes drops inotify events; polling is the safe fallback.
    CHOKIDAR_USEPOLLING=true \
    CHOKIDAR_INTERVAL=300
EXPOSE 4321
CMD ["npx", "astro", "dev", "--host", "0.0.0.0", "--port", "4321"]

# ----- build: produce ./dist -----
FROM deps AS build
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ----- runtime: tiny nginx serving the static site -----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1
