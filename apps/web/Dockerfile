# Build the SPA, then serve it with nginx (which also proxies /api to the gateway: one origin, no CORS).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Host files can be owner-only; make everything readable by the nginx worker.
RUN chmod -R a+rX /usr/share/nginx/html /etc/nginx/conf.d
EXPOSE 80
