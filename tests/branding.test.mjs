import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function png(buffer,w,h){
 assert.deepEqual(buffer.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));let offset=8;const data=[];let channels=0,ended=false;
 while(offset<buffer.length){const n=buffer.readUInt32BE(offset);const chunk=buffer.subarray(offset+4,offset+8+n);assert.equal(crc32(chunk),buffer.readUInt32BE(offset+8+n));const type=chunk.subarray(0,4).toString();
  if(type==='IHDR'){assert.equal(buffer.readUInt32BE(offset+8),w);assert.equal(buffer.readUInt32BE(offset+12),h);assert.equal(buffer[offset+16],8);channels=({2:3,6:4})[buffer[offset+17]];assert.ok(channels);assert.equal(buffer[offset+20],0);}
  if(type==='IDAT')data.push(buffer.subarray(offset+8,offset+8+n));if(type==='IEND')ended=true;offset+=12+n;
 }assert.ok(ended);const pixels=inflateSync(Buffer.concat(data));assert.equal(pixels.length,h*(1+w*channels));for(let row=0;row<h;row++)assert.ok(pixels[row*(1+w*channels)]<=4);return channels;
}
test('brand PNGs contain valid compressed raster data and exact requested dimensions',()=>{
 for(const n of [16,32,48,180,192,512])png(read(`public/brand/icon-${n}.png`),n,n);
 assert.equal(png(read('public/brand/maskable-512.png'),512,512),3,'maskable canvas must be opaque RGB');png(read('public/brand/social.png'),1200,630);
});
test('favicon ICO contains three independently valid 16/32/48 PNG images',()=>{
 const b=read('public/favicon.ico');assert.equal(b.readUInt16LE(0),0);assert.equal(b.readUInt16LE(2),1);assert.equal(b.readUInt16LE(4),3);
 const sizes=[];for(let i=0;i<3;i++){const o=6+16*i,w=b[o],h=b[o+1],length=b.readUInt32LE(o+8),start=b.readUInt32LE(o+12);sizes.push(w);assert.ok(start>=54&&start+length<=b.length);png(b.subarray(start,start+length),w,h);}assert.deepEqual(sizes,[16,32,48]);
});
test('manifest references existing assets, branding and a scoped root entry point',()=>{
 const m=JSON.parse(read('public/manifest.webmanifest'));assert.equal(m.name,'Galaxy Remote 2.0');assert.equal(m.short_name,'Galaxy Remote');assert.equal(m.scope,'/');assert.equal(m.start_url,'/');
 for(const icon of m.icons){assert.equal(icon.type,'image/png');const [w,h]=icon.sizes.split('x').map(Number);png(read('public'+icon.src),w,h);}assert.ok(m.icons.some(i=>i.purpose==='maskable'));
 assert.deepEqual(read('public/favicon.svg'),read('assets/brand/galaxy-remote-symbol.svg'));assert.deepEqual(read('public/brand/symbol.svg'),read('assets/brand/galaxy-remote-symbol.svg'));
});
test('Android XML parses, adaptive master paths match and package/display identities remain separate',()=>{
 const result=spawnSync('python3',['-c',`from pathlib import Path
import xml.etree.ElementTree as E
r=Path('android-client/app/src');a='{http://schemas.android.com/apk/res/android}'
for p in r.rglob('*.xml'): E.parse(p)
master=E.parse('assets/brand/galaxy-remote-symbol.svg').getroot();paths=[p.attrib['d'] for p in master.iter('{http://www.w3.org/2000/svg}path')]
for name in ('ic_brand_foreground','ic_brand_monochrome'):
 v=E.parse(r/'main/res/drawable'/f'{name}.xml').getroot();assert [p.attrib[a+'pathData'] for p in v.iter('path')]==paths
for v in (26,33):
 for name in ('ic_launcher','ic_launcher_round'):
  icon=E.parse(r/f'main/res/mipmap-anydpi-v{v}/{name}.xml').getroot();assert icon.tag=='adaptive-icon';assert icon.find('foreground') is not None;assert (icon.find('monochrome') is not None)==(v==33)
for variant,label in [('main','Galaxy Remote 2.0'),('panelTest','Galaxy Remote 2.0 Test')]:
 strings=E.parse(r/f'{variant}/res/values/strings.xml').getroot();assert strings.find("string[@name='app_name']").text==label
`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 for(const [density,n] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]])for(const variant of ['main','panelTest'])for(const icon of ['ic_launcher','ic_launcher_round'])png(read(`android-client/app/src/${variant}/res/mipmap-${density}/${icon}.png`),n,n);
 const gradle=read('android-client/app/build.gradle.kts').toString();assert.match(gradle,/applicationId = "com.galaxyremote.app"/);assert.match(gradle,/applicationIdSuffix = ".paneltest"/);
});
