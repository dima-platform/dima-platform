import {Fault} from './errors.mjs';
export const normalizeSearch=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[أإآٱ]/g,'ا').toLowerCase().trim();
export function browseCatalog(stores,params){
 const q=(params.get('q')||'').trim(),category=params.get('category')||'';
 if(q.length>80||category&&!['restaurants','groceries'].includes(category))throw new Fault(400,'Invalid catalog search');
 const needle=normalizeSearch(q);
 return stores.filter(s=>(!category||s.category===category)&&(!needle||[s.name,s.nameFr,...s.products.flatMap(p=>[p.name,p.nameFr])].some(value=>typeof value==='string'&&normalizeSearch(value).includes(needle))));
}
