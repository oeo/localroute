#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

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

const main = async () => {
  console.log('setting up nginx-dns...')
  
  ensure_dirs()
  
  console.log('generating configurations...')
  require('./config-parser')
  
  console.log('generating certificates...')
  require('./generate-certs')
  
  console.log('starting containers...')
  execSync('docker-compose up -d', { stdio: 'inherit' })
  
  console.log('\nsetup complete!')
  console.log('to use:')
  console.log('1. edit sites.conf to add your domains')
  console.log('2. run this script again to apply changes')
  console.log('3. point your system dns to 127.0.0.1')
  console.log('\nif using mkcert:')
  console.log('- certificates will be automatically trusted')
  console.log('- no browser warnings will appear')
  console.log('\nif using self-signed certs:')
  console.log('- you will need to click through browser warnings')
  console.log('- to avoid warnings, install mkcert:')
  console.log('  macOS: brew install mkcert')
  console.log('  Linux: apt install mkcert')
}

main().catch(console.error) 