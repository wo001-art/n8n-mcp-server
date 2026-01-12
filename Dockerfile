FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.js ./
COPY nodes-data ./nodes-data
EXPOSE 3000
CMD ["node", "index.js"]
