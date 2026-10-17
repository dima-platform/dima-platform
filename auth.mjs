import {randomUUID,randomBytes,randomInt,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {Fault} from './domain.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
export const memoryAccounts=[
 {phone:'+21600000001',actor:{id:'customer-1',role:'customer'}},
 {phone:'+21600000002',actor:{id:'merchant-1',role:'merchant',storeId:'store-1'}},
 {phone:'+21600000003',actor:{id:'courier-1',role:'courier'}},
 {phone:'+21600000004',actor:{id:'admin-1',role:'admin'}},
];

// Local demonstration only: OTP is returned to the UI for synthetic seed accounts.
// It is NOT proof of phone ownership. No SMS provider is configured.
export class DemoAuth {
 constructor({resolveAccount,now=()=>Date.now(),otp=()=>String(randomInt(100000,1000000)),accessMs=15*60_000,refreshMs=7*86400_000,challengeMs=5*60_000}={}){
  this.resolveAccount=resolveAccount||((phone,role)=>memoryAccounts.find(a=>a.phone===phone&&a.actor.role===role)?.actor);
  this.now=now;this.otp=otp;this.accessMs=accessMs;this.refreshMs=refreshMs;this.challengeMs=challengeMs;
  this.secret=randomBytes(32);this.challenges=new Map();this.sessions=new Map();this.access=new Map();this.refreshTokens=new Map();this.rates=new Map();
 }
 sweep(){
  const now=this.now();
  for(const [key,row]of this.challenges)if(row.expires<=now)this.challenges.delete(key);
  for(const [key,row]of this.sessions)if(row.expires<=now)this.sessions.delete(key);
  for(const [key,row]of this.access)if(row.expires<=now||!this.sessions.has(row.sessionId))this.access.delete(key);
  for(const [key,row]of this.refreshTokens)if(row.expires<=now||!this.sessions.has(row.sessionId))this.refreshTokens.delete(key);
  for(const [key,row]of this.rates)if(row.until<=now)this.rates.delete(key);
 }
 limit(key,max,window){
  const now=this.now();let row=this.rates.get(key);
  if(!row||row.until<=now){if(this.rates.size>=5000&&!row)throw new Fault(429,'Rate limit capacity reached');row={count:0,until:now+window};this.rates.set(key,row);}
  if(row.count>=max)throw new Fault(429,'Too many attempts; try later');row.count++;
 }
 digest(id,code){return createHmac('sha256',this.secret).update(id+':'+code).digest();}
 async challenge(body,ip='local'){
  this.sweep();
  if(typeof body.phone!=='string'||!/^\+216\d{8}$/.test(body.phone)||!['customer','merchant','courier','admin'].includes(body.role))throw new Fault(400,'Invalid phone or role');
  this.limit('issue-ip:'+ip,20,15*60_000);this.limit('issue-phone:'+body.phone,3,15*60_000);
  // Restrict this demonstrator to seed identities; never send messages to real numbers.
  const account=await this.resolveAccount(body.phone,body.role);
  if(!account)throw new Fault(400,'Synthetic development account required');
  if(this.challenges.size>=1000)throw new Fault(429,'Challenge capacity reached');
  for(const c of this.challenges.values())if(c.phone===body.phone){if(this.now()-c.created<30_000)throw new Fault(429,'Wait before requesting another code');}
  for(const [key,c]of this.challenges)if(c.phone===body.phone)this.challenges.delete(key);
  const id=randomUUID(),code=this.otp(),created=this.now();
  this.challenges.set(id,{phone:body.phone,role:body.role,digest:this.digest(id,code),attempts:0,created,expires:created+this.challengeMs,used:false});
  return {challengeId:id,expiresIn:Math.floor(this.challengeMs/1000),demoCode:code,mode:'synthetic-demo'};
 }
 async verify(body,ip='local'){
  this.sweep();this.limit('verify-ip:'+ip,50,15*60_000);
  if(typeof body.challengeId!=='string'||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))throw new Fault(400,'Six digit code required');
  const c=this.challenges.get(body.challengeId);
  if(!c||c.used||c.expires<=this.now())throw new Fault(401,'Code expired or already used');
  if(c.attempts>=5)throw new Fault(429,'Code attempt limit reached');
  c.attempts++;
  if(!timingSafeEqual(c.digest,this.digest(body.challengeId,body.code)))throw new Fault(401,'Invalid code');
  // Consume before awaiting account lookup, preventing simultaneous successful verification.
  c.used=true;
  const actor=await this.resolveAccount(c.phone,c.role);
  if(!actor)throw new Fault(403,'Account role unavailable');
  if(this.sessions.size>=1000)throw new Fault(429,'Session capacity reached');
  const session={id:randomUUID(),phone:c.phone,role:c.role,expires:this.now()+this.refreshMs,revoked:false};
  this.sessions.set(session.id,session);return this.issue(session,actor);
 }
 issue(session,actor){
  const accessToken=token(),refreshToken=token(),now=this.now();
  this.access.set(hash(accessToken),{sessionId:session.id,expires:Math.min(now+this.accessMs,session.expires)});
  this.refreshTokens.set(hash(refreshToken),{sessionId:session.id,expires:session.expires,used:false});
  return {accessToken,refreshToken,tokenType:'Bearer',expiresIn:Math.floor(Math.min(this.accessMs,session.expires-now)/1000),refreshExpiresIn:Math.floor((session.expires-now)/1000),actor:{...actor},mode:'synthetic-demo'};
 }
 revoke(sessionId){const session=this.sessions.get(sessionId);if(session)session.revoked=true;for(const [key,row]of this.access)if(row.sessionId===sessionId)this.access.delete(key);}
 async authenticate(raw){
  this.sweep();if(typeof raw!=='string'||raw.length>128)throw new Fault(401,'Session required');
  const entry=this.access.get(hash(raw)),session=entry&&this.sessions.get(entry.sessionId);
  if(!entry||entry.expires<=this.now()||!session||session.revoked||session.expires<=this.now())throw new Fault(401,'Session expired or revoked');
  const actor=await this.resolveAccount(session.phone,session.role);
  if(!actor){this.revoke(session.id);throw new Fault(401,'Account role unavailable');}
  // A concurrent refresh/logout during lookup invalidates the token too.
  if(session.revoked||!this.access.has(hash(raw)))throw new Fault(401,'Session revoked');
  return {...actor};
 }
 async refresh(body,ip='local'){
  this.sweep();this.limit('refresh-ip:'+ip,60,15*60_000);
  if(typeof body.refreshToken!=='string'||body.refreshToken.length>128)throw new Fault(401,'Invalid refresh token');
  const entry=this.refreshTokens.get(hash(body.refreshToken)),session=entry&&this.sessions.get(entry.sessionId);
  if(!entry||!session||session.revoked||session.expires<=this.now())throw new Fault(401,'Invalid refresh token');
  if(entry.used){this.revoke(session.id);throw new Fault(401,'Refresh reuse detected; sign in again');}
  entry.used=true;
  for(const [key,row]of this.access)if(row.sessionId===session.id)this.access.delete(key);
  const actor=await this.resolveAccount(session.phone,session.role);
  if(!actor)throw new Fault(401,'Account role unavailable');
  // Keep the absolute expiry; rotation must not create an unlimited session lifetime.
  // A replay while lookup awaits revokes the entire family.
  if(session.revoked)throw new Fault(401,'Session revoked during refresh');
  return this.issue(session,actor);
 }
 async logout(raw){
  if(typeof raw!=='string')return;
  const entry=this.access.get(hash(raw));if(entry)this.revoke(entry.sessionId);
 }
}
