#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const dns = require('dns')
const http = require('http')
const https = require('https')

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
  const dirs = [
    'docker/nginx',
    'docker/dnsmasq',
    'ssl'
  ]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

const test_http = async (sites) => {
  console.log('\ntesting http connectivity...')
  
  for (const site of sites) {
    const protocol = site.force_ssl ? 'https' : 'http'
    const url = `${protocol}://172.20.0.2`
    
    try {
      console.log(`testing ${site.network_domain}...`)
      const response = await new Promise((resolve, reject) => {
        const req = (protocol === 'https' ? https : http).get(url, {
          headers: { Host: site.network_domain },
          rejectUnauthorized: false,
          timeout: 5000
        }, resolve)
        req.on('error', reject)
        req.end()
      })
      console.log(`✓ ${site.network_domain} -> ${response.statusCode}`)
    } catch (error) {
      console.error(`✗ failed to connect to ${site.network_domain}: ${error.message}`)
    }
  }
}

const test_dns = async (sites) => {
  console.log('\ntesting dns resolution...')
  const resolver = new dns.Resolver()
  resolver.setServers(['127.0.0.1'])

  for (const site of sites) {
    if (site.force_dns) {
      try {
        console.log(`resolving ${site.network_domain}...`)
        const addresses = await new Promise((resolve, reject) => {
          resolver.resolve4(site.network_domain, (err, addresses) => {
            if (err) reject(err)
            else resolve(addresses)
          })
        })
        if (addresses[0] === '172.20.0.2') {
          console.log(`✓ ${site.network_domain} -> ${addresses[0]}`)
        } else {
          console.error(`✗ ${site.network_domain} resolved to wrong IP: ${addresses[0]} (expected 172.20.0.2)`)
        }
      } catch (error) {
        console.error(`✗ failed to resolve ${site.network_domain}: ${error.message}`)
      }
    }
  }
}

const main = async () => {
  try {
    console.log('validating configuration...')
    const sites = validate_config()

    console.log('setting up directories...')
    ensure_dirs()

    console.log('generating configuration...')
    require('./config-parser')

    console.log('generating certificates...')
    generate_certificates(sites)

    kill_port_53()

    console.log('starting services...')
    execSync('docker-compose down', { stdio: 'inherit' })
    execSync('docker-compose up -d', { stdio: 'inherit' })

    // Wait for services to start
    console.log('waiting for services to start...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Run tests
    await test_dns(sites)
    await test_http(sites)

    console.log('\nsetup complete! your local routes are ready.')
    console.log('\nto use:')
    console.log('1. add to /etc/hosts or point dns to this server:')
    for (const site of sites) {
      console.log(`   172.20.0.2 ${site.network_domain}`)
    }
    console.log('2. or configure your dns server to use this as upstream')
    console.log('3. or add nameserver 127.0.0.1 to /etc/resolv.conf')
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