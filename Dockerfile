# better-sqlite3 and sqlite-vec ship prebuilt binaries for linux-x64 (glibc,
# the Node 22 ABI) -- confirmed by a clean `npm ci --omit=dev` and a
# successful `require()` of both on this platform, no compiler needed.
#
# node_modules is installed on the HOST and copied in rather than run via
# `npm ci` inside the build: this sandbox's container builds have no path to
# the npm registry (only the host process does), which isn't a Cloud Build/CI
# constraint -- a real CI pipeline should run `npm ci` in this Dockerfile
# instead once it has normal registry access. Revisit before relying on this
# image outside this sandbox.
FROM mirror.gcr.io/library/node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
