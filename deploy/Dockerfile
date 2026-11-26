FROM golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/netviz-server ./cmd/netviz-server

FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

RUN adduser -D -H -u 10001 netviz && mkdir -p /data && chown netviz /data
USER netviz
COPY --from=build /out/netviz-server /usr/local/bin/netviz-server
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["netviz-server"]
CMD ["-addr", ":8080", "-db", "/data/netviz.db"]
