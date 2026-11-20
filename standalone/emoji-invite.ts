import {readEmojiInvite} from '../app/public/emoji-invite.js';
// Resolve before auth; the existing canonical route handles login and permissions.
export function emojiInviteRedirect(request:Request):Response|null{
 const url=new URL(request.url);let path:string;
 try{path=decodeURIComponent(url.pathname)}catch{return null}
 if(path!=='/🧩'&&!path.startsWith('/🧩/'))return null;
 if(!['GET','HEAD'].includes(request.method))return new Response('此链接只支持打开访问',{status:405,headers:{allow:'GET, HEAD'}});
 const invite=readEmojiInvite(url.pathname);
 if(!invite||invite.gid!==1)return new Response('邀请链接无效，请重新复制完整链接',{status:400});
 return new Response(null,{status:302,headers:{location:url.origin+'/chat/1?message_id='+invite.messageId,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
