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
2. create your `sites.conf`:
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
3. install mkcert (optional, for trusted certificates):
   ```bash
   # macos
   brew install mkcert
   
   # ubuntu/debian
   apt install mkcert
   
   # arch
   pacman -S mkcert
   ```

## usage

### first time setup
```bash
chmod +x reload.js
./reload.js
```

### reloading configuration
whenever you change `sites.conf`, just run:
```bash
./reload.js
```

this will:
- validate your configuration
- generate nginx and dnsmasq configs
- create ssl certificates if needed
- restart the services
- test the configuration

### stopping services
```bash
docker-compose down
```

### viewing logs
```bash
docker-compose logs -f
```

### restoring original dns
if you want to stop using localroute's dns:
```bash
sudo mv /etc/resolv.conf.backup /etc/resolv.conf
```

## configuration
edit `sites.conf` to define your domains and upstream servers. each site can have:

- `force_ssl`: enable https and redirect http to https
- `force_dns`: add dns record to dnsmasq
- `network_domain`: the domain name to use (e.g. example.local)
- `real_host`: the upstream server to proxy to (e.g. http://192.168.1.100:8080)

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

4. checking logs:
   ```bash
   # all services
   docker-compose logs -f
   
   # specific service
   docker-compose logs -f nginx
   docker-compose logs -f dnsmasq
   ```
