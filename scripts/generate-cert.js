const fs=require('fs');
const path=require('path');
const selfsigned=require('selfsigned');

const dir=path.join(__dirname,'..','certs');
fs.mkdirSync(dir,{recursive:true});

const attrs=[{name:'commonName',value:'x.local'}];
const altNames=[
  {type:2,value:'x.local'},
  {type:2,value:'localhost'},
  {type:7,ip:'127.0.0.1'}
];
const pems=selfsigned.generate(attrs,{
  days:825,
  keySize:2048,
  algorithm:'sha256',
  extensions:[
    {name:'basicConstraints',cA:false},
    {name:'subjectAltName',altNames}
  ]
});
fs.writeFileSync(path.join(dir,'x.local-key.pem'),pems.private);
fs.writeFileSync(path.join(dir,'x.local-cert.pem'),pems.cert);
console.log('Created certs/x.local-cert.pem');
console.log('Important: the phone must trust this certificate/CA before getUserMedia can work over HTTPS.');
