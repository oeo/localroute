const fs = require('fs')
const path = require('path')

const parse_config = (content) => {
  try {
    const config = JSON.parse(content)
    return config.sites
  } catch (error) {
    console.error('Error parsing config:', error.message)
    process.exit(1)
  }
}

const generate_nginx_config = (sites) => {
  let config = `user nginx;
worker_processes auto;
pid /var/run/nginx.pid;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                  '$status $body_bytes_sent "$http_referer" '
                  '"$http_user_agent" "$http_x_forwarded_for"';

  access_log /dev/stdout main;
  error_log /dev/stderr warn;

  sendfile on;
  tcp_nopush on;
  tcp_nodelay on;
  keepalive_timeout 65;
  types_hash_max_size 2048;

  # default server block
  server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
      return 404;
    }
  }
`

  for (const site of sites) {
    const ssl = site.force_ssl
    const domain = site.network_domain
    const upstream = site.real_host.replace(/^http:\/\//, '')

    console.log(`Processing site: ${domain} -> ${upstream}`)

    // HTTP server block
    config += `
  # ${domain}
  server {
    listen 80;
    server_name ${domain};
`
    if (ssl) {
      config += `    return 301 https://$server_name$request_uri;
  }`
    } else {
      config += `    location / {
      proxy_pass http://${upstream};
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 300;
      proxy_connect_timeout 300;
    }
  }`
    }

    // HTTPS server block if SSL is enabled
    if (ssl) {
      config += `

  server {
    listen 443 ssl;
    server_name ${domain};
    
    ssl_certificate /etc/nginx/ssl/${domain}.crt;
    ssl_certificate_key /etc/nginx/ssl/${domain}.key;

    location / {
      proxy_pass http://${upstream};
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 300;
      proxy_connect_timeout 300;
    }
  }`
    }
  }

  config += '\n}\n'
  return config
}

const generate_dnsmasq_config = (sites) => {
  let config = `# don't use /etc/resolv.conf
no-resolv

# listen on all interfaces
interface=*

# enable dns forwarding
all-servers
dns-forward-max=150

# disable mdns warnings
local-service
domain-needed

# handle local domains
local=/local/
domain-needed
bogus-priv
expand-hosts

# enable logging
log-queries
log-facility=-

# cache size
cache-size=1000

# fallback dns resolvers (cloudflare and google)
server=1.1.1.1
server=8.8.8.8

# explicitly handle .local domains
address=/.local/172.20.0.2

# disable mdns
server=/local/
server=/254.169.in-addr.arpa/
server=/8.e.f.ip6.arpa/
server=/9.e.f.ip6.arpa/
server=/a.e.f.ip6.arpa/
server=/b.e.f.ip6.arpa/

`

  for (const site of sites) {
    if (site.force_dns) {
      config += `# ${site.network_domain}
address=/${site.network_domain}/172.20.0.2\n`
    }
  }

  return config
}

const main = () => {
  try {
    const config_content = fs.readFileSync('sites.conf', 'utf8')
    const sites = parse_config(config_content)

    fs.writeFileSync('docker/nginx/nginx.conf', generate_nginx_config(sites))
    fs.writeFileSync('docker/dnsmasq/dnsmasq.conf', generate_dnsmasq_config(sites))
    
    console.log('Configuration generated successfully')
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  parse_config,
  generate_nginx_config,
  generate_dnsmasq_config
} 