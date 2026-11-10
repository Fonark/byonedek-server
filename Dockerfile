FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Hugging Face Spaces menggunakan port 7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "src/server.js"]
