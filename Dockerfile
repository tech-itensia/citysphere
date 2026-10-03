# One image for every Node.js microservice; docker-compose picks the entrypoint per service.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY tools ./tools
RUN npm install --no-audit --no-fund --include=dev && npm cache clean --force \
 && chown -R node:node /app && chmod -R u+rwX,go+rX /app
# Files copied from the host can be owner-only (0600/0700): the chown/chmod above makes them readable by "node".
USER node
EXPOSE 3000
CMD ["node", "-e", "console.error('Set the service command, e.g. node_modules/.bin/tsx services/api-gateway/src/index.ts'); process.exit(1)"]
