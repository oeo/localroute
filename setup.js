#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const kill_port_53 = () => {
  console.log('checking for processes on port 53...')
  try {
    // find and kill processes on port 53 (both tcp and udp)
    if (process.platform === 'darwin') {
      execSync('sudo lsof -i :53 | grep LISTEN | awk \'{print $2}\' | xargs kill -9', { stdio: 'ignore' })
    } else {
      execSync('sudo fuser -k 53/tcp 53/udp', { stdio: 'ignore' })
    }
  } catch (e) {
    // ignore errors if no processes found
  }
}

const cleanup_docker = () => {
  console.log('cleaning up docker containers...')
  try {
    execSync('docker-compose down', { stdio: 'ignore' })
  } catch (e) {
    // ignore errors if containers aren't running
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

const refresh_config = () => {
  console.log('refreshing configuration...')
  kill_port_53()
  cleanup_docker()
  require('./config-parser')
  require('./generate-certs')
  console.log('starting containers...')
  execSync('docker-compose restart', { stdio: 'inherit' })
  console.log('refresh complete!')
}

const watch_mode = () => {
  console.log('watching for changes in sites.conf...')
  console.log('press ctrl+c to stop')
  
  fs.watch('sites.conf', (eventType, filename) => {
    if (eventType === 'change') {
      console.log('\ndetected changes in sites.conf')
      refresh_config()
    }
  })
}

const main = async () => {
  const args = process.argv.slice(2)
  const should_watch = args.includes('--watch') || args.includes('-w')
  
  console.log('setting up localroute...')
  ensure_dirs()
  
  console.log('generating initial configuration...')
  require('./config-parser')
  
  console.log('generating certificates...')
  require('./generate-certs')
  
  kill_port_53()
  cleanup_docker()
  
  console.log('starting containers...')
  try {
    execSync('docker-compose up -d', { stdio: 'inherit' })
  } catch (error) {
    console.error('Error starting containers:', error.message)
    process.exit(1)
  }
  
  console.log('\nsetup complete!')
  console.log('to use:')
  console.log('1. edit sites.conf to add your domains')
  console.log('2. run this script with --watch to auto-refresh on changes')
  console.log('3. point your system dns to 127.0.0.1')
  console.log('\nif using mkcert:')
  console.log('- certificates will be automatically trusted')
  console.log('- no browser warnings will appear')
  console.log('\nif using self-signed certs:')
  console.log('- you will need to click through browser warnings')
  console.log('- to avoid warnings, install mkcert:')
  console.log('  macOS: brew install mkcert')
  console.log('  Linux: apt install mkcert')

  if (should_watch) {
    watch_mode()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
}) 