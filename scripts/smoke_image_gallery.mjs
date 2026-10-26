// Operator acceptance against the existing loopback MCP and shipped gallery HTML.
// Uses the host's existing Playwright; keeps credentials and image bytes in memory.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

const [envFile,project,...paths]=process.argv.slice(2);
assert(envFile && project && paths.length>=1 && paths.length<=16,
  'Usage: node scripts/smoke_image_gallery.mjs ENV_FILE PROJECT PATH [PATH ...]');
const require=createRequire(process.env.WEBCODEX_BROWSER_PACKAGE || '/home/ubuntu/tools/browser-tools/package.json');
const {chromium}=require('@playwright/test');
const values=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/)
  .filter(line=>line && !line.startsWith('#') && line.includes('='))
  .map(line=>{const index=line.indexOf('=');return [line.slice(0,index).trim(),line.slice(index+1).trim().replace(/^(["'])(.*)\1$/,'$2')];}));
assert.equal(values.WEBCODEX_ADDR,'127.0.0.1:18080','Acceptance is restricted to the existing loopback deployment');
let sequence=1;
const capabilities={extensions:{'io.modelcontextprotocol/ui':{mimeTypes:['text/html;profile=mcp-app']}}};
async function rpc(method,params={}) {
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':capabilities,
    'io.modelcontextprotocol/clientInfo':{name:'webcodex-gallery-acceptance',version:'1.0.0'}};
  let response;
  try {
    response=await fetch(`http://${values.WEBCODEX_ADDR}/mcp`,{
      method:'POST',headers:{Authorization:`Bearer ${values.WEBCODEX_TOKEN}`,'Content-Type':'application/json',
        'Mcp-Protocol-Version':'2026-07-28','Mcp-Method':method,
        ...((params.name||params.uri)?{'Mcp-Name':params.name||params.uri}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:sequence++,method,params:{...params,_meta:meta}}),
      signal:AbortSignal.timeout(120000),
    });
  } catch {throw new Error('Loopback MCP request failed');}
  const body=await response.json();
  if(!response.ok || body.error)throw new Error(`Loopback MCP ${method} failed (${body.error?.code || response.status})`);
  return body.result;
}
function canonical(result) {
  if(result.structuredContent?.output)return result.structuredContent;
  if(result._meta?.['webcodex/imageDocument']?.output)return result._meta['webcodex/imageDocument'];
  for(const block of result.content || []) {
    if(block.type!=='text')continue;
    try{const parsed=JSON.parse(block.text);if(parsed.output)return parsed;}catch{}
  }
  throw new Error('MCP result did not contain the canonical image output');
}
await rpc('server/discover');
const listed=await rpc('tools/list');
const descriptor=listed.tools.find(tool=>tool.name==='present_image');assert(descriptor);
assert(descriptor.inputSchema.properties.paths,'Batch image schema was not advertised');
assert.equal(descriptor._meta.ui.resourceUri,'ui://webcodex/image/v5');
const presented=await rpc('tools/call',{name:'present_image',arguments:{project,paths}});
const output=canonical(presented);assert.equal(output.success,true);
const entries=output.output.image_gallery;assert.equal(entries.length,paths.length);
assert(entries.every(item=>item.image_document),'Live acceptance requires existing valid images');
assert.deepEqual(entries.map(item=>item.image_document.path),paths);
const identity=entries.map(item=>item.image_document);
const resource=await rpc('resources/read',{uri:descriptor._meta.ui.resourceUri});
const html=resource.contents[0].text;
const host=createServer(async(req,res)=>{
  try {
    if(req.url==='/app'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if(req.url==='/bridge'){
      let text='';for await(const chunk of req){text+=chunk;if(text.length>64*1024*1024)throw new Error('Bridge payload exceeded acceptance bound');}
      const request=JSON.parse(text);let result={};
      if(request.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostCapabilities:{}};
      else if(request.method==='tools/call')result=await rpc('tools/call',request.params);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<style>body{margin:0}iframe{width:100%;height:2400px;border:0}</style><iframe src="/app"></iframe>');
  } catch {res.writeHead(500);res.end('Acceptance bridge failed');}
});
await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  for(const width of [800,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.addInitScript(({presented})=>{
      if(window!==window.top)return;
      addEventListener('message',async event=>{
        const frame=document.querySelector('iframe'),message=event.data;
        if(!frame || event.source!==frame.contentWindow || !message?.id)return;
        try {
          const response=await fetch('/bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});
          const result=await response.json();
          frame.contentWindow.postMessage({jsonrpc:'2.0',id:message.id,result},'*');
          if(message.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:presented},'*');
        } catch {frame.contentWindow.postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Acceptance bridge failed'}},'*');}
      });
    },{presented});
    await page.goto(`http://127.0.0.1:${host.address().port}`);
    const frame=page.frameLocator('iframe');
    await frame.locator('img').last().waitFor({state:'attached',timeout:120000});
    const deadline=Date.now()+120000;
    for(;;) {
      const count=await frame.locator('img').evaluateAll(images=>images.filter(image=>!image.hidden && image.naturalWidth>0).length);
      if(count===paths.length)break;
      if(Date.now()>deadline)throw new Error(`Expected ${paths.length} decoded gallery images; got ${count}`);
      await page.waitForTimeout(100);
    }
    assert.equal(await frame.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);
    for(let i=0;i<identity.length;i++)if(identity[i].preview){
      assert.match(await frame.locator('article').nth(i).locator('.details').textContent(),/压缩|原图/);
      const image=frame.locator('article').nth(i).locator('img');
      assert.equal(await image.evaluate(node=>node.naturalWidth),identity[i].preview.width);
      assert.equal(await image.evaluate(node=>node.naturalHeight),identity[i].preview.height);
    }
    await page.close();
  }
  console.log(JSON.stringify({passed:true,productionMcp:true,resource:descriptor._meta.ui.resourceUri,
    requestedImages:paths.length,visibleImages:paths.length,viewports:[800,390],compressedPreviews:identity.filter(value=>value.preview).length,temporaryFilesWritten:false}));
} finally {await browser?.close();await new Promise(resolve=>host.close(resolve));}
