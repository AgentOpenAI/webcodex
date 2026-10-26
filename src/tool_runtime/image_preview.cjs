'use strict';
// Fixed stdin/stdout processor. No source paths, URLs, environment config or
// credential access; the Rust owner supplies only previously authorized bytes.
const {createRequire} = require('node:module');
const sharp = createRequire(process.argv[1])('sharp');
sharp.cache(false);
sharp.concurrency(1);
const MAX_SOURCE=64*1024*1024, MAX_OUTPUT=2*1024*1024;
const png=data=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
const jpeg=data=>data[0]===255&&data[1]===216&&data[2]===255;
const webp=data=>data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
async function main(){
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_SOURCE)throw new Error('input limit');chunks.push(chunk);}
  const data=Buffer.concat(chunks);
  if(data.length<12||!(png(data)||jpeg(data)||webp(data)))throw new Error('unsupported input');
  const options={limitInputPixels:67108864,limitInputChannels:4,failOn:'warning',animated:false,pages:1};
  const metadata=await sharp(data,options).metadata();
  if(!['png','jpeg','webp'].includes(metadata.format))throw new Error('unsupported format');
  for(const [edge,quality] of [[2048,85],[2048,65],[1536,65],[1024,60]]){
    const {data:output,info}=await sharp(data,options).autoOrient()
      .resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true})
      .webp({quality,alphaQuality:100,effort:3}).timeout({seconds:12})
      .toBuffer({resolveWithObject:true});
    if(output.length<=MAX_OUTPUT){
      process.stdout.write(JSON.stringify({width:info.width,height:info.height,static_frame:(metadata.pages||1)>1})+'\n');
      process.stdout.write(output);return;
    }
  }
  throw new Error('output limit');
}
main().catch(()=>{process.stderr.write('Image preview processing failed\n');process.exitCode=1;});
