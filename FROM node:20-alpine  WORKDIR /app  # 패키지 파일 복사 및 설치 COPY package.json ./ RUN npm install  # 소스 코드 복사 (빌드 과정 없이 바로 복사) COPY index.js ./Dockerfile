FROM node:20-alpine

WORKDIR /app

# 패키지 파일 복사 및 설치
COPY package.json ./
RUN npm install

# 소스 코드 복사 (빌드 과정 없이 바로 복사)
COPY index.js ./

# 포트 개방
EXPOSE 3000

# 서버 실행
CMD ["node", "index.js"]
