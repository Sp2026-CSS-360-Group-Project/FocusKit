FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Run the full verification suite during the image build so CI fails fast
# when either the unit tests or the Chromium smoke test breaks.
RUN npm test

# Keep the container available for debugging after a successful verification run.
CMD ["npm", "test"]