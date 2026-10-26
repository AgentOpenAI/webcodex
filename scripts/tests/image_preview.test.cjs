'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {readFileSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const packageFile=process.env.WEBCODEX_IMAGE_TEST_PACKAGE||'/home/ubuntu/tools/image-tools/package.json';
const sharp=createRequire(packageFile)('sharp');
const code=readFileSync(new URL('../../src/tool_runtime/image_preview.cjs',`file://${__filename}`),'utf8');
const sha=data=>createHash('sha256').update(data).digest('hex');
function pixels(width,height,channels){
  const data=Buffer.alloc(width*height*channels);let state=123456789;
  for(let i=0;i<data.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;data[i]=state&255;}
  return data;
}
function run(input){return spawnSync(process.execPath,['--max-old-space-size=192','-e',code,packageFile],{input,env:{PATH:'/usr/bin:/bin',VIPS_CONCURRENCY:'1',MALLOC_ARENA_MAX:'2'},timeout:35000,maxBuffer:3*1024*1024});}
async function check(input){
  assert(input.length>4*1024*1024);
  const before=sha(input),result=run(input);
  assert.equal(result.status,0,String(result.stderr));assert.equal(sha(input),before);
  const boundary=result.stdout.indexOf(10),header=JSON.parse(result.stdout.subarray(0,boundary)),bytes=result.stdout.subarray(boundary+1);
  assert(bytes.length<=2*1024*1024);assert.equal(bytes.subarray(8,12).toString(),'WEBP');
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,header.width);assert.equal(metadata.height,header.height);
  assert(metadata.width<=2048&&metadata.height<=2048);
  return {bytes,header,metadata};
}
test('large transparent PNG becomes bounded WebP; original bytes and alpha remain',async()=>{
  const raw=pixels(1500,1000,4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)raw[(y*1500+x)*4+3]=0;
  const input=await sharp(raw,{raw:{width:1500,height:1000,channels:4}}).png({compressionLevel:0}).toBuffer();
  const {bytes,metadata}=await check(input);assert.equal(metadata.hasAlpha,true);
  const {data}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(data[3],0);
});
test('large EXIF rotated JPEG preview applies orientation without changing source',async()=>{
  const input=await sharp(pixels(1000,1500,3),{raw:{width:1000,height:1500,channels:3}}).withMetadata({orientation:6}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
  const {metadata}=await check(input);assert.equal(metadata.width,1500);assert.equal(metadata.height,1000);
});
test('large lossless WebP becomes a bounded independently decodable preview',async()=>{
  const input=await sharp(pixels(1500,1000,4),{raw:{width:1500,height:1000,channels:4}}).webp({lossless:true}).toBuffer();
  await check(input);
});
test('SVG external references, truncated images, fake MIME and oversized dimensions fail safely',()=>{
  const fakePng=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(fakePng);fakePng.writeUInt32BE(13,8);fakePng.write('IHDR',12);fakePng.writeUInt32BE(100000,16);fakePng.writeUInt32BE(100000,20);
  for(const input of [Buffer.from('<svg><image href="file:///etc/passwd"/></svg>'),Buffer.from('not an image'),Buffer.from([255,216,255,0,0,0,0,0,0,0,0,0]),fakePng]){
    const result=run(input);assert.notEqual(result.status,0);assert.equal(result.stdout.length,0);assert.equal(String(result.stderr),'Image preview processing failed\n');
  }
});
