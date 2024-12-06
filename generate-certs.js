const fs = require('fs')
const { execSync } = require('child_process')
const path = require('path')

const has_mkcert = () => {
  try {
    execSync('which mkcert')
    return true
  } catch {
    return false
  }
}

const generate_self_signed = (domain) => {
  const ssl_dir = path.join(__dirname, 'ssl')
  if (!fs.existsSync(ssl_dir)) {
    fs.mkdirSync(ssl_dir, { recursive: true })
  }

  const key_path = path.join(ssl_dir, `${domain}.key`)
  const cert_path = path.join(ssl_dir, `${domain}.crt`)

  if (fs.existsSync(key_path) && fs.existsSync(cert_path)) {
    console.log(`certificates for ${domain} already exist, skipping...`)
    return
  }

  console.log(`generating self-signed certificate for ${domain}...`)
  
  const openssl_cmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout ${key_path} \
    -out ${cert_path} \
    -subj "/C=US/ST=Local/L=Local/O=Local/CN=${domain}"`

  execSync(openssl_cmd, { stdio: 'inherit' })
}

const generate_mkcert = (domain) => {
  const ssl_dir = path.join(__dirname, 'ssl')
  if (!fs.existsSync(ssl_dir)) {
    fs.mkdirSync(ssl_dir, { recursive: true })
  }

  const key_path = path.join(ssl_dir, `${domain}.key`)
  const cert_path = path.join(ssl_dir, `${domain}.crt`)

  if (fs.existsSync(key_path) && fs.existsSync(cert_path)) {
    console.log(`certificates for ${domain} already exist, skipping...`)
    return
  }

  console.log(`generating trusted certificate for ${domain} using mkcert...`)
  
  // ensure mkcert is initialized
  execSync('mkcert -install', { stdio: 'inherit' })
  
  // generate cert
  execSync(`cd ${ssl_dir} && mkcert ${domain}`, { stdio: 'inherit' })
  
  // rename files to match our naming convention
  fs.renameSync(path.join(ssl_dir, `${domain}.pem`), cert_path)
  fs.renameSync(path.join(ssl_dir, `${domain}-key.pem`), key_path)
}

const main = () => {
  const config_content = fs.readFileSync('sites.conf', 'utf8')
  const sites = require('./config-parser').parse_config(config_content)
  const use_mkcert = has_mkcert()

  if (use_mkcert) {
    console.log('mkcert found! using it to generate trusted certificates...')
  } else {
    console.log('mkcert not found, falling back to self-signed certificates...')
    console.log('to install mkcert:')
    console.log('  macOS: brew install mkcert')
    console.log('  Linux: apt install mkcert')
  }

  for (const site of sites) {
    if (site.force_ssl === 'true') {
      if (use_mkcert) {
        generate_mkcert(site.network_domain)
      } else {
        generate_self_signed(site.network_domain)
      }
    }
  }
}

if (require.main === module) {
  main()
}

module.exports = { generate_self_signed, generate_mkcert } 