#!/usr/bin/env node
'use strict';
// Optional local adapter for the operator's existing managed-browser MCP.
// The original manager owns profiles, browser effects, locks and shutdown.
const fs = require('node:fs');
const { reserveScreenshot, removeEmptyReservation, readScreenshot } = require('./managed_browser_screenshot.cjs');
const { sdk } = require('/home/ubuntu/tools/browser-tools/managed-browser/lib/deps.cjs');
const root = fs.realpathSync(process.cwd());
let sequence = Promise.resolve(), closing = false, activeProfile = null;
const upstream = new sdk.Client({ name:'webcodex-managed-browser', version:'1.0.0' }, { capabilities:{} });
const transport = new sdk.StdioClientTransport({ command:'/home/ubuntu/.local/bin/managed-browser-mcp', cwd:root, env:{ ...process.env }, stderr:'pipe' });
const server = new sdk.Server({ name:'webcodex-managed-browser', version:'1.0.0' }, { capabilities:{tools:{}},
  instructions:'先 profile_list/get，再用明确 managed_profile 执行 profile_start。操作结束必须 profile_stop。browser_take_screenshot 返回模型图片，并保存项目相对路径；用户要查看截图时调用 present_image(project,path) 显示卡片。登录数据仍由原管理器持有。' });

async function main() {
  const connecting=upstream.connect(transport);transport.stderr?.on('data',()=>{});await connecting;
  server.setRequestHandler(sdk.ListToolsRequestSchema,async()=>{
    const listed=await upstream.listTools();
    return {...listed,tools:listed.tools.map(tool=>tool.name==='browser_take_screenshot'
      ? {...tool,description:tool.description+' Returns a native model image and screenshot_project_path. Every screenshot gets a Shanghai-time timestamp including milliseconds and a random UUID; existing screenshots are retained. filename is a naming hint: its directory, stem and image extension are preserved, and a unique suffix is added. Without filename, saves under artifacts/managed-browser in the configured workspace. Always use the returned screenshot_project_path with present_image for user-visible display; do not assume filename is the actual saved path.',
        inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,filename:{...tool.inputSchema.properties.filename,description:'Optional filename hint within the configured workspace. The actual basename receives a unique timestamp/UUID suffix. Use screenshot_project_path from the result for the saved file.'}}}}
      : tool)};
  });
  server.setRequestHandler(sdk.CallToolRequestSchema,request=>{
    const work=sequence.then(async()=>{
      if(closing) return {isError:true,content:[{type:'text',text:'浏览器连接正在关闭'}]};
      const {name,arguments:args={}}=request.params;
      if(name!=='browser_take_screenshot') {
        const result=await upstream.callTool({name,arguments:args},undefined,{timeout:150000});
        if(!result.isError && name==='profile_start') activeProfile=args.managed_profile;
        if(!result.isError && name==='profile_stop') activeProfile=null;
        return result;
      }
      let reservation;
      try {reservation=reserveScreenshot(root,args.filename);}
      catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
      const {filename}=reservation;
      const result=await upstream.callTool({name,arguments:{...args,filename}},undefined,{timeout:150000});
      if(result.isError) {removeEmptyReservation(reservation);return result;}
      try {return readScreenshot(root,result,filename);}
      catch {return {...result,content:[...result.content,{type:'text',text:'截图操作已返回，但图片交付无法核验；检查已保存的项目文件，不要自动重复页面操作。'}]};}
    });
    sequence=work.catch(()=>{});
    return work;
  });
  await server.connect(new sdk.StdioServerTransport());
}
async function shutdown(){
  if(closing)return;closing=true;await sequence;
  try {
    if(activeProfile){
      const stopped=await upstream.callTool({name:'profile_stop',arguments:{managed_profile:activeProfile}},undefined,{timeout:150000});
      if(stopped.isError) throw new Error('profile stop not confirmed');
      activeProfile=null;
    }
    await upstream.close();await server.close();
  } catch { process.stderr.write('登录浏览器未确认正常关闭，请检查管理器状态\n'); process.exitCode=1; }
}
process.stdin.once('end',()=>void shutdown());
process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
main().catch(()=>{process.stderr.write('浏览器适配连接失败\n');process.exitCode=1;});
