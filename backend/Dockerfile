FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o /auto-issue ./cmd/server

FROM alpine:3.21

COPY --from=builder /auto-issue /auto-issue

EXPOSE 8080

CMD ["/auto-issue"]
