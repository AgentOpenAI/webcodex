// Native Chromium acceptance for the multi-image App. All fixtures and artifacts
// belong to this run and are removed in finally; no logged-in profile is used.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require=createRequire(process.env.WEBCODEX_PLAYWRIGHT_PACKAGE||'/home/ubuntu/tools/browser-tools/package.json');
const {chromium}=require('@playwright/test');
const html=readFileSync(new URL('../../src/mcp_image_app.html',import.meta.url),'utf8');
new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
const output=mkdtempSync(join(tmpdir(),'webcodex-gallery-ui-'));
const table=Array.from({length:256},(_,i)=>{let n=i;for(let b=0;b<8;b++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
function pngChunk(type,bytes){const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([name,bytes])));return Buffer.concat([length,name,bytes,checksum]);}
function png(width,height,color,padding=0){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  const stride=width*3+1,row=Buffer.alloc(stride);for(let x=0;x<width;x++)for(let c=0;c<3;c++)row[1+x*3+c]=color[c];
  const pixels=Buffer.alloc(height*stride);for(let y=0;y<height;y++)row.copy(pixels,y*stride);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),...(padding?[pngChunk('tEXt',Buffer.from('fixture\0'+'x'.repeat(padding)))]:[]),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
}
const red=png(96,64,[210,20,30]),green=png(120,80,[10,150,70],600000);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=(path,bytes=red)=>({project:'agent:fixture:images',path,name:path.split('/').at(-1),bytes:bytes.length,sha256:sha(bytes),mime_type:'image/png'});
const entries=(count=2)=>Array.from({length:count},(_,index)=>({image_document:identity(`image-${index}.png`,index===1?green:red)}));
const fixtures=Object.fromEntries(Array.from({length:20},(_,index)=>[`image-${index}.png`,{identity:identity(`image-${index}.png`,index===1?green:red),encoded:(index===1?green:red).toString('base64')}]).concat([['fresh.png',{identity:identity('fresh.png'),encoded:red.toString('base64')}]]));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/app'?html:'<style>body{margin:0}iframe{display:block;width:100%;height:1200px;border:0}</style><iframe src="/app"></iframe>');});
let browser;
let passed=0;
const reports=[];
async function open({width=800,selected=entries(),success=true,single=false,envelope='structured',modes={},delay=0,holdDecode=false,holdCanvas=false,clock=false}={}){
  const page=await browser.newPage({viewport:{width,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()}`);});
  if(clock)await page.clock.install();
  await page.addInitScript(({fixtures,selected,success,single,envelope,modes,delay,holdDecode,holdCanvas})=>{
    if(window!==window.top){
      window.liveBlobUrls=new Set();
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=blob=>{const value=create(blob);window.liveBlobUrls.add(value);return value;};
      URL.revokeObjectURL=value=>{window.liveBlobUrls.delete(value);return revoke(value);};
      window.decodeReleases=[];window.canvasReleases=[];window.decodeCalls=0;
      const originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){window.decodeCalls++;return originalDecode.call(this);};
      if(holdCanvas){const toBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){return toBlob.call(this,blob=>window.canvasReleases.push(()=>callback(blob)),...args);};}
      if(holdDecode){const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return decode.call(this).then(()=>new Promise(resolve=>window.decodeReleases.push(resolve)));};}
      return;
    }
    window.testState={reads:[],modes:{...modes},delay,held:[],active:0,maxActive:0,cancelled:[],violations:[]};
    const frame=()=>document.querySelector('iframe');
    const wrap=(canonical,chunk)=>{
      let result;
      if(envelope==='text')result={content:[{type:'text',text:JSON.stringify(canonical)}]};
      else if(envelope==='private'||envelope==='wrapped')result={structuredContent:{success:true,output:{}},_meta:{'webcodex/imageDocument':canonical}};
      else result={structuredContent:canonical};
      if(chunk){result.content=[{type:'text',text:JSON.stringify(canonical)}];result._meta={'webcodex/artifactChunk':chunk};if(envelope==='private'||envelope==='wrapped')result.structuredContent={success:true,output:{artifact_chunk:{byte_offset:999}}};}
      return envelope==='wrapped'?{mcp_tool_result:result}:result;
    };
    window.showGallery=(next,nextSuccess=true)=>{
      const canonical={success:nextSuccess,output:{image_gallery:next}};
      frame().contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:wrap(canonical)},'*');
    };
    window.releaseHeld=()=>{const held=window.testState.held.splice(0);for(const release of held)release();};
    window.teardownGallery=id=>frame().contentWindow.postMessage({jsonrpc:'2.0',id,method:'ui/resource-teardown'},'*');
    addEventListener('message',event=>{
      const request=event.data,state=window.testState;if(!frame()||event.source!==frame().contentWindow||request?.jsonrpc!=='2.0')return;
      if(request.method==='notifications/cancelled'){state.cancelled.push(request.params.requestId);return;}
      if(request.method==='ui/notifications/size-changed'){frame().style.height=`${request.params.height}px`;return;}
      if(request.method===undefined){if(request.id==='teardown')state.teardownAck=true;return;}
      if(request.id===undefined)return;
      const reply=result=>frame().contentWindow.postMessage({jsonrpc:'2.0',id:request.id,result},'*');
      if(request.method==='ui/initialize'){
        // Deliver metadata before initialization completes, matching Host replay.
        const canonical={success,output:single?{image_document:selected[0].image_document}:{image_gallery:selected}};
        frame().contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:wrap(canonical)},'*');
        reply({protocolVersion:'2026-01-26',hostCapabilities:{}});return;
      }
      if(request.method!=='tools/call'){reply({});return;}
      const a=request.params.arguments,fixture=fixtures[a.path];state.reads.push(a);state.active++;state.maxActive=Math.max(state.maxActive,state.active);
      if(!fixture){state.violations.push('Unknown selected path');state.active--;reply({isError:true,structuredContent:{success:false,error:'missing fixture'}});return;}
      if(request.params.name!=='read_app_artifact_chunk'||a.project!==fixture.identity.project||a.sha256!==fixture.identity.sha256||a.bytes!==fixture.identity.bytes||'content_base64' in a)state.violations.push('Unfenced image request');
      const variant=a.image_preview?fixture.preview:fixture;
      if(a.image_preview&&(!variant||a.image_preview.sha256!==variant.identity.sha256||a.image_preview.bytes!==variant.identity.bytes))state.violations.push('Wrong preview selection');
      const mode=state.modes[a.path];
      const send=()=>{
        state.active--;
        if(mode==='stale'){reply({isError:true,structuredContent:{success:false,error:'snapshot_changed'}});return;}
        const bytes=Uint8Array.from(atob(variant.encoded),c=>c.charCodeAt(0)),end=Math.min(bytes.length,a.byte_offset+512*1024),chunk=bytes.slice(a.byte_offset,end);
        if(mode==='corrupt'&&chunk.length)chunk[0]^=1;
        const parts=[];for(let i=0;i<chunk.length;i+=32768)parts.push(String.fromCharCode(...chunk.subarray(i,i+32768)));
        const artifact={project:a.project,path:a.path,sha256:variant.identity.sha256,bytes_total:bytes.length,byte_offset:mode==='wrongOffset'?a.byte_offset+1:a.byte_offset,next_byte_offset:end===bytes.length?null:end,complete:end===bytes.length};
        const canonical={success:true,output:{artifact_chunk:artifact}};
        const encoded=btoa(parts.join(''));reply(wrap(canonical,{content_base64:encoded}));
      };
      if(mode==='held')state.held.push(send);else if(state.delay)setTimeout(send,state.delay);else send();
    });
  },{fixtures,selected,success,single,envelope,modes,delay,holdDecode,holdCanvas});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const card=page.frameLocator('iframe');
  return {page,card,errors,frame:()=>page.frames().find(frame=>frame.url().endsWith('/app'))};
}
async function ready(context,count){await context.card.locator(`article[data-state="ready"]`).nth(count-1).waitFor();assert.equal(await context.card.locator('article[data-state="ready"]').count(),count);}
async function finish(context,name){
  assert.deepEqual(context.errors,[]);
  const state=await context.page.evaluate(()=>({violations:testState.violations,maxActive:testState.maxActive}));assert.deepEqual(state.violations,[]);assert(state.maxActive<=2,`${name}: concurrent image reads exceeded two`);
  await context.page.close();passed++;reports.push(name);
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
  for(const width of [800,390]){
    const c=await open({width,envelope:width===390?'private':'structured'});await ready(c,2);
    assert.equal(await c.card.locator('article').count(),2);assert.match(await c.card.locator('#summary').textContent(),/共 2 张 · 已显示 2 张/);
    assert.equal(await c.card.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1),true);
    for(let index=0;index<2;index++){
      const item=c.card.locator('article').nth(index);await item.getByRole('button',{name:'原始尺寸',exact:true}).click();assert(await item.locator('img').evaluate(image=>image.classList.contains('actual')));await item.getByRole('button',{name:'适应宽度',exact:true}).click();
    }
    assert((await c.page.evaluate(()=>testState.reads)).filter(read=>read.path==='image-1.png').length>=2,'Chunked second image was not fully read');
    await c.page.screenshot({path:join(output,`gallery-${width}.png`),fullPage:true});await finish(c,`two images and per-image sizing ${width}px`);
  }
  for(const envelope of ['text','wrapped']){const c=await open({envelope});await ready(c,2);await finish(c,`${envelope} Host envelope`);}
  {
    const c=await open({single:true,selected:entries(1)});await ready(c,1);assert.equal(await c.card.locator('#image').evaluate(image=>image.naturalWidth),96);await finish(c,'legacy single image_document');
  }
  {
    const selected=entries(16);const c=await open({selected,delay:10});await ready(c,16);assert.equal(await c.card.locator('article').count(),16);assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),16);await finish(c,'sixteen ordered images including identical contents at distinct paths');
  }
  for(const [name,selected] of [
    ['empty gallery',[]],['seventeen images',entries(17)],
    ['duplicate normalized paths',[entries(1)[0],{image_document:{...identity('./image-0.png')}}]],
    ['total size > 32 MiB',entries(9).map(entry=>({image_document:{...entry.image_document,bytes:4*1024*1024}}))],
    ['single size > 4 MiB',[{image_document:{...identity('image-0.png'),bytes:4*1024*1024+1}}]],
    ['mixed Project identities',[entries(1)[0],{image_document:{...identity('image-1.png',green),project:'agent:other:images'}}]],
  ]){
    const c=await open({selected});await c.card.locator('#gallery-status:not([hidden])').waitFor();await c.page.waitForTimeout(30);assert.equal(await c.card.locator('article').count(),0);assert.equal(await c.page.evaluate(()=>testState.reads.length),0);await finish(c,`${name} rejected before reads`);
  }
  {
    const selected=[...entries(),{path:'missing.png',error_kind:'not_found',message:'图片不存在 <img src=x onerror="window.injected=true">'}];
    const c=await open({selected,modes:{'image-1.png':'corrupt'}});await ready(c,1);await c.card.locator('article[data-state="error"]').nth(1).waitFor();
    const firstUrl=await c.card.locator('article').nth(0).locator('img').getAttribute('src');const before=await c.page.evaluate(()=>testState.reads.length);
    await c.page.evaluate(()=>{testState.modes['image-1.png']='valid';});await c.card.locator('article').nth(1).getByRole('button',{name:'重试',exact:true}).click();await ready(c,2);
    assert.equal(await c.card.locator('article').nth(0).locator('img').getAttribute('src'),firstUrl);
    assert.equal(await c.card.locator('article').nth(2).locator('img').isVisible(),false);
    assert.equal(await c.frame().evaluate(()=>window.injected),undefined);
    const added=await c.page.evaluate(before=>testState.reads.slice(before),before);assert(added.length>0&&added.every(read=>read.path==='image-1.png'));
    assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),2);await finish(c,'one corrupted image retries independently; metadata failure remains visible and escaped');
  }
  {
    const c=await open({modes:{'image-1.png':'stale'}});await ready(c,1);await c.card.locator('article').nth(1).locator('.item-status').filter({hasText:'图片读取失败或文件已变化'}).waitFor();assert.equal(await c.card.locator('article').nth(0).locator('img').isVisible(),true);await finish(c,'stale file cannot remove successful sibling');
  }
  {
    const c=await open({modes:{'image-1.png':'wrongOffset'}});await ready(c,1);await c.card.locator('article').nth(1).locator('.item-status').filter({hasText:'图片分块校验失败'}).waitFor();await finish(c,'wrong chunk continuation fails only that image');
  }
  {
    const selected=[{path:'one.png',error_kind:'missing',message:'第一张不可用'},{path:'two.png',error_kind:'missing',message:'第二张不可用'}];
    const c=await open({selected,success:false});await c.card.locator('article[data-state="error"]').nth(1).waitFor();assert.match(await c.card.locator('#summary').textContent(),/共 2 张 · 已显示 0 张 · 失败 2 张/);assert.equal(await c.page.evaluate(()=>testState.reads.length),0);await finish(c,'all failed metadata entries stay visible with success=false');
  }
  {
    const c=await open({modes:{'image-0.png':'held','image-1.png':'held'}});await c.page.waitForFunction(()=>testState.held.length===2);
    await c.page.evaluate(fresh=>window.showGallery([{image_document:fresh}]),identity('fresh.png'));await c.page.waitForTimeout(40);assert.equal(await c.page.evaluate(()=>testState.reads.length),2,'Cancelled in-flight RPC slots were released before draining');
    await c.page.evaluate(()=>window.releaseHeld());await ready(c,1);assert.equal(await c.card.locator('article').count(),1);assert.equal(await c.card.locator('.filename').textContent(),'fresh.png');assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),1);await finish(c,'replacement drains old RPCs and fences delayed responses');
  }
  {
    const c=await open({selected:entries(1),holdDecode:true});await c.frame().waitForFunction(()=>decodeReleases.length===1);
    await c.page.evaluate(fresh=>window.showGallery([{image_document:fresh}]),identity('fresh.png'));
    await c.frame().waitForFunction(()=>decodeReleases.length===2);
    await c.frame().evaluate(()=>decodeReleases[1]());await ready(c,1);await c.frame().evaluate(()=>decodeReleases[0]());await c.page.waitForTimeout(30);
    assert.equal(await c.card.locator('article').count(),1);assert.equal(await c.card.locator('.filename').textContent(),'fresh.png');assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),1);await finish(c,'replacement cancels suspended decode and rejects its late completion');
  }
  {
    const c=await open();await ready(c,2);await c.page.evaluate(()=>window.teardownGallery('teardown'));await c.page.waitForFunction(()=>testState.teardownAck===true);assert.equal(await c.card.locator('article').count(),0);assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),0);
    const reads=await c.page.evaluate(()=>testState.reads.length);await c.page.evaluate(next=>window.showGallery(next),entries());await c.page.waitForTimeout(30);assert.equal(await c.page.evaluate(()=>testState.reads.length),reads);await finish(c,'teardown revokes blobs, acknowledges and ignores late tool results');
  }
  {
    const c=await open({selected:entries(3),modes:{'image-0.png':'held','image-1.png':'held'},clock:true});await c.page.waitForFunction(()=>testState.held.length===2);await c.page.clock.fastForward(180001);await c.card.locator('article[data-state="error"]').nth(2).waitFor();assert.match(await c.card.locator('#summary').textContent(),/失败 3 张/);await finish(c,'timeouts show errors for in-flight and queued images');
  }
  {
    const c=await open({modes:{'image-0.png':'held','image-1.png':'held'}});await c.page.waitForFunction(()=>testState.held.length===2);
    await c.page.evaluate(next=>{window.showGallery(next);window.showGallery(next);testState.modes={};},entries());
    await c.page.waitForTimeout(30);assert.equal(await c.page.evaluate(()=>testState.reads.length),2);
    await c.page.evaluate(()=>window.releaseHeld());await ready(c,2);assert.equal(await c.card.locator('article').count(),2);assert.equal(await c.frame().evaluate(()=>liveBlobUrls.size),2);
    assert.equal(await c.page.evaluate(()=>testState.cancelled.length),2);await finish(c,'repeated same gallery result stays bounded without duplicate cards');
  }
  {
    const bytes=png(16385,1,[20,30,40]);fixtures['wide.png']={identity:identity('wide.png',bytes),encoded:bytes.toString('base64')};
    const c=await open({selected:[{image_document:fixtures['wide.png'].identity},entries(1)[0]]});await ready(c,2);
    const first=c.card.locator('article').nth(0);assert.match(await first.locator('.details').textContent(),/压缩静态预览/);
    assert(await first.locator('img').evaluate(image=>image.naturalWidth<=2048));
    await finish(c,'wide low-byte original fits automatically as a bounded static preview');
  }
  {
    const bytes=png(6000,6000,[50,60,70]);for(const path of ['large-a.png','large-b.png'])fixtures[path]={identity:identity(path,bytes),encoded:bytes.toString('base64')};
    const selected=['large-a.png','large-b.png'].map(path=>({image_document:fixtures[path].identity}));const c=await open({selected});await ready(c,2);
    assert.equal(await c.card.locator('article[data-state="error"]').count(),0);
    assert(await c.card.locator('img').evaluateAll(images=>images.reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight,0)<=67108864));
    assert((await c.card.locator('.details').allTextContents()).every(text=>text.includes('压缩静态预览')));
    await finish(c,'two high-pixel small originals both fit the unchanged total pixel budget');
    const held=await open({selected,holdCanvas:true});await held.frame().waitForFunction(()=>canvasReleases.length===2);
    await held.page.evaluate(fresh=>window.showGallery([{image_document:fresh}]),identity('fresh.png'));await held.page.waitForTimeout(40);
    assert.equal(await held.page.evaluate(()=>testState.reads.length),2,'In-flight encoders must drain before releasing load slots');
    await held.frame().evaluate(()=>{for(const release of canvasReleases.splice(0))release();});await ready(held,1);
    assert.equal(await held.card.locator('.filename').textContent(),'fresh.png');assert.equal(await held.frame().evaluate(()=>liveBlobUrls.size),1);
    await finish(held,'replacement fences delayed canvas callbacks and retains encoding slots until drain');
  }
  {
    const pngBomb=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(pngBomb);pngBomb.writeUInt32BE(13,8);pngBomb.write('IHDR',12);pngBomb.writeUInt32BE(9000,16);pngBomb.writeUInt32BE(9000,20);
    const jpegBomb=Buffer.alloc(21);Buffer.from([255,216,255,192,0,17,8]).copy(jpegBomb);jpegBomb.writeUInt16BE(9000,7);jpegBomb.writeUInt16BE(9000,9);
    const webpBomb=Buffer.alloc(30);webpBomb.write('RIFF');webpBomb.writeUInt32LE(22,4);webpBomb.write('WEBPVP8X',8);webpBomb.writeUInt32LE(10,16);webpBomb.writeUIntLE(8999,24,3);webpBomb.writeUIntLE(8999,27,3);
    for(const [bytes,path,mime] of [[pngBomb,'bomb.png','image/png'],[jpegBomb,'bomb.jpg','image/jpeg'],[webpBomb,'bomb.webp','image/webp']]){
      fixtures[path]={identity:{...identity(path,bytes),mime_type:mime},encoded:bytes.toString('base64')};
      const c=await open({selected:[{image_document:fixtures[path].identity}]});await c.card.locator('article[data-state="error"]').waitFor();
      assert.equal(await c.frame().evaluate(()=>decodeCalls),0);await finish(c,`excessive declared ${mime} input pixels fail before browser decode`);
    }
  }
  {
    const sharp=createRequire(process.env.WEBCODEX_IMAGE_TEST_PACKAGE||'/home/ubuntu/tools/image-tools/package.json')('sharp');
    const source=png(96,64,[210,20,30],4500000),preview=await sharp(red).webp().toBuffer();
    const meta={bytes:preview.length,sha256:sha(preview),mime_type:'image/webp',width:96,height:64,static_frame:false};
    const original={...identity('compressed.png',source),name:'图'.repeat(80)+'.png',preview:meta};
    fixtures['compressed.png']={identity:original,encoded:source.toString('base64'),preview:{identity:{...original,...meta},encoded:preview.toString('base64')}};
    {
      const c=await open({selected:[{image_document:{...original,preview:{...meta,width:95}}}]});
      await c.card.locator('article[data-state="error"]').waitFor();
      await finish(c,'server preview dimensions must match the pinned descriptor instead of silently adapting another identity');
    }
    for(const width of [800,390]){
      const c=await open({width,selected:[{image_document:original},entries(1)[0]]});await ready(c,2);
      const item=c.card.locator('article').nth(0);assert.match(await item.locator('.details').textContent(),/压缩预览/);
      assert.equal(await item.locator('img').evaluate(image=>image.naturalWidth),meta.width);
      assert.equal(await item.locator('img').evaluate(image=>image.naturalHeight),meta.height);
      await finish(c,`compressed preview and original metadata ${width}px`);
    }
  }
  console.log(JSON.stringify({passed:true,cases:passed,viewports:[800,390],maximumImages:16,temporaryArtifactsRemovedOnExit:true,checks:reports}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(output,{recursive:true,force:true});}
