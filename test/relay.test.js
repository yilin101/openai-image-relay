import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http'; import {spawn} from 'node:child_process';
test('health contract',()=>assert.deepEqual({ok:true,service:'openai-image-relay'},{ok:true,service:'openai-image-relay'}));
test('base64 reference',()=>assert.equal(Buffer.from('abc').toString('base64'),'YWJj'));
test('multipart content is not decoded by the relay',()=>assert.match('multipart/form-data; boundary=abc',/^multipart\/form-data/));
test('mixed data items preserve existing b64_json',()=>{const data=[{url:'x'},{b64_json:'YWJj'}]; assert.equal(data[1].b64_json,'YWJj');});

test('process integration: auth, multipart passthrough, URL conversion and upstream errors', async t=>{
  const image=Buffer.from([137,80,78,71,0,1,2,3]); let seen='';
  const upstream=http.createServer((req,res)=>{let b=[];req.on('data',x=>b.push(x));req.on('end',()=>{if(req.url?.includes('error')){res.writeHead(429,{'content-type':'application/json'});return res.end('{"error":"rate limited"}');} if(req.url==='/image.png'){res.writeHead(200,{'content-type':'image/png'});return res.end(image);} seen=Buffer.concat(b).toString(); res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{url:`http://127.0.0.1:${upstream.address().port}/image.png`},{b64_json:'YWJj'}]}));});});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r)); const upPort=upstream.address().port; const relayPort=await new Promise(r=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(relayPort),UPSTREAM_BASE_URL:`http://127.0.0.1:${upPort}`,RELAY_API_KEY:'relay-test',UPSTREAM_API_KEY:'up-test',ALLOW_PRIVATE_URLS:'true'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill('SIGTERM'); await new Promise(r=>upstream.close(r));}); await new Promise(r=>setTimeout(r,250));
  let r=await fetch(`http://127.0.0.1:${relayPort}/v1/images/edits`,{method:'POST',headers:{authorization:'Bearer wrong'}}); assert.equal(r.status,401);
  const boundary='----relay-test'; const body=`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nhello\r\n--${boundary}--\r\n`;
  r=await fetch(`http://127.0.0.1:${relayPort}/v1/images/edits`,{method:'POST',headers:{authorization:'Bearer relay-test','content-type':`multipart/form-data; boundary=${boundary}`},body}); assert.equal(r.status,200); const out=await r.json(); assert.equal(out.data[0].b64_json,image.toString('base64')); assert.equal(out.data[1].b64_json,'YWJj'); assert.match(seen,/hello/);
  r=await fetch(`http://127.0.0.1:${relayPort}/v1/images/edits?error`,{method:'POST',headers:{authorization:'Bearer relay-test'}}); assert.equal(r.status,429); assert.match(await r.text(),/rate limited/);
});
