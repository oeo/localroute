FROM alpine:3.19

RUN apk add --no-cache dnsmasq

EXPOSE 53/udp
EXPOSE 53/tcp

CMD ["dnsmasq", "-k"] 