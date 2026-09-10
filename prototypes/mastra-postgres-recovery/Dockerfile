FROM node:24-alpine

RUN apk add --no-cache postgresql-client
WORKDIR /prototype
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
CMD ["npm", "run", "prototype"]
