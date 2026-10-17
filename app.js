// Session tokens live only in this tab's memory; no localStorage or cookies.
let role=({'/merchant':'merchant','/admin':'admin','/courier':'courier'})[location.pathname.replace(/\/$/,'')]||'customer';
let demoPassword=null;
let lang='ar',stores=[],cart=[],selected=null,pendingKey=null,session=null,challenge=null,refreshing=null,busy=false,view=0,operationsView=0;
let savedAddresses=[],deliveryAddressId=null,addressEditing=null,addressView=0;
let visibleStores=[],searchView=0,storeView=0,productDraft=null;
const $=id=>document.getElementById(id),money=n=>(n/1000).toFixed(3)+' TND';
const labels={customer:['العميل','Client'],courier:['المندوب','Livreur'],merchant:['المتجر','Commerce'],admin:['الإدارة','Administration']};
const phones={customer:'+21600000001',merchant:'+21600000002',courier:'+21600000003',admin:'+21600000004'};
const states={placed:['جديد','Nouvelle'],accepted:['مقبول','Acceptée'],preparing:['قيد التحضير','En préparation'],ready:['جاهز','Prête'],assigned:['تم الإسناد','Attribuée'],picked_up:['في الطريق','En livraison'],delivered:['تم التسليم','Livrée'],cancelled:['ملغى','Annulée']};
const tr=(ar,fr)=>lang==='ar'?ar:fr;
const state=s=>states[s]?.[lang==='ar'?0:1]||s;
const name=p=>lang==='fr'?(p.nameFr||p.name):p.name;
function el(tag,text,parent){const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
function note(e){$('notice').textContent=e.message||e;}
async function raw(path,{body,token,headers={}}={}){
 if(['/auth/challenges','/auth/verify'].includes(path)){
  if(demoPassword===null&&window.DIMA_HOSTED_DEMO)demoPassword=prompt('كلمة مرور التجربة المشتركة / Mot de passe du test')||'';
  if(demoPassword)headers={...headers,'X-Dima-Demo-Password':demoPassword};
 }
 const r=await fetch('/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const j=await r.json();if(!r.ok){if(r.status===401&&['/auth/challenges','/auth/verify'].includes(path))demoPassword=null;const e=Error(j.error?.message||'Request failed');e.status=r.status;throw e;}return j.data;
}
function clearSession(){session=null;challenge=null;view++;operationsView++;addressView++;storeView++;productDraft=null;$('store-detail').hidden=true;savedAddresses=[];deliveryAddressId=null;addressEditing=null;renderAddresses();$('order-detail').replaceChildren();$('order-detail').hidden=true;$('operations').replaceChildren();$('operations').hidden=true;$('otp').value='';$('demo-code').textContent='';renderAuth();renderCart();$('orders').replaceChildren();}
async function renew(){
 if(!session)throw Error(tr('سجّل الدخول أولًا','Connectez-vous'));
 if(!refreshing){const current=session;refreshing=raw('/auth/refresh',{body:{refreshToken:current.refreshToken}}).then(next=>{if(session!==current)throw Error('Session changed');session=next;}).catch(e=>{if(session===current)clearSession();throw e;}).finally(()=>refreshing=null);}
 return refreshing;
}
async function api(path,options={}){
 if(!session)throw Error(tr('سجّل الدخول أولًا','Connectez-vous'));
 const current=session;
 try{return await raw(path,{...options,token:current.accessToken});}
 catch(e){if(e.status!==401)throw e;if(session!==current)throw e;await renew();return raw(path,{...options,token:session.accessToken});}
}
function setBusy(value){busy=value;$('address').disabled=value;$('lang').disabled=value;for(const input of $('operations').querySelectorAll('input,button'))input.disabled=value;for(const input of $('catalog-search').querySelectorAll('input,button,select'))input.disabled=value;for(const input of $('store-detail').querySelectorAll('button'))input.disabled=value;for(const input of $('address-manager').querySelectorAll('input,button,select'))input.disabled=value||!session;renderRoles();renderAuth();renderCart();renderStores();}
async function searchCatalog(){const current=++searchView;try{const params=new URLSearchParams({q:$('search-query').value,category:$('search-category').value}),rows=await raw('/stores?'+params);if(current!==searchView)return;visibleStores=rows;$('search-status').textContent=tr('عدد المتاجر: ','Commerces : ')+rows.length;renderStores();}catch(e){if(current===searchView)note(e);}}
function addToCart(s,p){if(busy)return;if(selected&&selected.id!==s.id&&cart.length)return note(tr('أفرغ سلة المتجر الحالي أولًا','Videz le panier actuel'));if(!cart.length)selected=s;const item=cart.find(i=>i.id===p.id);if(item&&item.quantity>=20)return;item?item.quantity++:cart.push({...p,quantity:1});pendingKey=null;renderCart();}
async function showStore(id){const current=++storeView;try{const s=await raw('/stores/'+encodeURIComponent(id));if(current!==storeView||role!=='customer')return;const box=$('store-detail');box.replaceChildren();box.hidden=false;el('h2',name(s),box);el('p',tr('ولاية نابل · رسوم التوصيل ','Nabeul · Livraison ')+money(s.deliveryMilli),box);if(!s.products.length)el('p',tr('لا توجد منتجات متوفرة حاليًا','Aucun produit disponible'),box);for(const p of s.products){const row=el('p',name(p)+' · '+money(p.priceMilli)+' ',box),b=el('button','+',row);b.disabled=busy;b.setAttribute('aria-label',tr('إضافة ','Ajouter ')+name(p));b.onclick=()=>addToCart(s,p);}const close=el('button',tr('عودة للمتاجر','Retour aux commerces'),box);close.onclick=()=>{box.hidden=true;history.replaceState(null,'','/');};history.replaceState(null,'','/store/'+encodeURIComponent(s.id));box.scrollIntoView({behavior:'smooth'});}catch(e){if(current===storeView)note(e);}}
function renderAddresses(){
 const list=$('saved-address');list.replaceChildren();for(const a of savedAddresses){const option=el('option',a.label+' · '+tr(a.serviceable?'داخل النطاق المرجعي':'خارج النطاق',a.serviceable?'Dans la zone de référence':'Hors zone'),list);option.value=a.id;}
 list.value=deliveryAddressId||'';const selectedAddress=savedAddresses.find(a=>a.id===deliveryAddressId);$('address').value=selectedAddress?selectedAddress.text:tr('اختر عنوانًا محفوظًا','Choisissez une adresse');
 for(const input of $('address-manager').querySelectorAll('input,button,select'))input.disabled=busy||!session;
 $('edit-address').disabled=busy||!selectedAddress;$('archive-address').disabled=busy||!selectedAddress;$('save-address').textContent=addressEditing?tr('حفظ تعديل العنوان','Enregistrer la modification'):tr('حفظ عنوان جديد','Ajouter une adresse');renderCart();
}
async function loadAddresses(){const current=++addressView;if(!session||role!=='customer'){savedAddresses=[];deliveryAddressId=null;renderAddresses();return;}try{const prior=savedAddresses.find(a=>a.id===deliveryAddressId);const rows=await api('/addresses');if(current!==addressView)return;savedAddresses=rows;if(!rows.some(a=>a.id===deliveryAddressId))deliveryAddressId=(rows.find(a=>a.serviceable)||rows[0])?.id||null;const next=savedAddresses.find(a=>a.id===deliveryAddressId);if(prior?.id!==next?.id||prior?.version!==next?.version)pendingKey=null;renderAddresses();}catch(e){if(current===addressView)note(e);}}
async function showDetail(id){const identity=session;try{const o=await api('/orders/'+id);if(session!==identity)return;const box=$('order-detail');box.replaceChildren();box.hidden=false;el('h2',tr('تفاصيل الطلب · ','Détail · ')+o.id.slice(0,8),box);el('p',state(o.status),box);if(o.address)el('p',o.address,box);for(const item of o.items||[])el('p',name(item)+' × '+item.quantity+' · '+money(item.priceMilli*item.quantity),box);if(o.totalMilli!==undefined)el('strong',tr('الإجمالي ','Total ')+money(o.totalMilli),box);for(const event of o.events||[])el('p',state(event.status)+' · '+new Date(event.at).toLocaleString(lang==='ar'?'ar-TN':'fr-TN',{timeZone:'Africa/Tunis'}),box);const close=el('button',tr('إغلاق التفاصيل','Fermer'),box);close.onclick=()=>box.hidden=true;box.scrollIntoView({behavior:'smooth'});}catch(e){note(e);}}
async function loadCatalog(){
 try{stores=await raw('/stores');const priorItems=JSON.stringify(cart.map(i=>[i.id,i.quantity]));if(selected){const current=stores.find(s=>s.id===selected.id);if(!current){selected=null;cart=[];}else{selected=current;cart=cart.flatMap(i=>{const fresh=current.products.find(p=>p.id===i.id);return fresh?[{...fresh,quantity:i.quantity}]:[];});}}if(priorItems!==JSON.stringify(cart.map(i=>[i.id,i.quantity])))pendingKey=null;await searchCatalog();renderCart();}catch(e){note(e);}
}
function priceValue(input){const value=input.value.trim().replace(',','.');if(!/^\d+(\.\d{1,3})?$/.test(value))throw Error(tr('أدخل مبلغًا صحيحًا بثلاثة أرقام عشرية كحد أقصى','Montant invalide, trois décimales maximum'));const [whole,fraction='']=value.split('.');const n=Number(whole)*1000+Number(fraction.padEnd(3,'0'));if(!Number.isSafeInteger(n))throw Error('Invalid amount');return n;}
function checkbox(parent,label,checked){const line=el('label','',parent),input=el('input','',line);input.type='checkbox';input.checked=checked;input.disabled=busy;line.append(document.createTextNode(label));return input;}
function amount(parent,label,milli){const line=el('label',label,parent),input=el('input','',line);input.inputMode='decimal';input.value=(milli/1000).toFixed(3);input.disabled=busy;input.dir='ltr';return input;}
function textField(parent,label,value=''){const line=el('label',label,parent),input=el('input','',line);input.value=value;input.maxLength=120;input.required=true;input.disabled=busy;return input;}
function submitButton(form){const b=el('button',tr('حفظ التعديل','Enregistrer'),form);b.type='submit';b.disabled=busy;}
async function saveOperation(path,body){if(busy)return;setBusy(true);try{await api(path,{body});note(tr('تم حفظ التعديل','Modification enregistrée'));}catch(e){note(e);}finally{setBusy(false);await Promise.all([loadOperations(),loadCatalog(),loadOrders()]);}}
async function loadOperations(){
 const current=++operationsView,box=$('operations');box.replaceChildren();box.hidden=!session||!['merchant','admin'].includes(role);if(box.hidden)return;
 try{
  const data=await api(role==='merchant'?'/merchant/store':'/admin/overview');if(current!==operationsView)return;
  if(role==='merchant'){
   const card=el('article','',box);card.className='card';el('h2',tr('إدارة المتجر · ','Gestion du commerce · ')+name(data),card);
   el('p',data.enabled?tr('المتجر مفعّل إداريًا','Commerce autorisé'):tr('المتجر معلق إداريًا؛ فتحه لا يعيد تفعيله','Commerce suspendu par l’administration'),card);
   const form=el('form','',card);form.className='ops-form';const open=checkbox(form,tr('استقبال طلبات جديدة','Accepter de nouvelles commandes'),data.isOpen);submitButton(form);form.onsubmit=e=>{e.preventDefault();saveOperation('/merchant/store/status',{isOpen:open.checked,version:data.version});};
   const create=el('form','',card);create.className='ops-form';el('h3',tr('إضافة منتج جديد','Ajouter un produit'),create);const draft=productDraft?.body||{},newName=textField(create,tr('الاسم بالعربية','Nom arabe'),draft.name||''),newFrench=textField(create,tr('الاسم بالفرنسية','Nom français'),draft.nameFr||''),newPrice=amount(create,tr('السعر بالدينار','Prix en TND'),draft.priceMilli||0),newAvailable=checkbox(create,tr('إتاحته للعملاء','Visible pour les clients'),draft.available||false);submitButton(create);create.onsubmit=async e=>{e.preventDefault();if(busy)return;try{const body={name:newName.value,nameFr:newFrench.value,priceMilli:priceValue(newPrice),available:newAvailable.checked};if(!productDraft||JSON.stringify(productDraft.body)!==JSON.stringify(body))productDraft={requestId:crypto.randomUUID(),body};setBusy(true);try{await api('/merchant/products',{body:{requestId:productDraft.requestId,...body}});productDraft=null;note(tr('تمت إضافة المنتج','Produit ajouté'));}catch(error){note(error);}finally{setBusy(false);await Promise.all([loadOperations(),loadCatalog()]);}}catch(error){note(error);}};
   for(const p of data.products){const product=el('form','',card);product.className='ops-form';el('h3',name(p),product);const ar=textField(product,tr('الاسم بالعربية','Nom arabe'),p.name),fr=textField(product,tr('الاسم بالفرنسية','Nom français'),p.nameFr||p.name),price=amount(product,tr('السعر بالدينار التونسي','Prix en TND'),p.priceMilli),available=checkbox(product,tr('المنتج متوفر','Produit disponible'),p.available);submitButton(product);product.onsubmit=e=>{e.preventDefault();try{saveOperation('/merchant/products/'+p.id,{name:ar.value,nameFr:fr.value,priceMilli:priceValue(price),available:available.checked,version:p.version});}catch(error){note(error);}};}
  }else{
   const merchants=el('article','',box);merchants.className='card';el('h2',tr('المتاجر ورسوم التوصيل','Commerces et frais de livraison'),merchants);
   for(const s of data.stores){const form=el('form','',merchants);form.className='ops-form';el('h3',name(s),form);const enabled=checkbox(form,tr('السماح بظهور المتجر واستقبال الطلبات','Autoriser le commerce'),s.enabled),fee=amount(form,tr('رسوم التوصيل بالدينار','Livraison en TND'),s.deliveryMilli);submitButton(form);form.onsubmit=e=>{e.preventDefault();try{saveOperation('/admin/stores/'+s.id,{enabled:enabled.checked,deliveryMilli:priceValue(fee),version:s.version});}catch(error){note(error);}};}
   const couriers=el('article','',box);couriers.className='card';el('h2',tr('المندوبون','Livreurs'),couriers);
   for(const c of data.couriers){const form=el('form','',couriers);form.className='ops-form';el('h3',c.id,form);const verified=checkbox(form,tr('مسموح باستلام توصيلات جديدة','Autorisé à recevoir de nouvelles courses'),c.verified),available=checkbox(form,tr('متاح للتوصيل','Disponible'),c.available);submitButton(form);form.onsubmit=e=>{e.preventDefault();saveOperation('/admin/couriers/'+c.id,{verified:verified.checked,available:available.checked,version:c.version});};}
   const audit=el('article','',box);audit.className='card';el('h2',tr('آخر 50 تعديلًا','50 dernières modifications'),audit);
   if(!data.recentAudit.length)el('p',tr('لا توجد تعديلات بعد','Aucune modification'),audit);
   for(const event of data.recentAudit){const p=el('p',event.action+' · '+event.targetId,audit);el('small',new Date(event.at).toLocaleString(lang==='ar'?'ar-TN':'fr-TN',{timeZone:'Africa/Tunis'})+' · '+event.actorId,p);}
  }
 }catch(e){if(current===operationsView)note(e);}
}
function renderRoles(){
 $('roles').replaceChildren();
 for(const [key,value]of Object.entries(labels)){
  const b=el('button',value[lang==='ar'?0:1],$('roles'));b.disabled=role===key||busy;
  b.onclick=async()=>{setBusy(true);try{if(session)await api('/auth/logout',{body:{}});}catch(e){note(e);}finally{clearSession();role=key;setBusy(false);$('customer').hidden=role!=='customer';note(tr('اختر طلب رمز الدخول التجريبي','Demandez un code de démonstration'));}};
 }
}
function renderAuth(){
 $('phone').value=phones[role];$('issue-code').disabled=busy||!!session;$('verify-code').disabled=busy||!challenge||!!session;$('otp').disabled=busy||!challenge;
 $('logout').disabled=busy||!session;$('auth-status').textContent=session?tr('مسجل: ','Connecté : ')+labels[session.actor.role][lang==='ar'?0:1]:tr('حساب تجريبي فقط · لا تُرسل رسائل SMS','Compte fictif · aucun SMS envoyé');
}
function renderCart(){
 $('cart').replaceChildren();
 for(const item of cart){const p=el('p',name(item)+' × '+item.quantity+' — '+money(item.priceMilli*item.quantity),$('cart'));const b=el('button','−',p);b.disabled=busy;b.onclick=()=>{item.quantity--;cart=cart.filter(i=>i.quantity);pendingKey=null;renderCart();};}
 $('total').textContent=cart.length?money(cart.reduce((n,i)=>n+i.priceMilli*i.quantity,selected.deliveryMilli))+' · '+tr('التوصيل ','Livraison ')+money(selected.deliveryMilli):tr('السلة فارغة','Panier vide');
 $('checkout').disabled=busy||!cart.length||!session||!savedAddresses.some(a=>a.id===deliveryAddressId&&a.serviceable)||addressEditing!==null;
}
function renderStores(){
 $('stores').replaceChildren();
 if(!visibleStores.length)el('p',tr('لا توجد متاجر تطابق البحث','Aucun commerce ne correspond'),$('stores'));
 for(const s of visibleStores){const c=el('article','',$('stores'));c.className='card';el('span',s.category==='restaurants'?'◉ RESTAURANTS':'▣ COURSES',c).className='tag';el('h2',name(s),c);el('p',tr('توصيل تجريبي · ','Livraison démo · ')+money(s.deliveryMilli),c);const detail=el('button',tr('عرض المتجر','Voir le commerce'),c);detail.disabled=busy;detail.onclick=()=>showStore(s.id);
  for(const p of s.products){const row=el('p',name(p)+' · '+money(p.priceMilli)+' ',c),b=el('button','+',row);b.disabled=busy;b.setAttribute('aria-label',tr('إضافة ','Ajouter ')+name(p));b.onclick=()=>addToCart(s,p);}
 }
}
async function loadOrders(){
 const current=++view;$('orders').replaceChildren();
 if(!session){el('p',tr('سجّل الدخول لعرض الطلبات','Connectez-vous pour voir les commandes'),$('orders'));return;}
 try{
  const rows=await api('/orders');if(current!==view)return;
  if(!rows.length)el('p',tr('لا توجد طلبات','Aucune commande'),$('orders'));
  for(const o of rows){const card=el('div','',$('orders'));card.className='order';el('strong',o.id.slice(0,8)+' · '+state(o.status),card);if(o.totalMilli!==undefined)el('p',money(o.totalMilli)+' · '+o.address,card);const detail=el('button',tr('تفاصيل الطلب','Détails'),card);detail.onclick=()=>showDetail(o.id);
   const next=role==='merchant'?({placed:['accepted','cancelled'],accepted:['preparing'],preparing:['ready']}[o.status]||[]):role==='courier'?({ready:['assigned'],assigned:['picked_up'],picked_up:['delivered']}[o.status]||[]):role==='customer'&&o.status==='placed'?['cancelled']:[];
   for(const status of next){const b=el('button',state(status),card);b.disabled=busy;b.onclick=async()=>{setBusy(true);try{await api('/orders/'+o.id+'/status',{body:{status,version:o.version}});}catch(e){note(e);}finally{setBusy(false);await loadOrders();}};}
  }
 }catch(e){if(current===view)note(e);}
}
$('issue-code').onclick=async()=>{
 setBusy(true);try{challenge=await raw('/auth/challenges',{body:{phone:phones[role],role}});$('demo-code').textContent=tr('رمز تجريبي ظاهر للاختبار: ','Code de démonstration : ')+challenge.demoCode;note(tr('أدخل الرمز الظاهر ثم أكد الدخول','Saisissez le code affiché puis confirmez'));}catch(e){note(e);}finally{setBusy(false);}
};
$('verify-code').onclick=async()=>{
 if(!challenge)return;setBusy(true);try{session=await raw('/auth/verify',{body:{challengeId:challenge.challengeId,code:$('otp').value.trim()}});challenge=null;$('demo-code').textContent='';$('otp').value='';note(tr('تم الدخول التجريبي','Connexion de démonstration réussie'));}catch(e){note(e);}finally{setBusy(false);await Promise.all([loadOrders(),loadOperations(),loadAddresses()]);}
};
$('logout').onclick=async()=>{setBusy(true);try{await api('/auth/logout',{body:{}});}catch(e){note(e);}finally{clearSession();setBusy(false);await loadOrders();}};
$('checkout').onclick=async()=>{
 const address=savedAddresses.find(a=>a.id===deliveryAddressId);if(busy||!session||!cart.length||!address?.serviceable)return;pendingKey??=crypto.randomUUID();setBusy(true);
 try{await api('/orders',{headers:{'Idempotency-Key':pendingKey},body:{storeId:selected.id,addressId:address.id,addressVersion:address.version,quoteTotalMilli:cart.reduce((n,i)=>n+i.priceMilli*i.quantity,selected.deliveryMilli),items:cart.map(i=>({productId:i.id,quantity:i.quantity}))}});cart=[];pendingKey=null;note(tr('تم إنشاء الطلب التجريبي','Commande de démonstration créée'));}catch(e){note(e);if([400,404,409,422].includes(e.status))await Promise.all([loadCatalog(),loadAddresses()]);}finally{setBusy(false);await loadOrders();}
};
$('saved-address').onchange=()=>{deliveryAddressId=$('saved-address').value;pendingKey=null;renderAddresses();};
$('edit-address').onclick=()=>{const a=savedAddresses.find(a=>a.id===deliveryAddressId);if(!a)return;addressEditing={id:a.id,version:a.version};$('address-label').value=a.label;$('address-text').value=a.text;$('latitude').value=a.latitude;$('longitude').value=a.longitude;renderAddresses();};
$('cancel-address-edit').onclick=()=>{addressEditing=null;renderAddresses();};
$('address-form').onsubmit=async e=>{e.preventDefault();if(busy||!session)return;const lat=$('latitude').value.trim(),lon=$('longitude').value.trim();if(!lat||!lon)return note(tr('الإحداثيات مطلوبة','Coordonnées requises'));const body={label:$('address-label').value,text:$('address-text').value,latitude:Number(lat),longitude:Number(lon),...(addressEditing?{version:addressEditing.version}:{})};setBusy(true);try{const a=await api('/addresses'+(addressEditing?'/'+addressEditing.id:''),{body});deliveryAddressId=a.id;addressEditing=null;pendingKey=null;note(tr('تم حفظ العنوان','Adresse enregistrée'));}catch(error){note(error);}finally{setBusy(false);await loadAddresses();}};
$('archive-address').onclick=async()=>{const a=savedAddresses.find(a=>a.id===deliveryAddressId);if(!a||busy)return;setBusy(true);try{await api('/addresses/'+a.id+'/archive',{body:{version:a.version}});pendingKey=null;addressEditing=null;}catch(e){note(e);}finally{setBusy(false);await loadAddresses();}};
$('refresh').onclick=()=>Promise.all([loadOrders(),loadOperations(),loadCatalog(),loadAddresses()]);
$('catalog-search').onsubmit=e=>{e.preventDefault();searchCatalog();};
$('lang').onchange=()=>{
 lang=$('lang').value;document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 $('headline').textContent=tr('يومك أسهل مع DIMA','Votre quotidien, livré.');$('intro').textContent=tr('مطاعم ومقاضي من حيك. ابدأ بطلب تجريبي وتابع رحلته بين المتجر والمندوب.','Restaurants et courses de votre quartier. Suivez une commande de démonstration.');$('eyebrow').textContent=tr('قريب منك، في كل مشوار','Toujours plus proche de vous');$('ordersTitle').textContent=tr('الطلبات','Commandes');$('cartTitle').textContent=tr('سلة الطلب','Panier');$('addressLabel').textContent=tr('عنوان التوصيل التجريبي','Adresse de démonstration');$('checkout').textContent=tr('تأكيد الطلب · نقدًا عند الاستلام','Commander · Paiement à la livraison');$('issue-code').textContent=tr('طلب رمز تجريبي','Demander un code');$('verify-code').textContent=tr('تأكيد الدخول','Se connecter');$('logout').textContent=tr('تسجيل الخروج','Se déconnecter');renderRoles();renderAuth();renderCart();renderStores();loadOrders();loadOperations();
};
renderRoles();renderAuth();renderCart();renderAddresses();$('customer').hidden=role!=='customer';
loadCatalog();loadOrders();
if(location.pathname.startsWith('/store/'))showStore(location.pathname.slice(7));
fetch('/health').then(r=>{if(!r.ok)throw Error('Health check failed');return r.json();}).then(data=>{$('demo').textContent=data.mode==='demo-postgres'?'نسخة تجريبية · PostgreSQL · الجلسات مؤقتة في الذاكرة':'نسخة تجريبية · الطلبات والجلسات مؤقتة في الذاكرة';}).catch(note);

$('lang').addEventListener('change',()=>{if(location.pathname.startsWith('/store/')&&!$('store-detail').hidden)showStore(location.pathname.slice(7));});
let polling=false;
setInterval(async()=>{if(polling||busy||!session||document.hidden)return;polling=true;try{await loadOrders();}finally{polling=false;}},5000);
