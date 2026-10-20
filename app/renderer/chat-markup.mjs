export function safeChatLink(value) {
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&value.length<=2048?url.href:null;}catch{return null;}
}
// Build DOM nodes rather than interpreting user HTML. Formatting remains data, never executable markup.
export function renderChatMarkup(text,document=globalThis.document) {
  const fragment=document.createDocumentFragment();
  function inline(value,parent,depth=0) {
    if(depth>4){parent.append(document.createTextNode(value));return;}
    const pattern=/(\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>]+|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*)/g;
    let offset=0;
    for(const match of value.matchAll(pattern)) {
      parent.append(document.createTextNode(value.slice(offset,match.index)));offset=match.index+match[0].length;
      let node;
      if(match[2]||/^https?:/.test(match[0])) {
        const href=safeChatLink(match[3]||match[0]);if(!href){parent.append(document.createTextNode(match[0]));continue;}
        if(!match[2]&&/\.(png|jpe?g|gif|webp)$/i.test(new URL(href).pathname)){
          node=document.createElement('img');node.className='chat-message-image chat-linked-image';node.src=href;node.alt='链接图片';node.loading='lazy';node.referrerPolicy='no-referrer';
        }else{node=document.createElement('a');node.href=href;node.target='_blank';node.rel='noopener noreferrer';node.textContent=match[2]||match[0];}
      }else{
        const index=[4,5,6,7,8].find(index=>match[index]!==undefined);
        node=document.createElement({4:'code',5:'strong',6:'u',7:'s',8:'em'}[index]);
        if(index===4)node.textContent=match[index];else inline(match[index],node,depth+1);
      }
      parent.append(node);
    }
    parent.append(document.createTextNode(value.slice(offset)));
  }
  for(const line of text.split('\n')) {
    const heading=/^(#{1,3})\s+(.*)$/.exec(line),quote=/^>\s?(.*)$/.exec(line),list=/^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    const node=document.createElement(heading?'h'+(heading[1].length+2):quote?'blockquote':'p');
    if(list)node.className='chat-list-line';inline(heading?.[2]??quote?.[1]??list?.[1]??line,node);
    if(!line)node.append(document.createElement('br'));fragment.append(node);
  }
  return fragment;
}
