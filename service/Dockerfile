# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

RUN go mod tidy && \
    CGO_ENABLED=0 go build -ldflags="-s -w" -o cookie-sync .

FROM scratch

COPY --from=builder /app/cookie-sync /cookie-sync

ENV HOST=0.0.0.0
ENV PORT=8080
ENV COOKIE_FILE=/data/cookies.txt

EXPOSE 8080

ENTRYPOINT ["/cookie-sync"]
