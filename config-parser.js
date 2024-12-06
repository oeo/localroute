const fs = require('fs')
const path = require('path')

const parse_config = (content) => {
  const sites = []
  const lines = content.split('\n')
  let current_site = null

  for (const line of lines) {
    const trimmed = line.trim()
    
    if (trimmed.startsWith('define {')) {
      current_site = {}
      continue
    }

    if (trimmed === '}') {
      if (current_site) sites.push(current_site)
      current_site = null
      continue
    }

    if (current_site && trimmed) {
      const [key, value] = trimmed.split(':').map(s => s.trim())
      if (key && value) {
        current_site[key] = value.replace(/[",]/g, '')
      }
    }
  }

  return sites
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
    const ssl = site.force_ssl === 'true'
    const domain = site.network_domain
    const upstream = site.real_host.replace(/^https?:\/\//, '')

    config += `
  # ${domain}
  server {
    listen 80;
    server_name ${domain};
    ${ssl ? 'return 301 https://$server_name$request_uri;' : ''}

    ${!ssl ? `location / {
      proxy_pass http://${upstream};
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }` : ''}
  }`

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

# disable mdns
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

`

  for (const site of sites) {
    if (site.force_dns === 'true') {
      config += `# ${site.network_domain}
address=/${site.network_domain}/172.20.0.2\n`
    }
  }

  return config
}

const main = () => {
  const config_content = fs.readFileSync('sites.conf', 'utf8')
  const sites = parse_config(config_content)

  fs.writeFileSync('docker/nginx/nginx.conf', generate_nginx_config(sites))
  fs.writeFileSync('docker/dnsmasq/dnsmasq.conf', generate_dnsmasq_config(sites))
}

if (require.main === module) {
  main()
}

module.exports = {
  parse_config,
  generate_nginx_config,
  generate_dnsmasq_config
} 