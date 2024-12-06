# localroute 

a local dns and routing solution using dnsmasq and nginx in docker. this project allows you to:

- handle local dns resolution with dnsmasq
- route traffic using nginx as a reverse proxy
- support both http and https with automatic certificate generation
- run everything in containers for portability

## prerequisites
- `docker`
- `docker-compose`
- `node.js` (for configuration scripts)
  - no dependencies, just used to parse `sites.conf`
- `mkcert` (optional, for trusted certificates)

## installation
1. clone this repository
2. run `chmod +x setup.js` to make the setup script executable
3. install mkcert (optional, for trusted certificates):
   ```bash
   # macos
   brew install mkcert
   
   # ubuntu/debian
   apt install mkcert
   
   # arch
   pacman -S mkcert
   ```

## configuration
edit `sites.conf` to define your domains and upstream servers:

```json
{
  "sites": [
    {
      "force_ssl": false,
      "force_dns": true,
      "network_domain": "example.local",
      "real_host": "http://192.168.1.100:8080"
    },
    {
      "force_ssl": true,
      "force_dns": true,
      "network_domain": "librechat.local",
      "real_host": "http://192.168.1.167:3006"
    }
  ]
}
```

## usage
1. configure your sites in `sites.conf`

2. run the setup script:
   ```bash
   ./setup.js
   ```
   this will:
   - generate nginx and dnsmasq configurations
   - create ssl certificates (trusted if mkcert is installed)
   - start the docker containers

3. point your proxmox dns to this vm ip
   ```bash
   # macos: edit /etc/resolv.conf (requires disabling system dns)
   nameserver 127.0.0.1
   
   # linux: edit /etc/resolv.conf or network manager
   nameserver 127.0.0.1
   ```

4. access your sites:
   - http://example.local
   - https://librechat.local

## ssl certificates
the project supports two methods for ssl:

1. `mkcert` (recommended):
   - generates locally-trusted certificates
   - no browser warnings
   - certificates are automatically trusted
   - requires mkcert to be installed

2. self-signed (fallback):
   - used when mkcert is not available
   - requires clicking through browser warnings
   - still secure, just not automatically trusted

## docker commands
```bash
# start services
docker-compose up -d

# stop services
docker-compose down

# view logs
docker-compose logs -f

# restart after config changes
./setup.js
```

## network configuration
the service runs on the following ports:
- dns (dnsmasq): 53/udp
- http (nginx): 80
- https (nginx): 443

## troubleshooting
1. dns not working:
   - check if port 53 is available
   - ensure your system dns points to 127.0.0.1
   - try adding domains to /etc/hosts as fallback

2. ssl certificate warnings:
   - install mkcert for trusted certificates
   - or click through the warnings for self-signed certs

3. upstream server not reachable:
   - verify the real_host ip and port in sites.conf
   - ensure the upstream server is running
   - check docker network connectivity
