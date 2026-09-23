const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT || 7777);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..', 'web');
const CERT_DIR = path.join(__dirname, '..', 'certs');

app.use(express.static(ROOT));
app.get('/health', (_req,res) => res.json({ok:true, service:'x.local-camera'}));

function lanAddresses() {
  const out=[];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

function start() {
  const key=path.join(CERT_DIR,'x.local-key.pem');
  const cert=path.join(CERT_DIR,'x.local-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    console.error('Missing TLS certificate. Run: npm run cert:generate');
    process.exit(1);
  }
  const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},app);
  server.listen(PORT,HOST,()=>{
    console.log('x.local camera server');
    console.log('LAN addresses:');
    for (const ip of lanAddresses()) console.log('  https://'+ip+':'+PORT);
    console.log('Hostname target: https://x.local:'+PORT);
  });
}
start();
