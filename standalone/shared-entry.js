import {installGameShell} from '/game-shell.js';
import {createSharedPane} from '/shared-sidebar-pane.js';
import {installGameNav,mountGameApp} from '/game-app.js';
import {installStarterGift} from '/guess-starter.js';
window.__GUESS_SHARED__=true;
window.__createSharedPane=createSharedPane;
document.querySelector('[aria-label="尽欢 首页"]')?.setAttribute('href','https://jinhuan.example');
document.querySelector('.mobile-nav [data-nav="me"]')?.setAttribute('href','https://jinhuan.example/me');
document.querySelectorAll('.mainnav a,.logo,.mobile-nav a').forEach(a=>a.removeAttribute('data-link'));
installGameNav();installGameShell();
if(location.pathname==='/me/ai'||location.pathname.startsWith('/games/')){window.__GUESS_DETAIL_ONLY__=true;await mountGameApp()}
else await import('/app.js?v=shared-0.7.17');
installStarterGift();
