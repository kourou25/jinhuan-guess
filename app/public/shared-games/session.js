// Compatibility entry for previously cached clients. No timers, sockets or model calls.
export function mountSession({main,h}){
 main.replaceChildren(h('p',{role:'status'},'AI对抗和卧底画家已下线'),h('a',{href:'/chat/1'},'返回普通猜词'));
 return {destroy(){}};
}
