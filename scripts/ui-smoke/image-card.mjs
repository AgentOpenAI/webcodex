// Native Chromium acceptance for the shipped image App and MCP Host bridge.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(process.env.WEBCODEX_PLAYWRIGHT_PACKAGE || new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const html = readFileSync(new URL('../../src/mcp_image_app.html', import.meta.url), 'utf8');
const data = readFileSync(process.argv[2] || new URL('../../artifacts/runtime-overview/runtime-390-light-zh.png', import.meta.url));
const sha256 = createHash('sha256').update(data).digest('hex');
const identity = { project:'agent:fixture:images', path:'assets/logo.png', name:'logo.png', bytes:data.length, sha256, mime_type:'image/png' };
const output = process.env.WEBCODEX_IMAGE_SMOKE_OUTPUT || '/tmp/webcodex-image-acceptance';
mkdirSync(output, { recursive:true });
const server = createServer((req,res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(req.url === '/app' ? html : '<style>body{margin:0}iframe{width:100%;height:900px;border:0}</style><iframe src="/app"></iframe>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true, ...(process.env.WEBCODEX_CHROMIUM ? {executablePath:process.env.WEBCODEX_CHROMIUM} : {})});
try {
  for (const width of [800,390]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    const errors = []; page.on('pageerror',error => errors.push(error.message));
    page.on('console',message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(({identity,encoded,projected}) => {
      if (window !== window.top) return;
      window.reads = []; window.mode = 'valid'; window.early = false;
      const bytes = Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      window.addEventListener('message',event => {
        const request = event.data, frame = document.querySelector('iframe');
        if (!frame || event.source !== frame.contentWindow || !request?.id) return;
        const reply = result => frame.contentWindow.postMessage({jsonrpc:'2.0',id:request.id,result},'*');
        const present = () => {
          const canonical={success:true,output:{image_document:identity}};
          frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:projected?{success:true,output:{}}:canonical,_meta:{'webcodex/imageDocument':canonical}}},'*');
        };
        window.present = present;
        if (request.method === 'ui/initialize') {
          present(); reply({protocolVersion:'2026-01-26',hostCapabilities:{}});
        } else if (request.method === 'tools/call') {
          const args = request.params.arguments; window.reads.push(args);
          if (window.mode === 'stale') { reply({isError:true,structuredContent:{success:false,error:'snapshot_changed'}}); return; }
          const end = Math.min(bytes.length,args.byte_offset+512*1024), chunk = bytes.subarray(args.byte_offset,end);
          const parts = []; for (let i=0;i<chunk.length;i+=32768) parts.push(String.fromCharCode(...chunk.subarray(i,i+32768)));
          const artifact = {project:identity.project,path:identity.path,sha256:identity.sha256,bytes_total:bytes.length,byte_offset:args.byte_offset,next_byte_offset:end===bytes.length?null:end,complete:end===bytes.length};
          const content = window.mode === 'corrupt' ? 'A'.repeat(btoa(parts.join('')).length) : btoa(parts.join(''));
          const canonical={success:true,output:{artifact_chunk:artifact}};
          reply({structuredContent:projected?{success:true,output:{artifact_chunk:{...artifact,byte_offset:999}}}:canonical,content:[{type:'text',text:JSON.stringify(canonical)}],_meta:{'webcodex/artifactChunk':{content_base64:content}}});
        }
      });
    },{identity,encoded:data.toString('base64'),projected:width===390});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const card = page.frameLocator('iframe');
    await card.locator('#image:not([hidden])').waitFor();
    assert.equal(await card.locator('#image').evaluate(image=>image.naturalWidth>0),true);
    assert.equal(await card.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1),true);
    await card.getByRole('button',{name:'原始尺寸'}).click();
    assert.equal(await card.locator('#image').evaluate(image=>image.classList.contains('actual')),true);
    await card.getByRole('button',{name:'适应宽度'}).click();
    await page.screenshot({path:`${output}/image-${width}.png`,fullPage:true});
    await page.evaluate(()=>{window.mode='corrupt';window.present();});
    await card.locator('#status').filter({hasText:/校验失败|长度不符/}).waitFor();
    assert.equal(await card.locator('#image').isVisible(),false);
    await page.evaluate(()=>{window.mode='valid';});
    await card.getByRole('button',{name:'重试',exact:true}).click();
    await card.locator('#image:not([hidden])').waitFor();
    await page.evaluate(()=>{window.mode='stale';window.present();});
    await card.locator('#status').filter({hasText:'图片读取失败或文件已变化'}).waitFor();
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log(JSON.stringify({passed:true,viewports:[800,390],sha256,screenshots:output}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
