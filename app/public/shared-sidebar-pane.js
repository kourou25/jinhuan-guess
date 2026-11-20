import {openGuessInvite,invitedRound} from '/guess-invite.js';
import {createGameChat} from '/shared-games/chat.js';
import {installFundingNotice} from '/game-funding-notice.js';
export function createSharedPane({g,h,api,renderMessage,createRound,emojiPicker,onError,panes,userId}){
 let dead=false,panel=null,loading=null;
 const pane=createGameChat({group:g,h,api,renderMessage,emojiPicker,panes,openGuess,destination:'',onDestroy:()=>{dead=true;panel?.destroy()},onSignal:s=>panel?.signal([{id:s.id,updated_at:s.updated_at,deleted:s.deleted,redpack:{ldc_mode:'guess',guess_revision:s.room_revision}}])});
 const doc=pane.el.ownerDocument,gid=Number(g.id)||1,opener=h('button',{type:'button',class:'cm-guess-open',hidden:true,onclick:()=>openGuess()},'猜词');pane.el.prepend(opener);
 installFundingNotice(userId,doc);
 for(const href of ['/shared-games/chat.css','/shared-games/session.css'])if(!doc.querySelector('link[href="'+href+'"]'))doc.head.append(h('link',{rel:'stylesheet',href}));
 async function openGuess(mid=0){try{loading ||= import('/guess-room.js').then(({createGuessRoom})=>{if(!dead)panel=createGuessRoom({pane:pane.el,chat:pane.chat,scroller:pane.scroller,opener,gid,userId,h,api,create:anchor=>createRound(anchor,m=>{panel?.open();queueMicrotask(()=>{if(!dead)openGuessInvite({h,gid,messageId:Number(m.id),created:true,anchor})})}),notice:g.notice})});await loading;if(!dead)panel?.open(mid)}catch(e){if(!dead)onError(e.message)}}
 queueMicrotask(()=>{if(!dead)openGuess(invitedRound(doc.defaultView.location.search))});return pane;
}
