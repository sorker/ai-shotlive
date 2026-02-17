# 使用多阶段构建来优化镜像大小
# 阶段1: 构建阶段
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果存在)
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制所有源代码
COPY . .

# 构建前端
RUN npm run build:client

# 构建后端
RUN npm run build:server

# 阶段2: 生产阶段
FROM node:20-alpine

WORKDIR /app

# 复制 package.json 用于安装生产依赖
COPY package*.json ./
RUN npm install --omit=dev

# 从构建阶段复制前端构建产物
COPY --from=builder /app/dist ./dist

# 从构建阶段复制后端构建产物
COPY --from=builder /app/server/dist ./server/dist

# 复制静态资源
COPY --from=builder /app/favicon.ico ./dist/
COPY --from=builder /app/qrcode.png ./dist/

# 复制 nginx 配置（用于参考，实际使用 Express 提供服务）
COPY nginx.conf ./nginx.conf

# 创建 uploads 目录
RUN mkdir -p /app/uploads

# 暴露端口
EXPOSE 3001

# 启动 Express 服务器
CMD ["node", "server/dist/index.js"]
