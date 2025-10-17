FROM node:18-slim
WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy source
COPY src ./src

EXPOSE 3000
CMD ["node", "src/index.js"]

