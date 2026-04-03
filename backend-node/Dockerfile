FROM node:20
WORKDIR /app

# Otimizacao do uso do cache do Docker
COPY package.json package-lock.json ./
RUN npm ci

# Agora copiamos o restante do fonte
COPY . .

# Expõe a porta que o Node usa
EXPOSE 8000

# Roda o comando mapeado no package.json -> start (node src/app.js)
CMD ["npm", "start"]
