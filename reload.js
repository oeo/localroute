#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const dns = require('dns')
const http = require('http')
const https = require('https')

const cleanup = () => {
  console.log('cleaning up...')
  try {
    // Stop services
    execSync('docker-compose down', { stdio: 'inherit' })
  } catch (error) {
    console.error('cleanup error:', error.message)
  }
}

const cleanup_files = () => {
  console.log('cleaning up generated files...')
  try {
    // Remove generated files
    const files_to_remove = [
      'docker/nginx/nginx.conf',
      'docker/dnsmasq/dnsmasq.conf'
    ]

    for (const file of files_to_remove) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
      }
    }
  } catch (error) {
    console.error('cleanup error:', error.message)
  }
}

const validate_config = () => {
  try {
    const config = JSON.parse(fs.readFileSync('sites.conf', 'utf8'))
    if (!config.sites || !Array.isArray(config.sites)) {
      throw new Error('sites.conf must contain a "sites" array')
    }
    
    for (const site of config.sites) {
      if (!site.network_domain) throw new Error('Each site must have a network_domain')
      if (!site.real_host) throw new Error('Each site must have a real_host')
      if (typeof site.force_ssl !== 'boolean') throw new Error('force_ssl must be a boolean')
      if (typeof site.force_dns !== 'boolean') throw new Error('force_dns must be a boolean')
      
      // Validate real_host format
      if (!site.real_host.match(/^https?:\/\/[^\/]+$/)) {
        throw new Error(`Invalid real_host format for ${site.network_domain}: ${site.real_host}`)
      }
    }
    return config.sites
  } catch (error) {
    console.error('Configuration validation failed:', error.message)
    process.exit(1)
  }
}

const generate_certificates = (sites) => {
  console.log('generating ssl certificates...')
  
  // Check if mkcert is available
  let use_mkcert = false
  try {
    execSync('which mkcert', { stdio: 'ignore' })
    use_mkcert = true
    console.log('using mkcert for trusted certificates')
  } catch (e) {
    console.log('mkcert not found, using self-signed certificates')
  }

  // Create ssl directory if it doesn't exist
  if (!fs.existsSync('ssl')) {
    fs.mkdirSync('ssl')
  }

  for (const site of sites) {
    if (site.force_ssl) {
      const domain = site.network_domain
      console.log(`generating certificate for ${domain}...`)

      if (use_mkcert) {
        try {
          execSync(`mkcert -cert-file ssl/${domain}.crt -key-file ssl/${domain}.key ${domain}`, { stdio: 'inherit' })
        } catch (error) {
          console.error(`failed to generate certificate for ${domain}:`, error.message)
          process.exit(1)
        }
      } else {
        try {
          execSync(`openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ssl/${domain}.key -out ssl/${domain}.crt \
            -subj "/CN=${domain}/O=LocalRoute/C=US"`, { stdio: 'inherit' })
        } catch (error) {
          console.error(`failed to generate self-signed certificate for ${domain}:`, error.message)
          process.exit(1)
        }
      }
    }
  }
}

const kill_port_53 = () => {
  console.log('checking for processes on port 53...')
  try {
    if (process.platform === 'darwin') {
      execSync('sudo lsof -i :53 | grep LISTEN | awk \'{print $2}\' | xargs kill -9', { stdio: 'ignore' })
    } else {
      // on linux, handle systemd-resolved first
      try {
        console.log('stopping systemd-resolved...')
        execSync('sudo systemctl stop systemd-resolved', { stdio: 'ignore' })
        execSync('sudo systemctl disable systemd-resolved', { stdio: 'ignore' })
      } catch (e) {
        // service might not exist
      }

      // handle other potential dns services
      try {
        console.log('stopping other dns services...')
        const services = ['named', 'bind9', 'dnsmasq.service']
        for (const service of services) {
          try {
            execSync(`sudo systemctl stop ${service}`, { stdio: 'ignore' })
            execSync(`sudo systemctl disable ${service}`, { stdio: 'ignore' })
          } catch (e) {
            // service might not exist
          }
        }
      } catch (e) {
        // ignore errors if services don't exist
      }

      // kill any remaining processes on port 53
      try {
        execSync('sudo fuser -k 53/tcp 53/udp', { stdio: 'ignore' })
      } catch (e) {
        // no processes might be found
      }
    }
  } catch (e) {
    console.log('note: no processes found on port 53')
  }
}

const ensure_dirs = () => {
  console.log('setting up directories...')
  const dirs = [
    'docker/nginx',
    'docker/dnsmasq',
    'ssl'
  ]

  // Create directories with explicit permissions
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        console.log(`creating directory: ${dir}`)
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
      }
      // Ensure directory is writable
      fs.accessSync(dir, fs.constants.W_OK)
    } catch (error) {
      console.error(`Error with directory ${dir}:`, error.message)
      process.exit(1)
    }
  }

  // Write initial nginx config
  const nginx_config = `user nginx;
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

  server {
    listen 80 default_server;
    server_name _;
    return 404;
  }
}
`

  // Write initial dnsmasq config
  const dnsmasq_config = `# don't use /etc/resolv.conf
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

# fallback dns resolvers
server=1.1.1.1
server=8.8.8.8

# explicitly handle .local domains
address=/.local/172.20.0.2
`

  try {
    // Write nginx config with explicit permissions
    console.log('writing initial nginx config...')
    const nginx_path = 'docker/nginx/nginx.conf'
    fs.writeFileSync(nginx_path, nginx_config, { 
      encoding: 'utf8', 
      mode: 0o644,
      flag: 'w'
    })
    
    // Verify nginx config was written correctly
    const written_nginx = fs.readFileSync(nginx_path, 'utf8')
    if (written_nginx.length !== nginx_config.length) {
      throw new Error(`nginx config verification failed: expected ${nginx_config.length} bytes but got ${written_nginx.length}`)
    }
    console.log(`nginx config written successfully (${written_nginx.length} bytes)`)

    // Write dnsmasq config with explicit permissions
    console.log('writing initial dnsmasq config...')
    const dnsmasq_path = 'docker/dnsmasq/dnsmasq.conf'
    fs.writeFileSync(dnsmasq_path, dnsmasq_config, { 
      encoding: 'utf8', 
      mode: 0o644,
      flag: 'w'
    })
    
    // Verify dnsmasq config was written correctly
    const written_dnsmasq = fs.readFileSync(dnsmasq_path, 'utf8')
    if (written_dnsmasq.length !== dnsmasq_config.length) {
      throw new Error(`dnsmasq config verification failed: expected ${dnsmasq_config.length} bytes but got ${written_dnsmasq.length}`)
    }
    console.log(`dnsmasq config written successfully (${written_dnsmasq.length} bytes)`)

  } catch (error) {
    console.error('Error writing configuration files:', error.message)
    // Try to get more information about the error
    try {
      const nginx_stats = fs.statSync('docker/nginx/nginx.conf')
      console.error('nginx.conf stats:', {
        size: nginx_stats.size,
        mode: nginx_stats.mode.toString(8),
        uid: nginx_stats.uid,
        gid: nginx_stats.gid
      })
    } catch (e) {
      console.error('Could not get nginx.conf stats:', e.message)
    }
    try {
      const dnsmasq_stats = fs.statSync('docker/dnsmasq/dnsmasq.conf')
      console.error('dnsmasq.conf stats:', {
        size: dnsmasq_stats.size,
        mode: dnsmasq_stats.mode.toString(8),
        uid: dnsmasq_stats.uid,
        gid: dnsmasq_stats.gid
      })
    } catch (e) {
      console.error('Could not get dnsmasq.conf stats:', e.message)
    }
    process.exit(1)
  }
}

const configure_system_dns = () => {
  console.log('configuring system dns...')
  
  // Backup existing resolv.conf
  if (fs.existsSync('/etc/resolv.conf') && !fs.existsSync('/etc/resolv.conf.backup')) {
    try {
      execSync('sudo cp /etc/resolv.conf /etc/resolv.conf.backup', { stdio: 'inherit' })
      console.log('backed up existing resolv.conf')
    } catch (error) {
      console.error('failed to backup resolv.conf:', error.message)
      return
    }
  }

  // Write new resolv.conf
  try {
    const resolv_conf = 'nameserver 127.0.0.1\noptions timeout:1\n'
    execSync(`echo '${resolv_conf}' | sudo tee /etc/resolv.conf`, { stdio: 'inherit' })
    console.log('updated resolv.conf to use local dns')
  } catch (error) {
    console.error('failed to update resolv.conf:', error.message)
    return
  }

  // Verify the change
  try {
    const current = fs.readFileSync('/etc/resolv.conf', 'utf8')
    if (!current.includes('nameserver 127.0.0.1')) {
      console.error('failed to verify dns configuration')
      return
    }
  } catch (error) {
    console.error('failed to verify dns configuration:', error.message)
    return
  }
}

const test_dns = async (sites) => {
  console.log('\ntesting dns resolution...')
  const resolver = new dns.Resolver()
  resolver.setServers(['127.0.0.1'])

  const test_domain = async (site) => {
    if (!site.force_dns) return

    return new Promise((resolve) => {
      console.log(`resolving ${site.network_domain}...`)
      resolver.resolve4(site.network_domain, { timeout: 5000 }, (err, addresses) => {
        if (err) {
          console.error(`✗ failed to resolve ${site.network_domain}: ${err.message}`)
        } else if (addresses[0] === '172.20.0.2') {
          console.log(`✓ ${site.network_domain} -> ${addresses[0]}`)
        } else {
          console.error(`✗ ${site.network_domain} resolved to wrong IP: ${addresses[0]} (expected 172.20.0.2)`)
        }
        resolve()
      })
    })
  }

  // Test domains sequentially
  for (const site of sites) {
    await test_domain(site)
  }
}

const test_http = async (sites) => {
  console.log('\ntesting http connectivity...')
  
  const test_site = async (site) => {
    const protocol = site.force_ssl ? 'https' : 'http'
    const url = `${protocol}://172.20.0.2`
    
    return new Promise((resolve) => {
      console.log(`testing ${site.network_domain}...`)
      const req = (protocol === 'https' ? https : http).get(url, {
        headers: { Host: site.network_domain },
        rejectUnauthorized: false,
        timeout: 5000
      })

      req.on('response', (response) => {
        console.log(`✓ ${site.network_domain} -> ${response.statusCode}`)
        response.resume() // drain the response
        resolve()
      })

      req.on('error', (error) => {
        console.error(`✗ failed to connect to ${site.network_domain}: ${error.message}`)
        resolve()
      })

      req.on('timeout', () => {
        console.error(`✗ timeout testing ${site.network_domain}`)
        req.destroy()
        resolve()
      })

      req.end()
    })
  }

  // Test sites sequentially
  for (const site of sites) {
    await test_site(site)
  }
}

const main = async () => {
  try {
    // Handle command line arguments
    const args = process.argv.slice(2)
    if (args.includes('--clean')) {
      cleanup()
      cleanup_files()
      return
    }

    console.log('validating configuration...')
    const sites = validate_config()

    console.log('setting up directories...')
    ensure_dirs()

    // Stop services first
    cleanup()

    console.log('generating configuration...')
    require('./config-parser')

    // Verify configs exist
    const required_files = [
      'docker/nginx/nginx.conf',
      'docker/dnsmasq/dnsmasq.conf'
    ]

    for (const file of required_files) {
      if (!fs.existsSync(file)) {
        throw new Error(`Required config file not found: ${file}`)
      }
    }

    console.log('generating certificates...')
    generate_certificates(sites)

    kill_port_53()
    configure_system_dns()

    console.log('starting services...')
    execSync('docker-compose up -d', { stdio: 'inherit' })

    // Wait for services to start
    console.log('waiting for services to start...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Run tests with timeout
    const test_timeout = setTimeout(() => {
      console.error('Tests timed out after 30 seconds')
      process.exit(1)
    }, 30000)

    await test_dns(sites)
    await test_http(sites)

    clearTimeout(test_timeout)

    console.log('\nsetup complete! your local routes are ready.')
    console.log('\nto verify:')
    console.log('1. try pinging your domains:')
    for (const site of sites) {
      console.log(`   ping ${site.network_domain}`)
    }
    console.log('2. try accessing your sites in a browser')
    console.log('3. check docker logs if needed: docker-compose logs -f')
    console.log('\nto restore original dns:')
    console.log('sudo mv /etc/resolv.conf.backup /etc/resolv.conf')

    process.exit(0)
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(console.error)
}

module.exports = {
  validate_config,
  test_dns,
  test_http
} 