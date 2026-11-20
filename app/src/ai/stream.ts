export function withAiMeta(response:Response,meta:Record<string,unknown>){
 const reader=response.body!.getReader(),head=new TextEncoder().encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`);let first=true
 return new Response(new ReadableStream<Uint8Array>({
  async pull(sink){try{if(first){first=false;sink.enqueue(head);return}const part=await reader.read();if(part.done)sink.close();else sink.enqueue(part.value)}catch{sink.error(new Error('AI响应中断'));await reader.cancel().catch(()=>{})}},
  cancel(){return reader.cancel()},
 }),{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'}})
}
