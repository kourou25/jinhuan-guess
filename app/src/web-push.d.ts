declare module 'web-push' {
 const webpush: {
  generateRequestDetails(subscription:{endpoint:string;keys:{p256dh:string;auth:string}},payload:string,options:{vapidDetails:{subject:string;publicKey:string;privateKey:string};TTL:number;urgency:string;contentEncoding:string}):{endpoint:string;method:string;headers:Record<string,string>;body:Uint8Array}
 }
 export default webpush
}
