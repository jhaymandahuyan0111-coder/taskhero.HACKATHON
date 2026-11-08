FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY backend/package*.json ./backend/
RUN npm --prefix backend install --omit=dev
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "backend/server.js"]
