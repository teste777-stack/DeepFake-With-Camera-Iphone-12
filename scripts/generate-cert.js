const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const os = require('os');

const out = path.join(__dirname, '..', 'certs');
fs.mkdirSync(out, { recursive: true });

const caKeyPath = path.join(out, 'x-local-ca-key.pem');
const caCertPath = path.join(out, 'x-local-ca.pem');
const keyPath = path.join(out, 'x.local-key.pem');
const certPath = path.join(out, 'x.local-cert.pem');

function write(p, data) { fs.writeFileSync(p, data, 'utf8'); }

function createCa() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 1000 * 86400 * 825);
  const attrs = [
    { name: 'commonName', value: 'x.local Camera Local CA' },
    { name: 'organizationName', value: 'x.local Camera' }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  write(caKeyPath, forge.pki.privateKeyToPem(keys.privateKey));
  write(caCertPath, forge.pki.certificateToPem(cert));
  return { keys, cert };
}

function createServerCert(ca) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02' + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 1000 * 86400 * 825);
  cert.setSubject([
    { name: 'commonName', value: 'x.local' },
    { name: 'organizationName', value: 'x.local Camera' }
  ]);
  cert.setIssuer(ca.cert.subject.attributes);
  const lanIps = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) lanIps.push(item.address);
    }
  }
  const altNames = [
    { type: 2, value: 'x.local' },
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanIps.map(ip => ({ type: 7, ip }))
  ];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, critical: true },
    { name: 'subjectAltName', altNames }
  ]);
  cert.sign(ca.keys.privateKey, forge.md.sha256.create());
  write(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
  write(certPath, forge.pki.certificateToPem(cert));
}

let ca;
if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
  ca = {
    keys: { privateKey: forge.pki.privateKeyFromPem(fs.readFileSync(caKeyPath, 'utf8')) },
    cert: forge.pki.certificateFromPem(fs.readFileSync(caCertPath, 'utf8'))
  };
} else {
  ca = createCa();
}
createServerCert(ca);

console.log('TLS local criado.');
console.log('CA para instalar no iPhone:', caCertPath);
console.log('Servidor:', certPath);
console.log('');
console.log('No iPhone: abra https://x.local:7777/ca.crt e instale/confie no perfil.');
