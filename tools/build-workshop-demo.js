// Builds web/workshop/demo-data.js — anonymised demo bike for the Workshop UI.
// Source: a real BES3 Reader export; every identifier is replaced, values kept.
const fs = require('fs');
const reg = require('../src/address-registry.json').addresses;
const MT = require('../src/messageTypes.js');
const P = require('../src/protocol.js');
const src = process.argv[2];
const rep = JSON.parse(fs.readFileSync(src, 'utf8')).results;
const ANON = {
  'DriveUnit.SERIAL_NUMBER': 'DEMO-SERIAL-DU-0001', 'Battery.SERIAL_NUMBER': 'DEMO-SERIAL-BAT-0002',
  'RemoteControl.SERIAL_NUMBER': 'DEMO-SERIAL-RC-0003', 'DriveUnit.OEM_BIKE_ID': 'DEMO-BIKE-0001',
  'DriveUnit.OEM_BIKE_MODEL_ID': '0000000000001', 'DriveUnit.BATTERY_KEY_LOCK_NUMBER': 'M000002',
  'DriveUnit.BIKE_ID': '00000000-0000-4000-8000-000000000001', 'DriveUnit.OEM_BRAND_NAME': 'Demo Bikes',
};
function varint(n){const o=[];let v=Math.floor(n);while(v>=0x80){o.push((v%0x80)|0x80);v=Math.floor(v/0x80);}o.push(v);return o;}
const str = (s) => { const b=[...Buffer.from(s,'utf8')]; return [0x0a,b.length,...b]; };
const payloads = {};
const keys = new Set();
const plan = fs.readFileSync('web/workshop/engine.js','utf8').match(/const READ_PLAN = \{([\s\S]*?)\n  \};/)[1];
for (const m of plan.matchAll(/(\w+): \[([^\]]*)\]/g)) for (const n of m[2].match(/'(\w+)'/g)) keys.add(`${m[1]}.${n.replace(/'/g,'')}`);
for (const key of keys) {
  const [c,n]=key.split('.'); const e=reg.find(a=>a.component===c&&a.name===n); if(!e) continue;
  const r=rep.find(x=>x.component===c&&x.name===n); if(!r||r.status!=='ok') continue;
  const meta=MT.FIELD_TYPES[e.address]; let p=null; const val = ANON[key] !== undefined ? ANON[key] : r.rawValue;
  const hexm = typeof r.value==='string' && r.value.match(/hex: ((?:[0-9a-f]{2} ?)+)/i);
  if (meta) {
    switch(meta.kind){
      case 'string': p=str(String(val)); break;
      case 'uint': p=val?[8,...varint(val)]:[]; break;
      case 'normFactor': { let raw=Math.round(val*meta.factor); if(meta.signed) raw = raw>=0?raw*2:(-raw*2-1); p=raw?[8,...varint(raw)]:[]; break; }
      case 'bool': p=val?[8,1]:[]; break;
      case 'enum': { const k=Object.keys(meta.enumTable).find(k=>meta.enumTable[k].name===val); p=+k?[8,...varint(+k)]:[]; break; }
      case 'uuid': { const b=[...Buffer.from(val.replace(/-/g,''),'hex')]; p=[0x0a,18,0x0a,16,...b]; break; }
      case 'unixTimestamp': p=[8,...varint(val*2)]; break;
      case 'serviceDue': p=[]; break;
      case 'tuningDetection': p=[]; break;
      case 'assistModeColors': { const vs=val.map(c=>((c.r<<24)>>>0)+(c.g<<16)+(c.b<<8)+c.a); const inner=vs.flatMap(v=>varint(v)); p=[0x0a,inner.length,...inner]; break; }
    }
  } else if (hexm) p = hexm[1].trim().split(/\s+/).map(h=>parseInt(h,16));
  else if (n==='ASSIST_MODE_SHORT_NAMES') p=['OFF','ECO','TOUR+','eMTB+',''].flatMap(s=>str(s));
  else if (typeof val==='string') p=str(val);
  else if (r.value==='(empty)') p=[];
  else if (n==='BIKE_LIGHT_CONFIGURATION') p=[8,2];
  if (p===null) { console.error('SKIP',key,r.value); continue; }
  // verify
  const t=MT.decodeTyped(e.address,p); const d=t?t.display:P.decodeValue(p).display;
  const expect = ANON[key] !== undefined ? ANON[key] : r.value;
  if (meta && meta.kind!=='serviceDue' && meta.kind!=='tuningDetection' && d!==expect && !ANON[key]) console.error('MISMATCH',key,JSON.stringify(d),'vs',JSON.stringify(expect));
  payloads[e.address]=p;
}
// Demo bike starts with light NOT enabled, so the writer flow can be tried.
const A=(c,n)=>reg.find(a=>a.component===c&&a.name===n).address;
payloads[A('DriveUnit','BIKE_LIGHT_AVAILABLE')]=[]; payloads[A('DriveUnit','BIKE_LIGHT')]=[];
payloads[A('DriveUnit','BIKE_LIGHT_CONFIGURATION')]=[]; payloads[A('DriveUnit','BIKE_LIGHT_POWER')]=[8,10];
payloads[A('RemoteControl','SERVICE_DUE')]=[];
payloads[A('RemoteControl','BIKE_ID')]=payloads[A('DriveUnit','BIKE_ID')];
payloads[A('RemoteControl','BLE_CENTRAL_DATABASE')]=[];
payloads[A('RemoteControl','DEVICE_DATABASE')]=[];
// Full list from the matching debug log (the JSON export truncates long hex values).
payloads[A('DriveUnit','ACTIVE_ASSIST_MODES')]='0a 0c 0a 0a 41 31 30 30 4d 30 30 30 34 30 0a 0c 0a 0a 41 31 30 30 4d 41 41 41 41 30 0a 0c 0a 0a 41 31 30 30 4d 53 50 49 43 37 0a 00'.split(' ').map(h=>parseInt(h,16));
const rpc = {
  stats: { '0':'0a 03 08 fd 5b', 'A100M00040':'0a 07 08 a2 99 06 10 e8 02', 'A100MAAAA0':'0a 07 08 96 e4 1b 10 f2 15', 'A100MSPIC7':'0a 07 08 e9 e1 08 10 c3 0e' },
  udam: { 'A100M00040':'08 64 10 55 18 64 20 c4 13 28 d8 04', 'A100MAAAA0':'08 64 10 55 18 64 20 c4 13 28 d8 04', 'A100MSPIC7':'08 96 01 10 55 18 64 20 c4 13 28 d8 04' },
};
const hexed = Object.fromEntries(Object.entries(payloads).map(([k,v])=>[k, P.toHex(v)]));
const writable = ['BIKE_LIGHT','BIKE_LIGHT_AVAILABLE','BIKE_LIGHT_CONFIGURATION','BIKE_LIGHT_POWER'].map(n=>A('DriveUnit',n)).concat([A('RemoteControl','SERVICE_DUE'),A('RemoteControl','BIKE_ID'),A('DriveUnit','BIKE_ID')]);
fs.writeFileSync('web/workshop/demo-data.js', '// Generated by tools/build-workshop-demo.js — anonymised demo bike, no real identifiers.\nwindow.Bes3WorkshopDemoData = ' + JSON.stringify({ payloads: hexed, rpc, writable }, null, 1) + ';\n');
console.log('wrote', Object.keys(hexed).length, 'payloads');
