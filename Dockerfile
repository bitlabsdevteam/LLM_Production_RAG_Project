FROM node:18-bullseye

# Install dependencies for Puppeteer and aws-lambda-ric
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/task

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create output directories
RUN mkdir -p html images text

# Expose port
EXPOSE 8080

# Set the command to run the JioPay crawler
CMD ["node", "-e", "const { handler } = require('./JioPay_crawler.js'); handler({ startUrl: 'https://jiopay.com/business/help-center', submenuSelectors: ['div[tabindex=\"0\"] div[dir=\"auto\"]', 'div[data-testid=\"ViewTestId\"] div[tabindex=\"0\"]', 'div.css-g5y9jx.r-lrvibr div[dir=\"auto\"]'], routeDiscovery: 'tabs', outputPrefix: 'jiopay-help' }).then(console.log).catch(console.error);"]