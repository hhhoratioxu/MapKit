import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { Resources } from '@nsringo/mapkit';
const base = 'https://gspe35-ssl.ls.apple.com';
async function run(name, request, response, argument={}, store={}) {
 let calls=0, result;
 const context={URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,btoa,atob,setTimeout,clearTimeout,console:{log(){},info(){},debug(){},warn(){},error(){}},$loon:'Mac 26.0 3.5.1', $script:{startTime:Date.now()},$request:request,$response:response,$argument:argument,$persistentStore:{read:k=>store[k]??null,write:(v,k)=>(store[k]=v,true)},$httpClient:{get:(r,cb)=>cb(null,{status:503,headers:{}},new Uint8Array())},$done:r=>{calls++;result=r;}};
 vm.runInNewContext(fs.readFileSync(`Loon/script/${name}.bundle.js`,'utf8'),context);
 for(let i=0;i<30&&!calls;i++) await new Promise(r=>setTimeout(r,5));
 assert.equal(calls,1,'exactly one completion');
 return result;
}
test('native Loon compiled request preserves flat argument choices and fails open on supplemental fetch failure',async()=>{
 const result=await run('request',{url:base+'/geo_manifest/dynamic/config?country_code=CN&os=macos',method:'GET',headers:{}},null,{CountryCode:'JP'});
 assert.equal(new URL(result.url).searchParams.get('country_code'),'JP');
 const ann=await run('request',{url:base+'/config/announcements?environment=prod-cn',method:'GET',headers:{}},null,{Environment:'XX'});
 assert.equal(new URL(ann.url).searchParams.get('environment'),'prod');
});
test('compiled manifest response applies both fixes through Loon binary interface',async()=>{
 const target=Resources.create({urlInfoSet:[{dataSet:1,dispatcherURL:{url:'https://target1.example'}},{dataSet:2,dispatcherURL:{url:'https://target2.example'}}]});
 const source=Resources.create({urlInfoSet:[{dataSet:2},{dataSet:1}]});
 const store={iRingo:JSON.stringify({MapKit:{Caches:{'?country_code=CN&os=macos':{eTag:'test',base64:Buffer.from(Resources.toBinary(source)).toString('base64')}}}})};
 const result=await run('response',{url:base+'/geo_manifest/dynamic/config?country_code=US&os=macos',method:'GET',headers:{}},{status:200,headers:{'Content-Type':'application/octet-stream'},body:Resources.toBinary(target)},{Dispatcher:'AutoNavi'},store);
 const decoded=Resources.fromBinary(result.body);
 assert.deepEqual(decoded.urlInfoSet.map(x=>[x.dataSet,x.dispatcherURL.url]),[[1,'https://target1.example'],[2,'https://target2.example']]);
});
test('compiled defaults and malformed protobuf fail open',async()=>{
 const result=await run('response',{url:base+'/geo_manifest/dynamic/config?country_code=US',method:'GET',headers:{}},{status:200,headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array([255])});
 assert.equal(Object.keys(result).length,0);
 const defaults=await run('defaults',{url:'https://configuration.ls.apple.com/config/defaults',method:'GET',headers:{}},{status:200,headers:{'Content-Type':'application/xml'},body:'<plist><dict/></plist>'});
 assert.equal(Object.keys(defaults).length,0);
});
