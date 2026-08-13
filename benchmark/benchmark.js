import {spawn} from 'node:child_process';
const port=3199; const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
try { await new Promise(r=>setTimeout(r,200)); for(const n of [1,3,5,10]) { const t=performance.now(); const rs=await Promise.all(Array.from({length:n},()=>fetch(`http://127.0.0.1:${port}/health`))); console.log(JSON.stringify({concurrency:n,ok:rs.every(r=>r.status===200),avg_ms:Number(((performance.now()-t)/n).toFixed(2))})); } } finally { child.kill('SIGTERM'); }
