import {socialLinks,canSocialPost,socialCaption} from '../../public/social-links.js'
import type {Preview} from './social-preview'
import {fail} from '../lib/http'

export function postShareLink(raw:unknown){
 if(typeof raw!=='string'||raw.length>10000)fail(400,'请粘贴有效的分享链接')
 const links=socialLinks(raw as string)
 if(links.length!==1)fail(400,'请每次粘贴一条分享链接')
 const link=links[0]
 if(!canSocialPost(link.provider))fail(400,'该平台暂不支持转成帖子')
 return link
}
export function socialPostGallery(data:Preview){
 return (data.media||[]).map((it,i)=>({u:`/api/memes/__MEME_ID__/social-media/${i}`,w:it.width,h:it.height,external_url:it.poster||it.url,...(it.kind==='video'?{v:`/api/memes/__MEME_ID__/social-media/${i}?video=1`,k:'v',external_video:it.url}:{})}))
}
// 旧转帖曾追加来源尾注；只移除与后台来源完全一致的尾注，不改用户正文。
export function socialPostContent(content:string,source:string|null){
 if(!source||!socialLinks(source).length)return content
 const tail=content.lastIndexOf('\n\n来源：')
 return socialCaption(tail>=0&&content.slice(tail).trimEnd().endsWith('\n'+source)?content.slice(0,tail):content)
}
