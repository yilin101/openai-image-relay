import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const env = process.env;
const PORT = Number(env.PORT || 3100);
const UPSTREAM = String(env.UPSTREAM_BASE_URL || '').replace(/\/$/, '');
const RELAY_KEY = env.RELAY_API_KEY || '';
const UPSTREAM_KEY = env.UPSTREAM_API_KEY || '';
const timeoutMs = Number(env.UPSTREAM_TIMEOUT_MS || 300000);
const maxImage = Number(env.MAX_IMAGE_SIZE_MB || 50) * 1024 * 1024;
const hop = new Set(['connection','proxy-connection','keep-alive','transfer-encoding','upgrade','te','trailer','host','content-length','content-encoding']);
const agents = { http: new http.Agent({keepAlive:true,maxSockets:50}), https: new https.Agent({keepAlive:true,maxSockets:50}) };
function requestId(req){ return req.headers['x-request-id'] || `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function json(res, status, body, id){ res.writeHead(status, {'content-type':'application/json; charset=utf-8','x-relay-request-id':id}); res.end(JSON.stringify(body)); }
function authorized(req){ return !RELAY_KEY || req.headers.authorization === `Bearer ${RELAY_KEY}`; }
function target(path){ if (!UPSTREAM) throw new Error('UPSTREAM_BASE_URL is not configured'); return new URL(path, UPSTREAM + '/'); }
function copyHeaders(src, extra={}){ const h={}; for(const [k,v] of Object.entries(src)){ if(!hop.has(k.toLowerCase()) && !k.toLowerCase().startsWith('authorization')) h[k]=v; } return {...h,...extra}; }
function proxy(req,res,id){
  let url; try { url=target(req.url); } catch(e){ return json(res,500,{error:{message:e.message,type:'configuration_error'}},id); }
  const client = url.protocol === 'https:' ? https : http;
  const headers=copyHeaders(req.headers, UPSTREAM_KEY ? {authorization:`Bearer ${UPSTREAM_KEY}`} : {});
  const started=Date.now(); const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),timeoutMs);
  const q=client.request(url,{method:req.method,headers,agent:agents[url.protocol.slice(0,-1)],signal:ac.signal}, up=>{
    clearTimeout(timer); const chunks=[]; let bytes=0; const ct=String(up.headers['content-type']||'');
    up.on('data',c=>{bytes+=c.length; if(bytes>Number(env.MAX_UPSTREAM_JSON_MB||100)*1024*1024){ up.destroy(Error('upstream response exceeds limit')); return; } chunks.push(c);});
    up.on('end',async()=>{
      if(up.statusCode<200||up.statusCode>=300||!ct.includes('json')){ res.writeHead(up.statusCode||502,copyHeaders(up.headers,{'x-relay-request-id':id})); return res.end(Buffer.concat(chunks)); }
      let body; try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(502,{'x-relay-request-id':id});return res.end('Invalid upstream JSON');}
      if(Array.isArray(body.data)) for(const item of body.data){ if(!item.b64_json && item.url) try{item.b64_json=await downloadBase64(item.url); delete item.url;}catch(e){return json(res,502,{error:{message:`image download failed: ${e.message}`}},id);} }
      json(res,up.statusCode,body,id); console.log(`request_id=${id} upstream_status=${up.statusCode} total_ms=${Date.now()-started} image_bytes=${bytes}`);
    });
  });
  q.on('error',e=>{clearTimeout(timer); if(!res.headersSent) json(res,e.name==='AbortError'?504:502,{error:{message:e.message}},id);}); req.on('aborted',()=>q.destroy()); req.pipe(q);
}
async function downloadBase64(raw){ const u=new URL(raw); if(!['http:','https:'].includes(u.protocol)) throw Error('unsupported URL scheme'); const privateHost=['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname)||/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname); if(privateHost&&env.ALLOW_PRIVATE_URLS!=='true') throw Error('blocked private address'); const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(Number(env.IMAGE_DOWNLOAD_TIMEOUT_MS||90000))}); if(!r.ok) throw Error(`HTTP ${r.status}`); const b=Buffer.from(await r.arrayBuffer()); if(b.length>maxImage) throw Error('image exceeds size limit'); return b.toString('base64'); }
const server=http.createServer((req,res)=>{const id=requestId(req); res.setHeader('x-relay-request-id',id); if(req.url==='/health')return json(res,200,{ok:true,service:'openai-image-relay'},id); if(req.url==='/')return json(res,200,{service:'openai-image-relay',status:'running'},id); if(!authorized(req))return json(res,401,{error:{message:'Unauthorized'}},id); if(['POST'].includes(req.method)&&/^\/v1\/images\/(edits|generations|variations)(\?|$)/.test(req.url))return proxy(req,res,id); if(req.method==='GET'&&req.url==='/v1/models')return json(res,200,{object:'list',data:[{id:'gpt-image-2',object:'model',owned_by:'relay'}]},id); json(res,404,{error:{message:'Not found'}},id);});
server.listen(PORT,'0.0.0.0',()=>console.log(`openai-image-relay listening on ${PORT}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
