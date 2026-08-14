const USE_POSTGRES=Boolean(process.env.DATABASE_URL);
let pgPool=null;
async function dbReady(){
  if(!USE_POSTGRES)return false;
  if(!pgPool){
    const {Pool}=require('pg');
    pgPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false}});
  }
  return true;
}
async function persistOrderIfConfigured(o){
  if(!await dbReady())return;
  await pgPool.query(`INSERT INTO orders
    (id,number,created_at,status,customer,items,subtotal,delivery_fee,total,payment,cash_received,change_amount,notes,beverage_check,client_request_id,updated_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,NOW())
    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,customer=EXCLUDED.customer,items=EXCLUDED.items,total=EXCLUDED.total,payment=EXCLUDED.payment,cash_received=EXCLUDED.cash_received,change_amount=EXCLUDED.change_amount,notes=EXCLUDED.notes,beverage_check=EXCLUDED.beverage_check,updated_at=NOW()`,
    [o.id,o.number,o.createdAt,o.status,JSON.stringify(o.customer),JSON.stringify(o.items),o.subtotal,o.deliveryFee,o.total,o.payment,o.cashReceived,o.change,o.notes,JSON.stringify(o.beverageCheck||{}),o.clientRequestId]);
}
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),url=require('url');
const VERSION='0.1.44';
const PORT=process.env.PORT||3017, ROOT=__dirname, DATA=path.join(ROOT,'data','store.json');
const seed={store:{name:'Minha Pensão',slug:'minha-pensao',currency:'BRL',deliveryFee:5,minimumOrder:20,open:true},categories:[{id:'c1',name:'Pratos',active:true},{id:'c2',name:'Acompanhamentos',active:true},{id:'c3',name:'Bebidas',active:true}],products:[{id:'p1',categoryId:'c1',name:'Prato da Casa',description:'Prato completo do dia.',price:25,active:true,addons:[]},{id:'p2',categoryId:'c1',name:'Carne de Sol',description:'Carne de sol com acompanhamentos.',price:32,active:true,addons:['a1','a2']},{id:'p3',categoryId:'c2',name:'Porção de Arroz',description:'Porção individual.',price:8,active:true,addons:[]},{id:'p4',categoryId:'c2',name:'Farofa',description:'Farofa temperada.',price:7,active:true,addons:[]},{id:'p5',categoryId:'c3',name:'Refrigerante Lata',description:'Escolha o sabor no pedido.',price:6,active:true,addons:[]}],addons:[{id:'a1',name:'Ovo',price:3},{id:'a2',name:'Queijo coalho',price:5}],orders:[],events:[]};
function ensure(){if(!fs.existsSync(DATA)){fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.writeFileSync(DATA,JSON.stringify(seed,null,2))}}function read(){ensure();return JSON.parse(fs.readFileSync(DATA))}function write(d){fs.writeFileSync(DATA,JSON.stringify(d,null,2))}function ev(d,type,payload){d.events.push({id:crypto.randomUUID(),type,at:new Date().toISOString(),payload})}function send(res,status,data,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data)}function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',x=>b+=x);req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}})})}
const server=http.createServer(async(req,res)=>{try{const u=url.parse(req.url,true),p=u.pathname;if(p==='/health'){return send(res,200,{ok:true,product:'BDK Delivery',version:VERSION})}if(p.startsWith('/api/')){const d=read();if(req.method==='GET'&&p==='/api/store')return send(res,200,d);if(req.method==='POST'&&p==='/api/orders/preview'){
const b=await body(req);if(!b.items?.length)return send(res,400,{error:'Nenhum item no pedido'});
const items=b.items.map(i=>{const p=d.products.find(x=>x.id===i.productId&&x.active);if(!p)return null;const qty=Math.max(1,Number(i.qty)||1);const addonIds=Array.isArray(i.addonIds)?i.addonIds:[];const addons=addonIds.map(id=>d.addons.find(a=>a.id===id)).filter(Boolean);const unit=Number((Number(p.price)+addons.reduce((a,x)=>a+Number(x.price),0)).toFixed(2));return {productId:p.id,name:p.name,qty,addons:addons.map(a=>({id:a.id,name:a.name,price:Number(a.price)})),unitTotal:unit,lineTotal:Number((unit*qty).toFixed(2))}}).filter(Boolean);
if(!items.length)return send(res,400,{error:'Nenhum item válido no pedido'});
const subtotal=Number(items.reduce((a,i)=>a+i.lineTotal,0).toFixed(2)),fee=Number(d.store.deliveryFee),total=Number((subtotal+fee).toFixed(2));
return send(res,200,{items,subtotal,deliveryFee:fee,total,requiresBeverageCheck:items.some(i=>/bebida|refrigerante|suco|água|agua/i.test(i.name))});
}if(req.method==='POST'&&p==='/api/orders/check-beverages'){
const b=await body(req);const o=d.orders.find(x=>x.id===b.orderId);if(!o)return send(res,404,{error:'Pedido não encontrado'});
const beverageItems=o.items.filter(i=>/bebida|refrigerante|suco|água|agua/i.test(i.name));
o.beverageCheck={required:beverageItems.length>0,confirmed:Boolean(b.confirmed),checkedAt:new Date().toISOString(),items:beverageItems.map(i=>({name:i.name,qty:i.qty}))};
o.updatedAt=new Date().toISOString();write(d);return send(res,200,o);
}if(req.method==='POST'&&p==='/api/orders/status'){
const b=await body(req);const o=d.orders.find(x=>x.id===b.orderId);if(!o)return send(res,404,{error:'Pedido não encontrado'});
const allowed=['NEW','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
if(!allowed.includes(b.status))return send(res,400,{error:'Status inválido'});
if(o.status===b.status)return send(res,200,o);
o.status=b.status;o.updatedAt=new Date().toISOString();o.statusHistory=o.statusHistory||[];o.statusHistory.push({status:o.status,at:o.updatedAt});write(d);return send(res,200,o);
}if(req.method==='GET'&&p.startsWith('/api/orders/')&&p.endsWith('/ticket')){
const id=p.split('/')[3];const o=d.orders.find(x=>x.id===id);if(!o)return send(res,404,{error:'Pedido não encontrado'});
const lines=[];lines.push('BDK DELIVERY');lines.push('PEDIDO #'+o.number);lines.push('STATUS: '+o.status);lines.push('--------------------------------');lines.push('ITENS DO PEDIDO');
o.items.forEach(i=>{lines.push(`${i.qty}x ${i.name}`);if(i.addons?.length)i.addons.forEach(a=>lines.push(`  + ${a.name}`));});
lines.push('--------------------------------');lines.push('CONFERÊNCIA DA MONTAGEM');lines.push('Quantidade e adicionais: CONFERIR');if(o.beverageCheck?.required)lines.push('BEBIDAS: '+(o.beverageCheck.confirmed?'CONFERIDAS':'PENDENTES'));lines.push('--------------------------------');lines.push('VALORES');
lines.push('--------------------------------');lines.push('Subtotal: R$ '+Number(o.subtotal).toFixed(2));lines.push('Entrega: R$ '+Number(o.deliveryFee).toFixed(2));lines.push('TOTAL: R$ '+Number(o.total).toFixed(2));if(o.payment==='Dinheiro'){lines.push('Recebido: R$ '+Number(o.cashReceived||0).toFixed(2));lines.push('TROCO: R$ '+Number(o.change||0).toFixed(2));}lines.push('Pagamento: '+o.payment);lines.push('--------------------------------');lines.push('ENTREGA / MOTOBOY');lines.push('Cliente: '+o.customer.name);lines.push('WhatsApp: '+o.customer.phone);lines.push('ENDEREÇO: '+o.customer.address);if(o.customer.reference)lines.push('REFERÊNCIA: '+o.customer.reference);if(o.beverageCheck?.required)lines.push('BEBIDAS CONFERIDAS: '+(o.beverageCheck.confirmed?'SIM':'NÃO'));if(o.notes)lines.push('Obs: '+o.notes);
return send(res,200,{orderId:o.id,number:o.number,lines,printText:lines.join('\n')});
}if(req.method==='POST'&&p==='/api/whatsapp/intake'){
const b=await body(req);const text=String(b.transcript||b.text||'').trim();
if(!text)return send(res,400,{error:'Mensagem vazia'});
const lower=text.toLowerCase();
const found=d.products.filter(x=>x.active&&lower.includes(String(x.name).toLowerCase()));
const draft={id:crypto.randomUUID(),channel:'WHATSAPP',inputType:b.transcript?'AUDIO_TRANSCRIPTION':'TEXT',text,customer:b.customer||null,matchedProducts:found.map(x=>({productId:x.id,name:x.name,price:x.price})),status:'AWAITING_CONFIRMATION',needs:['CONFIRMAR_ITENS','CONFIRMAR_ENDERECO','CONFIRMAR_PAGAMENTO'],createdAt:new Date().toISOString()};
return send(res,200,{draft,reply:found.length?'Entendi estes itens. Vou montar o pedido para você conferir antes de confirmar.':'Entendi sua mensagem. Vou precisar confirmar os itens antes de fechar o pedido.'});
}if(req.method==='POST'&&p==='/api/whatsapp/confirm'){
const b=await body(req);if(!b.confirmed)return send(res,400,{error:'O cliente precisa confirmar o pedido antes do fechamento'});
const mode=(d.settings&&d.settings.orderApprovalMode)||'OWNER';
return send(res,200,{status:mode==='AUTO'?'READY_FOR_ORDER_CORE':'AWAITING_STORE_APPROVAL',orderApprovalMode:mode,message:mode==='AUTO'?'Confirmação recebida. O pedido pode seguir para o núcleo operacional.':'Confirmação recebida. O pedido aguarda aprovação da loja antes de entrar na produção.'});
}if(req.method==='GET'&&p==='/api/settings/order-approval'){
return send(res,200,{mode:(d.settings&&d.settings.orderApprovalMode)||'OWNER'});
}
if(req.method==='PUT'&&p==='/api/settings/order-approval'){
const b=await body(req);const mode=String(b.mode||'').toUpperCase();
if(!['AUTO','OWNER'].includes(mode))return send(res,400,{error:'Modo inválido'});
d.settings=d.settings||{};d.settings.orderApprovalMode=mode;write(d);return send(res,200,{mode});
}if(req.method==='POST'&&p==='/api/orders/approve'){
const b=await body(req);const o=d.orders.find(x=>x.id===b.orderId);if(!o)return send(res,404,{error:'Pedido não encontrado'});
if(!['AWAITING_STORE_APPROVAL','CONFIRMED'].includes(o.status||'NEW'))return send(res,400,{error:'Pedido não está aguardando aprovação'});
o.status='ACCEPTED';o.approvedByStore=true;o.approvedAt=new Date().toISOString();o.updatedAt=o.approvedAt;o.statusHistory=o.statusHistory||[];o.statusHistory.push({status:'ACCEPTED',at:o.approvedAt});write(d);return send(res,200,o);
}if(req.method==='POST'&&p==='/api/conversation/profile'){const b=await body(req);const text=String(b.text||'').trim();const words=text?text.split(/\s+/).length:0;const profile=words<=8?'OBJETIVO':words>=25?'CONVERSADOR':'EQUILIBRADO';return send(res,200,{profile,replyGuidance:{OBJETIVO:'curto, claro e cordial',EQUILIBRADO:'natural e objetivo',CONVERSADOR:'mais contextual, sem prolongar artificialmente'}})}if(req.method==='POST'&&p==='/api/whatsapp/parse-order'){
const b=await body(req);const text=String(b.text||b.transcript||'').trim();if(!text)return send(res,400,{error:'Mensagem vazia'});
const lower=text.toLowerCase();const items=[];const needs=[];const notes=[];
d.products.filter(x=>x.active).forEach(prod=>{
 const n=prod.name.toLowerCase();const idx=lower.indexOf(n);
 if(idx>=0){
   const before=lower.slice(Math.max(0,idx-16),idx);
   const m=before.match(/(?:^|\s)(\d+)\s*(?:x|un|unidades?)?\s*$/);
   items.push({productId:prod.id,name:prod.name,qty:m?Number(m[1]):1,confidence:m?'HIGH':'MEDIUM'});
 }
});
const addonWords=['sem cebola','sem salada','com queijo','extra queijo','com molho','sem molho','bem passado','mal passado'];
const detectedNotes=addonWords.filter(x=>lower.includes(x));
if(detectedNotes.length)notes.push(...detectedNotes);
const moneyMatches=[...lower.matchAll(/(?:r\$\s*)?(\d+(?:[\.,]\d{1,2})?)/g)].map(m=>Number(m[1].replace(',','.'))).filter(v=>v>20&&v<10000);
const hasCash=/\b(dinheiro|troco|nota|pagar em espécie|pagar em dinheiro)\b/i.test(lower);
const addressSignal=/\b(rua|avenida|av\.?|travessa|estrada|alameda|n[ºo]\.?|número|numero|bairro|casa|apto|apartamento)\b/i.test(lower);
if(!items.length)needs.push('ITENS');
if(!b.customer?.address&&!addressSignal)needs.push('ENDERECO');
if(hasCash&&!moneyMatches.length)needs.push('VALOR_PAGO');
const payment=/\b(pix|cart[aã]o|d[eé]bito|cr[eé]dito|dinheiro)\b/i.exec(lower);const paymentMethod=payment?payment[1].toUpperCase():null;
return send(res,200,{status:items.length?'DRAFT':'NEEDS_CLARIFICATION',items,notes,possiblePaidValues:moneyMatches,paymentMethod,needs,raw:text,confidence:items.length?'MEDIUM':'LOW'});
}if(req.method==='POST'&&p==='/api/whatsapp/resolve-ambiguity'){
const b=await body(req);const query=String(b.query||'').trim().toLowerCase();
const matches=d.products.filter(x=>x.active&&query.includes(x.name.toLowerCase()));
const families={};
d.products.filter(x=>x.active).forEach(x=>{const key=String(x.family||x.category||x.name.split(' ')[0]).toLowerCase();(families[key]||(families[key]=[])).push(x)});
const candidates=Object.entries(families).filter(([k,v])=>query.includes(k)&&v.length>1).map(([k,v])=>({family:k,options:v.map(x=>({productId:x.id,name:x.name,price:x.price}))}));
if(candidates.length)return send(res,200,{status:'NEEDS_VARIANT',candidates,reply:`Qual ${candidates[0].family} você quer?`});
return send(res,200,{status:'CLEAR',matches});
}if(req.method==='GET'&&p==='/api/catalog/variants'){
const active=d.products.filter(x=>x.active);
const families={};
active.forEach(x=>{const family=String(x.family||x.category||x.name.replace(/\b(lata|600ml|2l|2lt|zero|normal|grande|media|pequena)\b/ig,'').replace(/\s+/g,' ').trim()).toLowerCase();(families[family]||(families[family]=[])).push(x)});
const result=Object.entries(families).filter(([k,v])=>v.length>1).map(([family,options])=>({family,options:options.map(x=>({productId:x.id,name:x.name,price:x.price}))}));
return send(res,200,{families:result});
}if(req.method==='POST'&&p==='/api/conversation/next-question'){
const b=await body(req);const draft=b.draft||{};const missing=Array.isArray(draft.needs)?draft.needs:[];
if(missing.includes('ITENS'))return send(res,200,{type:'ASK',field:'ITENS',text:'O que você gostaria de pedir?'});
if(missing.includes('ENDERECO'))return send(res,200,{type:'ASK',field:'ENDERECO',text:'Qual é o endereço para entrega?'});
if(missing.includes('VALOR_PAGO'))return send(res,200,{type:'ASK',field:'VALOR_PAGO',text:`Quanto você vai entregar para eu calcular o troco?`});
if(draft.variantQuestion)return send(res,200,{type:'ASK',field:'VARIANTE',text:draft.variantQuestion});
if(missing.includes('PAGAMENTO'))return send(res,200,{type:'ASK',field:'PAGAMENTO',text:'Vai pagar no Pix, cartão ou dinheiro?'});
return send(res,200,{type:'READY_FOR_CONFIRMATION',text:'Já tenho as informações necessárias. Vou resumir o pedido para você confirmar.'});
}if(req.method==='POST'&&p==='/api/conversation/build-draft'){
const b=await body(req);const items=Array.isArray(b.items)?b.items:[];const customer=b.customer||{};
const resolved=items.map(i=>{const prod=d.products.find(x=>x.id===i.productId&&x.active);if(!prod)return null;const qty=Math.max(1,Number(i.qty)||1);const unit=Number(prod.price);return {productId:prod.id,name:prod.name,qty,unitPrice:unit,lineTotal:Number((unit*qty).toFixed(2)),addons:i.addons||[]};}).filter(Boolean);
const subtotal=Number(resolved.reduce((a,i)=>a+i.lineTotal,0).toFixed(2));const fee=Number(d.store.deliveryFee||0);const total=Number((subtotal+fee).toFixed(2));
const payment=String(b.paymentMethod||'').toUpperCase();const paid=b.paidValue==null?null:Number(b.paidValue);
const change=paid!=null&&payment==='DINHEIRO'?Number((paid-total).toFixed(2)):null;
const needs=[];if(!resolved.length)needs.push('ITENS');if(!customer.address)needs.push('ENDERECO');if(!payment)needs.push('PAGAMENTO');if(payment==='DINHEIRO'&&paid==null)needs.push('VALOR_PAGO');if(change!=null&&change<0)needs.push('VALOR_PAGO_MAIOR_QUE_TOTAL');
return send(res,200,{status:needs.length?'INCOMPLETE':'READY_FOR_CONFIRMATION',items:resolved,customer,subtotal,deliveryFee:fee,total,paymentMethod:payment||null,paidValue:paid,change,needs,summary:`${resolved.map(i=>i.qty+'x '+i.name).join(' + ')} | Total R$ ${total.toFixed(2)}${change!=null?' | Troco R$ '+change.toFixed(2):''}`});
}if(req.method==='POST'&&p==='/api/conversation/final-confirmation'){
const b=await body(req);if(b.confirmed!==true)return send(res,400,{status:'NOT_CONFIRMED',message:'A confirmação do cliente é necessária'});
if(!b.summary||!b.total)return send(res,400,{status:'INCOMPLETE',message:'Resumo ou total ausente'});
return send(res,200,{status:'CUSTOMER_CONFIRMED',message:'Pedido confirmado pelo cliente. Aplicar o modo de aprovação da loja antes da produção.',summary:b.summary,total:b.total});
}if(req.method==='POST'&&p==='/api/conversation/finalize-order'){
const b=await body(req);if(b.confirmed!==true)return send(res,400,{error:'Confirmação do cliente necessária'});
const draft=b.draft||{};if(!draft.items?.length||!draft.customer?.name||!draft.customer?.phone||!draft.customer?.address)return send(res,400,{error:'Rascunho incompleto'});
const mode=(d.settings&&d.settings.orderApprovalMode)||'OWNER';
const payment=String(draft.paymentMethod||'').toUpperCase();
if(payment==='DINHEIRO'&&(draft.paidValue==null||Number(draft.paidValue)<=Number(draft.total)))return send(res,400,{error:`Informe um valor maior que R$ ${Number(draft.total).toFixed(2)}`});
const clientRequestId=String(b.clientRequestId||crypto.randomUUID());
const existing=d.orders.find(o=>o.clientRequestId===clientRequestId);if(existing)return send(res,200,existing);
const normalized=draft.items.map(i=>{const p=d.products.find(x=>x.id===i.productId&&x.active);if(!p)return null;const addons=(i.addons||[]).map(a=>typeof a==='string'?d.addons.find(x=>x.id===a):a).filter(Boolean);return {productId:p.id,name:p.name,price:Number(p.price),qty:Math.max(1,Number(i.qty)||1),addons:addons.map(a=>({id:a.id,name:a.name,price:Number(a.price)})),unitTotal:Number((Number(p.price)+addons.reduce((a,x)=>a+Number(x.price),0)).toFixed(2))};}).filter(Boolean);
if(!normalized.length)return send(res,400,{error:'Nenhum item válido'});
const subtotal=Number(normalized.reduce((a,i)=>a+i.unitTotal*i.qty,0).toFixed(2)),fee=Number(d.store.deliveryFee||0),total=Number((subtotal+fee).toFixed(2));
if(Math.abs(total-Number(draft.total))>0.01)return send(res,409,{error:'O total mudou. É necessária uma nova confirmação.',expectedTotal:total});
const beverageProducts=new Set(d.products.filter(x=>x.active&&d.categories.find(c=>c.id===x.categoryId&&/bebida/i.test(c.name))).map(x=>x.id));
const beverageItems=normalized.filter(i=>beverageProducts.has(i.productId));
if(beverageItems.length&&!draft.beverageConfirmed)return send(res,400,{error:'Confirme as bebidas do pedido antes de finalizar.'});
const now=new Date().toISOString();
const status=mode==='AUTO'?'ACCEPTED':'AWAITING_STORE_APPROVAL';
const o={id:crypto.randomUUID(),number:String(1000+d.orders.length+1),createdAt:now,clientRequestId,status,statusHistory:[{status,at:now}],customer:{name:String(draft.customer.name).trim(),phone:String(draft.customer.phone).trim(),address:String(draft.customer.address).trim(),reference:String(draft.customer.reference||'').trim()},items:normalized,subtotal,deliveryFee:fee,total,payment:payment==='PIX'?'Pix':payment==='DINHEIRO'?'Dinheiro':(draft.paymentMethod||'Pix'),cashReceived:payment==='DINHEIRO'?Number(draft.paidValue):null,change:payment==='DINHEIRO'?Number((Number(draft.paidValue)-total).toFixed(2)):0,notes:String(draft.notes||'').trim(),beverageConfirmed:Boolean(draft.beverageConfirmed),beverageCheck:{required:beverageItems.length>0,confirmed:Boolean(draft.beverageConfirmed),items:beverageItems.map(i=>({name:i.name,qty:i.qty}))}};
d.orders.unshift(o);ev(d,'CUSTOMER_CONFIRMED_ORDER',{orderId:o.id,approvalMode:mode,total});write(d);if(USE_POSTGRES){try{await persistOrderIfConfigured(o);}catch(e){return send(res,503,{error:'Pedido não persistido no banco; operação bloqueada'});}}return send(res,201,o);
}if(req.method==='GET'&&p==='/api/catalog/availability'){
return send(res,200,{items:d.products.filter(x=>x.active).map(x=>({productId:x.id,name:x.name,available:x.available!==false,stock:x.stock==null?null:Number(x.stock)}))});
}
if(req.method==='PUT'&&p==='/api/catalog/availability'){
const b=await body(req);const x=d.products.find(x=>x.id===b.productId);if(!x)return send(res,404,{error:'Produto não encontrado'});
if(b.stock!=null){const n=Number(b.stock);if(!Number.isFinite(n)||n<0)return send(res,400,{error:'Estoque inválido'});x.stock=n;x.available=n>0}else if(b.available!=null)x.available=Boolean(b.available);
write(d);return send(res,200,{productId:x.id,available:x.available,stock:x.stock==null?null:x.stock});
}
if(req.method==='POST'&&p==='/api/orders/reject'){
const b=await body(req);const o=d.orders.find(x=>x.id===b.orderId);if(!o)return send(res,404,{error:'Pedido não encontrado'});
if(!['AWAITING_STORE_APPROVAL','ACCEPTED','NEW'].includes(o.status))return send(res,400,{error:'Pedido não pode ser recusado'});
const now=new Date().toISOString();o.status='CANCELLED';o.cancellationReason=String(b.reason||'Indisponibilidade operacional');o.updatedAt=now;o.statusHistory=o.statusHistory||[];o.statusHistory.push({status:'CANCELLED',at:now,reason:o.cancellationReason});write(d);return send(res,200,o);
}
if(req.method==='GET'&&p==='/api/operation/summary'){
return send(res,200,{pendingApproval:d.orders.filter(o=>o.status==='AWAITING_STORE_APPROVAL').length,preparing:d.orders.filter(o=>o.status==='PREPARING').length,delivery:d.orders.filter(o=>o.status==='OUT_FOR_DELIVERY').length,unavailableProducts:d.products.filter(x=>x.active&&x.available===false).length});
}
if(req.method==='POST'&&p==='/api/printer/preview'){
const b=await body(req);const o=d.orders.find(x=>x.id===b.orderId);if(!o)return send(res,404,{error:'Pedido não encontrado'});
const lines=['=== BDK DELIVERY ===','PEDIDO #'+o.number,'DATA: '+o.createdAt,'','CLIENTE: '+o.customer.name,'TELEFONE: '+o.customer.phone,'ENDEREÇO: '+o.customer.address];
lines.push('','ITENS DO PEDIDO');
(o.items||[]).forEach(i=>lines.push(`${i.qty}x ${i.name} — R$ ${Number(i.unitTotal*i.qty).toFixed(2)}`));
lines.push('','SUBTOTAL: R$ '+Number(o.subtotal).toFixed(2),'ENTREGA: R$ '+Number(o.deliveryFee).toFixed(2),'TOTAL: R$ '+Number(o.total).toFixed(2),'PAGAMENTO: '+o.payment,'TROCO: R$ '+Number(o.change||0).toFixed(2),'BEBIDAS CONFERIDAS: '+(o.beverageCheck?.confirmed?'SIM':'NÃO'));
if(o.notes)lines.push('OBS: '+o.notes);
return send(res,200,{mode:'PREVIEW',orderId:o.id,printText:lines.join('\n')});
}
if(req.method==='GET'&&p==='/api/printer/status'){
const cfg=(d.settings&&d.settings.printer)||{mode:'PREVIEW',name:null};
return send(res,200,{mode:cfg.mode,name:cfg.name,ready:cfg.mode==='PREVIEW'||Boolean(cfg.name)});
}
if(req.method==='POST'&&p==='/api/store/session'){
const b=await body(req);const user=String(b.user||'').trim();const pin=String(b.pin||'').trim();const expected=(d.settings&&d.settings.demoAccess)||{user:'loja',pin:'1234'};
if(!user||!pin)return send(res,400,{error:'Usuário e PIN são obrigatórios'});
if(user!==expected.user||pin!==expected.pin)return send(res,401,{error:'Acesso inválido'});
return send(res,200,{status:'AUTHENTICATED',role:'OWNER',sessionId:crypto.randomUUID()});
}
if(req.method==='GET'&&p==='/api/health/persistence'){
if(!USE_POSTGRES)return send(res,200,{mode:'LOCAL_DEMO',persistent:false,message:'Banco persistente não configurado'});
try{await dbReady();await pgPool.query('SELECT 1');return send(res,200,{mode:'POSTGRES',persistent:true,healthy:true});}
catch(e){return send(res,503,{mode:'POSTGRES',persistent:true,healthy:false,error:'Banco configurado mas indisponível'});}
}
if(req.method==='GET'&&p==='/api/orders')return send(res,200,d.orders);if(req.method==='GET'&&p==='/api/promotions')return send(res,200,{promotions:d.promotions||[]});if(req.method==='PUT'&&p==='/api/promotions'){const b=await body(req);d.promotions=Array.isArray(b.promotions)?b.promotions.map(x=>({...x,enabled:Boolean(x.enabled),personalized:Boolean(x.personalized)})):[];write(d);return send(res,200,{promotions:d.promotions})}if(req.method==='GET'&&p==='/api/customers'){const by={};d.orders.forEach(o=>{const k=o.customer&&o.customer.phone;if(!k)return;const x=by[k]||(by[k]={name:o.customer.name,phone:k,orders:0,spent:0,lastOrder:null,verified:false});x.orders++;x.spent+=Number(o.total||0);x.lastOrder=!x.lastOrder||o.createdAt>x.lastOrder?o.createdAt:x.lastOrder});const customers=Object.values(by).map(x=>({...x,status:x.orders>=10?'ALTA_FREQUENCIA':x.orders>=3?'RECORRENTE':'BAIXA_FREQUENCIA',promotionEligible:false})).sort((a,b)=>b.orders-a.orders);return send(res,200,{customers})}if(req.method==='GET'&&p==='/api/marketing'){
return send(res,200,{campaigns:d.campaigns||[],distribution:{enabled:false,reason:'requires explicit store approval and verified channel/recipient eligibility'}});
}
if(req.method==='PUT'&&p==='/api/marketing'){
const b=await body(req);
d.campaigns=Array.isArray(b.campaigns)?b.campaigns.map(x=>({...x,status:x.status||'DRAFT',approvedByStore:Boolean(x.approvedByStore),personalized:Boolean(x.personalized)})):[];
write(d);return send(res,200,{campaigns:d.campaigns});
}if(req.method==='GET'&&p==='/api/metrics'){const delivered=d.orders.filter(o=>o.status==='DELIVERED'),revenue=delivered.reduce((s,o)=>s+o.total,0),counts={};d.orders.forEach(o=>o.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));return send(res,200,{orders:d.orders.length,delivered:delivered.length,revenue,avgTicket:delivered.length?revenue/delivered.length:0,topProducts:Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8)})}if(req.method==='POST'&&p==='/api/orders'){const b=await body(req);if(!b.items?.length||!b.customer?.name||!b.customer?.phone||!b.customer?.address)return send(res,400,{error:'Nome, WhatsApp e endereço são obrigatórios'});if(b.clientRequestId&&d.orders.some(o=>o.clientRequestId===b.clientRequestId))return send(res,200,d.orders.find(o=>o.clientRequestId===b.clientRequestId));const normalizedItems=b.items.map(i=>{
const p=d.products.find(x=>x.id===i.productId&&x.active);if(!p)return null;
const qty=Math.max(1,Number(i.qty)||1);
const addonIds=Array.isArray(i.addonIds)?i.addonIds:[];
const addons=addonIds.map(id=>d.addons.find(a=>a.id===id)).filter(Boolean);
const addonTotal=addons.reduce((sum,a)=>sum+Number(a.price),0);
return {productId:p.id,name:p.name,price:Number(p.price),qty,addons:addons.map(a=>({id:a.id,name:a.name,price:Number(a.price)})),unitTotal:Number((Number(p.price)+addonTotal).toFixed(2))};
}).filter(Boolean);if(!normalizedItems.length)return send(res,400,{error:'Nenhum produto válido no pedido'});const subtotal=normalizedItems.reduce((sum,i)=>sum+i.unitTotal*i.qty,0),fee=Number(d.store.deliveryFee),total=subtotal+fee;if(subtotal<d.store.minimumOrder)return send(res,400,{error:`Pedido mínimo: R$ ${d.store.minimumOrder.toFixed(2)}`});const payment=String(b.payment||'cash');const cashReceived=payment==='Dinheiro'?Number(b.cashReceived||0):null;if(payment==='Dinheiro'&&(!cashReceived||cashReceived<=total))return send(res,400,{error:`Informe um valor maior que R$ ${total.toFixed(2)}`});const beverageProducts=new Set(d.products.filter(x=>x.active&&d.categories.find(c=>c.id===x.categoryId&&/bebida/i.test(c.name))).map(x=>x.id));const beverageItems=b.items.filter(i=>beverageProducts.has(i.productId));if(!beverageItems.length&&!b.beverageConfirmation)return send(res,400,{error:'Confirme se o cliente deseja pedido sem bebida.'});const o={id:crypto.randomUUID(),number:String(1000+d.orders.length+1),createdAt:new Date().toISOString(),clientRequestId:String(b.clientRequestId||''),status:'NEW',statusHistory:[{status:'NEW',at:new Date().toISOString()}],customer:{name:String(b.customer.name).trim(),phone:String(b.customer.phone).trim(),address:String(b.customer.address).trim(),reference:String(b.customer.reference||'').trim()},items:normalizedItems,subtotal,deliveryFee:fee,total,payment,cashReceived,change:payment==='Dinheiro'?Number((cashReceived-total).toFixed(2)):0,notes:String(b.notes||'').trim(),beverageConfirmed:Boolean(b.beverageConfirmation)||beverageItems.length>0};d.orders.unshift(o);ev(d,'ORDER_CREATED',{orderId:o.id,total:o.total,itemCount:o.items.length});write(d);return send(res,201,o)}const m=p.match(/^\/api\/orders\/([^/]+)$/);if(req.method==='PATCH'&&m){const b=await body(req),o=d.orders.find(x=>x.id===m[1]);if(!o)return send(res,404,{error:'Pedido não encontrado'});const allowed=['NEW','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];if(!allowed.includes(b.status))return send(res,400,{error:'Status inválido'});if(o.status===b.status)return send(res,200,o);o.status=b.status;o.updatedAt=new Date().toISOString();o.statusHistory=o.statusHistory||[];o.statusHistory.push({status:o.status,at:o.updatedAt});ev(d,'ORDER_STATUS_CHANGED',{orderId:o.id,status:o.status});write(d);return send(res,200,o)}if(req.method==='PUT'&&p==='/api/store'){const b=await body(req);d.store={...d.store,...b};ev(d,'STORE_UPDATED',b);write(d);return send(res,200,d.store)}return send(res,404,{error:'API não encontrada'})}
let file=p==='/'||p==='/gestao'?'/index.html':p;let fp=path.normalize(path.join(ROOT,'public',file));if(!fp.startsWith(path.join(ROOT,'public')))return send(res,403,'forbidden','text/plain');if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){const ext=path.extname(fp),types={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json'};return send(res,200,fs.readFileSync(fp),types[ext]||'application/octet-stream')}return send(res,404,'not found','text/plain')}catch(e){console.error(e);send(res,500,{error:'Erro interno'})}});server.listen(PORT,'0.0.0.0',()=>console.log(`BDK Delivery running on http://0.0.0.0:${PORT}`));
