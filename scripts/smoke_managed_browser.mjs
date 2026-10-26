// Exercises the operator's existing profile, using only a local synthetic page.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, rmSync, chownSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(process.env.WEBCODEX_BROWSER_PACKAGE || '/home/ubuntu/tools/browser-tools/package.json');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const gatewayEnv = process.argv[2];
const client = new Client({name:'webcodex-browser-acceptance',version:'1.0.0'},{capabilities:{}});
let transport;
if (gatewayEnv) {
  const values = Object.fromEntries(readFileSync(gatewayEnv,'utf8').split(/\r?\n/).filter(line=>line && !line.startsWith('#') && line.includes('=')).map(line=>{
    const index=line.indexOf('=');return [line.slice(0,index).trim(),line.slice(index+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
  }));
  transport = new StreamableHTTPClientTransport(new URL(`http://${values.WEBCODEX_ADDR}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${values.WEBCODEX_TOKEN}`}}});
} else {
  transport = new StdioClientTransport({command:'/home/ubuntu/.local/bin/node',args:['scripts/managed_browser_gateway.cjs'],cwd:process.cwd(),env:{HOME:process.env.HOME,PATH:process.env.PATH},stderr:'pipe'});
}
const page = '<!doctype html><meta charset="utf-8"><title>WebCodex 浏览器验收</title><h1>登录身份浏览器验收</h1><button id="verify" onclick="document.querySelector(\'output\').textContent=\'点击已完成\'">验收测试按钮</button><output>等待点击</output>';
const server = createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let active = false;
const temporary=mkdtempSync(join(process.cwd(),'.webcodex-browser-acceptance-'));
if (gatewayEnv && process.getuid?.() === 0) {
  const runnerOwner=statSync('/home/ubuntu');
  chownSync(temporary,runnerOwner.uid,runnerOwner.gid);
}
const screenshot=join(temporary,'browser.png');
async function call(name,args={}) {
  if (gatewayEnv) {
    const description = await client.callTool({name:'mcp_tool',arguments:{action:'describe',server:'managed-browser',tool:name}});
    assert(!description.isError,'Gateway tool discovery failed');
  }
  const result = await client.callTool(gatewayEnv ? {name:'mcp_tool',arguments:{action:'call',server:'managed-browser',tool:name,arguments:args}} : {name,arguments:args},undefined,{timeout:150000});
  if (result.isError) throw new Error(`Browser operation failed: ${name}`);
  return result;
}
function savedScreenshot(result) {
  for(const block of result.content || []) {
    if(block.type!=='text')continue;
    let value;try{value=JSON.parse(block.text);}catch{continue;}
    if(typeof value.screenshot_project_path!=='string')continue;
    const filename=resolve(process.cwd(),value.screenshot_project_path);
    const rel=relative(temporary,filename);
    assert(rel && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel),'Screenshot escaped the acceptance directory');
    return filename;
  }
  throw new Error('Screenshot did not report its saved Project path');
}
const hash=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex');
try {
  const connecting=client.connect(transport);transport.stderr?.on('data',()=>{});await connecting;
  const listed=await call('profile_list');
  const profiles=JSON.parse(listed.content.find(item=>item.type==='text').text);
  assert(profiles.some(profile=>profile.name==='googleProfile'),'Existing profile not found');
  await call('profile_get',{managed_profile:'googleProfile'});
  await call('profile_start',{managed_profile:'googleProfile'});active=true;
  await call('browser_navigate',{managed_profile:'googleProfile',url:`http://127.0.0.1:${server.address().port}/acceptance`});
  await call('browser_snapshot',{managed_profile:'googleProfile'});
  await call('browser_click',{managed_profile:'googleProfile',target:'#verify',element:'验收测试按钮'});
  const snapshot=await call('browser_snapshot',{managed_profile:'googleProfile'});
  assert(snapshot.content.some(item=>item.type==='text' && item.text.includes('点击已完成')),'Click outcome not observed');
  const shot=await call('browser_take_screenshot',{managed_profile:'googleProfile',scale:'css',filename:screenshot});
  const first=savedScreenshot(shot),firstHash=hash(first);
  assert(statSync(first).size>0,'Screenshot was not written');
  assert(shot.content.some(item=>item.type==='image'),'Screenshot image was not delivered');
  const next=await call('browser_take_screenshot',{managed_profile:'googleProfile',scale:'css',filename:screenshot});
  const second=savedScreenshot(next);
  assert.notEqual(first,second,'Repeated filename overwrote the previous screenshot');
  assert.equal(hash(first),firstHash,'Previous screenshot bytes changed');
  assert(statSync(second).size>0,'Second screenshot was not written');
  assert(next.content.some(item=>item.type==='image'),'Second screenshot image was not delivered');
  await call('profile_stop',{managed_profile:'googleProfile'});active=false;
  console.log(JSON.stringify({passed:true,route:gatewayEnv?'WebCodex MCP gateway':'local manager',profile:'googleProfile',navigation:true,click:true,screenshot:true,uniqueNames:true,previousImageRetained:true,normalStop:true}));
} finally {
  if(active) await call('profile_stop',{managed_profile:'googleProfile'});
  await client.close();await new Promise(resolve=>server.close(resolve));
  rmSync(temporary,{recursive:true,force:true});
}
