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
  - no dependencies, just used to parse `sites.conf.json`
- `mkcert` (optional, for trusted certificates)

## installation
1. clone this repository
2. copy the example config:
   ```bash
   cp sites.conf.json.example sites.conf.json
   ```
3. edit `sites.conf.json` to define your sites:
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
4. install mkcert (optional, for trusted certificates):
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
whenever you change `sites.conf.json`, just run:
```bash
./reload.js
```

this will:
- validate your configuration
- generate nginx and dnsmasq configs
- create ssl certificates if needed
- restart the services
- test the configuration

### configuring network-wide dns
to use localroute as your network's dns server (like pihole):

#### unifi
1. login to your unifi controller
2. go to settings > networks
3. select your network
4. expand 'dhcp and dns'
5. set 'dns server 1' to 192.168.1.201
6. click 'apply changes'

#### openwrt
1. login to luci interface
2. go to network > dhcp/dns
3. set 'dns forwardings' to 192.168.1.201
4. restart dnsmasq service or reboot router

#### pfsense
1. login to web interface
2. go to services > dhcp server
3. select your lan interface
4. set 'dns servers' to 192.168.1.201
5. click 'save'
6. go to system > general setup
7. set 'dns servers' to 192.168.1.201 (to use it for the router itself)
8. click 'save'

#### mikrotik
1. login to winbox/webfig
2. go to ip > dhcp server
3. select your dhcp server
4. set 'dns servers' to 192.168.1.201
5. click 'apply'

#### generic router
1. login to your router's admin interface
2. look for dhcp/dns settings (usually under lan/network settings)
3. set primary dns server to 192.168.1.201
4. save changes and restart if needed

#### synology
1. login to dsm
2. open control panel
3. go to network > general
4. set primary dns to 192.168.1.201
5. click 'apply'

#### truenas
1. login to web interface
2. go to network > global configuration
3. set nameserver 1 to 192.168.1.201
4. click 'save'

note: after changing network-wide dns:
- some devices may need to renew their dhcp lease
- you can force this by disconnecting/reconnecting to the network
- or by running `ipconfig /release && ipconfig /renew` on windows
- or `sudo dhclient -r && sudo dhclient` on linux

### configuring clients to use your dns server
to use your localroute server (assuming it's running at 192.168.1.201):

#### linux (networkmanager)
1. gui method:
   - open network settings
   - select your network connection
   - click the gear icon to edit
   - go to the 'ipv4' tab
   - change dns method to 'manual'
   - add 192.168.1.201 as your dns server
   - click 'apply'

2. command line method:
   ```bash
   # edit your connection (replace 'Wired connection 1' with your connection name)
   nmcli con mod "Wired connection 1" ipv4.dns "192.168.1.201"
   nmcli con mod "Wired connection 1" ipv4.ignore-auto-dns yes
   
   # restart the connection
   nmcli con down "Wired connection 1"
   nmcli con up "Wired connection 1"
   ```

#### linux (systemd-resolved)
```bash
# edit /etc/systemd/resolved.conf
sudo tee /etc/systemd/resolved.conf << EOF
[Resolve]
DNS=192.168.1.201
EOF

# restart systemd-resolved
sudo systemctl restart systemd-resolved
```

#### macos
1. gui method:
   - open system preferences
   - click on network
   - select your active network connection
   - click 'advanced'
   - go to the 'dns' tab
   - click '+' and add 192.168.1.201
   - click 'ok' and then 'apply'

2. command line method:
   ```bash
   # get your network service (usually 'Wi-Fi' or 'Ethernet')
   networksetup -listallnetworkservices
   
   # set dns server (replace 'Wi-Fi' with your service name)
   sudo networksetup -setdnsservers "Wi-Fi" 192.168.1.201
   ```

#### windows
1. gui method:
   - open network & internet settings
   - click 'change adapter options'
   - right-click your connection and select 'properties'
   - select 'internet protocol version 4 (tcp/ipv4)'
   - click 'properties'
   - select 'use the following dns server addresses'
   - enter 192.168.1.201 as preferred dns server
   - click 'ok'

2. powershell method (run as administrator):
   ```powershell
   # get your network adapter name
   Get-NetAdapter
   
   # set dns server (replace 'Ethernet' with your adapter name)
   Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses "192.168.1.201"
   ```

### verifying dns setup
to verify your dns is working:
```bash
# test dns resolution
ping example.local
ping librechat.local

# check which dns server is being used
nslookup example.local
```

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

#### linux (networkmanager)
```bash
# reset to automatic dns (replace 'Wired connection 1' with your connection name)
nmcli con mod "Wired connection 1" ipv4.dns ""
nmcli con mod "Wired connection 1" ipv4.ignore-auto-dns no
nmcli con down "Wired connection 1"
nmcli con up "Wired connection 1"
```

#### linux (systemd-resolved)
```bash
# restore default resolved.conf
sudo rm /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
```

#### macos
```bash
# reset to automatic dns (replace 'Wi-Fi' with your service name)
sudo networksetup -setdnsservers "Wi-Fi" "empty"
```

#### windows (powershell as administrator)
```powershell
# reset to automatic dns (replace 'Ethernet' with your adapter name)
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ResetServerAddresses
```

## configuration
edit `sites.conf.json` to define your domains and upstream servers. each site can have:

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

## generated files
the following files are generated and should not be committed to git:
- `docker/nginx/nginx.conf`: generated nginx configuration
- `docker/dnsmasq/dnsmasq.conf`: generated dnsmasq configuration
- `ssl/`: directory containing generated certificates
- `sites.conf.json`: your local site configuration

## troubleshooting
1. dns not working:
   - check if port 53 is available
   - ensure your dns points to 192.168.1.201
   - try adding domains to /etc/hosts as fallback
   - check if your router or isp is blocking port 53
   - verify dnsmasq container is running: `docker-compose ps`

2. ssl certificate warnings:
   - install mkcert for trusted certificates
   - or click through the warnings for self-signed certs

3. upstream server not reachable:
   - verify the real_host ip and port in sites.conf.json
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
