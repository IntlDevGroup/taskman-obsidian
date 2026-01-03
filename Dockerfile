FROM node:20-alpine

# Install bash for better shell experience
RUN apk add --no-cache bash git

WORKDIR /app

# Keep container running for dev container
CMD ["sleep", "infinity"]