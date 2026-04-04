# Build stage
FROM node:20 AS builder
WORKDIR /app
# Copiando manifestos
COPY package.json package-lock.json ./
# Instalando dependencias
RUN npm ci
# Copiando todo o codigo
COPY . .
# Gerando a versao final ("producao") de pacote estatico
RUN npm run build

# Serve stage
FROM nginx:alpine
# Copia o pacote estatico para o diretorio html default do nginx
COPY --from=builder /app/dist /usr/share/nginx/html
# Copia a porta configurada no nginx base
EXPOSE 80
# Comando padrao
CMD ["nginx", "-g", "daemon off;"]
