import os, re, json, time, uuid, hmac, hashlib, secrets, sqlite3, base64, socket, ipaddress
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode, parse_qs
from urllib.request import Request, build_opener, HTTPHandler, HTTPRedirectHandler
from urllib.error import URLError
from fastapi import FastAPI, Request as FRequest, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.getenv("QT_DB_PATH", "/var/lib/qingtianpay/qingtianpay.sqlite3")
APP_ID = os.getenv("ALIPAY_APP_ID", "")
ALIPAY_SELLER_ID = os.getenv("ALIPAY_SELLER_ID", "")
ALIPAY_NOTIFY_URL = os.getenv("ALIPAY_NOTIFY_URL", "https://pay-api.lynli.me/api/alipay/notify")
APP_PRIVATE_KEY_FILE = os.getenv("ALIPAY_PRIVATE_KEY_FILE", "/etc/qingtianpay/app_private_key.pem")
ALIPAY_PUBLIC_KEY_FILE = os.getenv("ALIPAY_PUBLIC_KEY_FILE", "/etc/qingtianpay/alipay_public_key.pem")
ALIPAY_GATEWAY = os.getenv("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")
BOOTSTRAP_SECRET = os.getenv("BOOTSTRAP_SECRET", "")
DELIVERY_SECRET = os.getenv("DELIVERY_SIGNING_SECRET", "")
COOKIE_NAME = "qt_session"
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None
app = FastAPI(title="Qingtian Payment API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["https://pay.lynli.me"], allow_credentials=True, allow_methods=["GET","POST","PATCH","OPTIONS"], allow_headers=["Content-Type","Authorization","X-Bootstrap-Secret"])

def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c=sqlite3.connect(DB_PATH, timeout=20); c.row_factory=sqlite3.Row; c.execute("PRAGMA foreign_keys=ON"); c.execute("PRAGMA journal_mode=WAL"); return c
def uid(): return uuid.uuid4().hex
def rows(cur): return [dict(x) for x in cur.fetchall()]
def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def site_delivery_secret(site_id):
    if not DELIVERY_SECRET: raise RuntimeError("delivery_secret_not_configured")
    return hmac.new(DELIVERY_SECRET.encode(),("qingtianpay:site:"+site_id).encode(),hashlib.sha256).hexdigest()
def pw_hash(p, salt=None):
    salt=salt or secrets.token_bytes(16); dk=hashlib.scrypt(p.encode(),salt=salt,n=2**14,r=8,p=1,dklen=32); return "scrypt$"+base64.b64encode(salt).decode()+"$"+base64.b64encode(dk).decode()
def pw_ok(p, stored):
    try:
        _,s,d=stored.split("$"); return hmac.compare_digest(hashlib.scrypt(p.encode(),salt=base64.b64decode(s),n=2**14,r=8,p=1,dklen=32),base64.b64decode(d))
    except Exception: return False
def init_db():
    c=db()
    for f in ("0001_initial_schema.sql","0002_security_bootstrap.sql","0003_refund_concurrency_guard.sql"):
        p=os.path.join(ROOT,"migrations",f)
        if os.path.exists(p): c.executescript(open(p).read())
    c.commit(); c.close()
def audit(c, actor, action, typ=None, rid=None, result="success", detail=None):
    c.execute("INSERT INTO audit_logs(id,actor_admin_id,action,resource_type,resource_id,result,detail_json) VALUES(?,?,?,?,?,?,?)",(uid(),actor,action,typ,rid,result,json.dumps(detail or {},ensure_ascii=False)))
def admin_for(req,c):
    token=req.cookies.get(COOKIE_NAME)
    if not token: return None
    x=c.execute("SELECT s.id session_id,a.id,a.email,a.role,a.status FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND a.status='active'",(digest(token),)).fetchone()
    if x: c.execute("UPDATE admin_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?",(x["session_id"],))
    return dict(x) if x else None
def need_admin(req,c,write=False):
    a=admin_for(req,c)
    if not a: raise HTTPException(401,"unauthorized")
    if write and a["role"]=="viewer": raise HTTPException(403,"read_only")
    return a
def json_body(v): return v if isinstance(v,dict) else {}
def read_key(path):
    if not os.path.isfile(path): raise RuntimeError("alipay_key_not_configured")
    return open(path,"rb").read()
def sign_alipay(params):
    # Alipay RSA2 canonical string excludes both sign and sign_type.
    text="&".join(f"{k}={params[k]}" for k in sorted(params) if k not in ("sign","sign_type") and params[k] not in (None,""))
    key=serialization.load_pem_private_key(read_key(APP_PRIVATE_KEY_FILE),password=None)
    return base64.b64encode(key.sign(text.encode(),padding.PKCS1v15(),hashes.SHA256())).decode()
def verify_alipay(params):
    if params.get("app_id")!=APP_ID or params.get("sign_type")!="RSA2" or not params.get("sign"): return False
    data={k:v for k,v in params.items() if k not in ("sign","sign_type") and v not in (None,"")}
    text="&".join(f"{k}={data[k]}" for k in sorted(data))
    pem=read_key(ALIPAY_PUBLIC_KEY_FILE)
    key=serialization.load_pem_public_key(pem) if b"BEGIN" in pem else serialization.load_pem_public_key(b"-----BEGIN PUBLIC KEY-----\n"+pem.strip()+b"\n-----END PUBLIC KEY-----")
    try: key.verify(base64.b64decode(params["sign"]),text.encode(),padding.PKCS1v15(),hashes.SHA256()); return True
    except Exception: return False
def alipay_page_url(method,biz,return_url):
    if not APP_ID: raise RuntimeError("alipay_app_id_not_configured")
    p={"app_id":APP_ID,"method":method,"format":"JSON","charset":"utf-8","sign_type":"RSA2","timestamp":time.strftime("%Y-%m-%d %H:%M:%S"),"version":"1.0","notify_url":ALIPAY_NOTIFY_URL,"return_url":return_url,"biz_content":json.dumps(biz,ensure_ascii=False,separators=(",",":"))}
    p["sign"]=sign_alipay(p)
    return ALIPAY_GATEWAY+"?"+urlencode(p)

def alipay(method,biz):
    if not APP_ID: raise RuntimeError("alipay_app_id_not_configured")
    p={"app_id":APP_ID,"method":method,"format":"JSON","charset":"utf-8","sign_type":"RSA2","timestamp":time.strftime("%Y-%m-%d %H:%M:%S"),"version":"1.0","notify_url":ALIPAY_NOTIFY_URL,"biz_content":json.dumps(biz,ensure_ascii=False,separators=(",",":"))}
    p["sign"]=sign_alipay(p)
    req=Request(ALIPAY_GATEWAY,data=urlencode(p).encode(),headers={"Content-Type":"application/x-www-form-urlencoded;charset=utf-8"},method="POST")
    with build_opener(HTTPHandler,NoRedirect()).open(req,timeout=20) as res: raw=res.read(2_000_000)
    outer=json.loads(raw)
    response_key=method.replace(".","_")+"_response" if method.replace(".","_")+"_response" in outer else "error_response"
    result=outer.get(response_key,{})
    signature=outer.get("sign")
    if not signature: raise RuntimeError("alipay_response_signature_missing")
    pem=read_key(ALIPAY_PUBLIC_KEY_FILE)
    public_key=serialization.load_pem_public_key(pem) if b"BEGIN" in pem else serialization.load_pem_public_key(b"-----BEGIN PUBLIC KEY-----\n"+pem.strip()+b"\n-----END PUBLIC KEY-----")
    marker=('"'+response_key+'":').encode()
    marker_pos=raw.find(marker)
    start=raw.find(b"{",marker_pos+len(marker)) if marker_pos>=0 else -1
    if start<0: raise RuntimeError("alipay_response_signature_payload_missing")
    depth=0; quoted=False; escaped=False; end=-1
    for i in range(start,len(raw)):
        ch=raw[i]
        if quoted:
            if escaped: escaped=False
            elif ch==92: escaped=True
            elif ch==34: quoted=False
        else:
            if ch==34: quoted=True
            elif ch==123: depth+=1
            elif ch==125:
                depth-=1
                if depth==0: end=i+1; break
    if end<0: raise RuntimeError("alipay_response_signature_payload_invalid")
    signed=raw[start:end]
    try: public_key.verify(base64.b64decode(signature),signed,padding.PKCS1v15(),hashes.SHA256())
    except Exception: raise RuntimeError("alipay_response_signature_invalid")
    return result
def site_key(req,c):
    auth=req.headers.get("authorization","")
    if not auth.startswith("Bearer "): raise HTTPException(401,"api_key_required")
    token=auth[7:].strip()
    k=c.execute("SELECT k.* FROM site_api_keys k JOIN business_sites s ON s.id=k.site_id WHERE k.secret_hash=? AND k.status='active' AND s.status='active' AND (k.expires_at IS NULL OR k.expires_at>CURRENT_TIMESTAMP)",(digest(token),)).fetchone()
    if not k: raise HTTPException(401,"invalid_api_key")
    c.execute("UPDATE site_api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?",(k["id"],))
    return dict(k)
def safe_webhook(url):
    import urllib.parse
    u=urllib.parse.urlparse(url)
    if u.scheme!="https" or not u.hostname or u.username or u.password: raise ValueError("webhook_https_required")
    for info in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM):
        ip=ipaddress.ip_address(info[4][0])
        if not ip.is_global: raise ValueError("webhook_private_address_blocked")
    return url
def deliver(c,order_id):
    o=c.execute("SELECT o.*,s.delivery_mode,s.delivery_config_json,p.name product_name FROM orders o JOIN business_sites s ON s.id=o.site_id LEFT JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.status='paid'",(order_id,)).fetchone()
    if not o: return
    mode=o["delivery_mode"]; key="delivery:"+o["id"]
    c.execute("INSERT OR IGNORE INTO delivery_records(id,site_id,order_id,idempotency_key,mode,status) VALUES(?,?,?,?,?,'pending')",(uid(),o["site_id"],o["id"],key,mode))
    d=c.execute("SELECT * FROM delivery_records WHERE order_id=?",(order_id,)).fetchone()
    if d["status"]=="succeeded" or mode=="manual": return
    if mode=="internal": return
    try:
        cfg=json.loads(o["delivery_config_json"] or "{}"); url=safe_webhook(cfg.get("url") or cfg.get("delivery_url") or "")
        payload={"event":"order.paid","idempotency_key":key,"order_no":o["order_no"],"site_id":o["site_id"],"product_id":o["product_id"],"product_name":o["product_name"],"amount_minor":o["amount_minor"],"currency":o["currency"],"paid_at":o["paid_at"]}
        raw=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode()
        claim=c.execute("UPDATE delivery_records SET status='processing',attempt_count=attempt_count+1,request_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')",(raw.decode(),d["id"]))
        if claim.rowcount!=1: return
        secret=site_delivery_secret(o["site_id"])
        sig=hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest()
        rq=Request(url,data=raw,headers={"Content-Type":"application/json","x-qingtian-event":"order.paid","x-qingtian-signature":sig,"idempotency-key":key},method="POST")
        with build_opener(HTTPHandler,NoRedirect()).open(rq,timeout=12) as res: body=res.read(20000).decode(errors="replace"); code=res.status
        c.execute("UPDATE delivery_records SET status=?,response_json=?,delivered_at=CASE WHEN ?='succeeded' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",("succeeded" if 200<=code<300 else "failed",body,"succeeded" if 200<=code<300 else "failed",d["id"]))
    except Exception as e:
        c.execute("UPDATE delivery_records SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(str(e)[:500],d["id"]))

@app.on_event("startup")
def startup(): init_db()

@app.get("/api/health")
def health():
    c=db(); c.execute("SELECT 1"); c.close()
    return {"ok":True,"service":"qingtianpay-server","database":"connected","alipay":{"app_id":bool(APP_ID),"private_key":os.path.isfile(APP_PRIVATE_KEY_FILE),"public_key":os.path.isfile(ALIPAY_PUBLIC_KEY_FILE),"seller_id":bool(ALIPAY_SELLER_ID),"notify_url":ALIPAY_NOTIFY_URL}}
@app.get("/api/integration-guide")
def integration_guide():
    path=os.path.join(ROOT,"docs","API-INTEGRATION.md")
    if not os.path.isfile(path): raise HTTPException(404,"integration_guide_not_found")
    return Response(open(path,"r",encoding="utf-8").read(),media_type="text/markdown; charset=utf-8")
@app.get("/api/auth/bootstrap-status")
def bootstrap_status():
    c=db(); x=c.execute("SELECT setting_value FROM system_settings WHERE setting_key='bootstrap_completed'").fetchone(); c.close()
    return {"required":not x or x[0]!="true"}
@app.post("/api/auth/bootstrap")
async def bootstrap(req:FRequest,res:Response):
    if not BOOTSTRAP_SECRET or not hmac.compare_digest(req.headers.get("x-bootstrap-secret",""),BOOTSTRAP_SECRET): raise HTTPException(403,"forbidden")
    b=json_body(await req.json()); p=b.get("password","")
    if len(p)<12: raise HTTPException(400,"password_too_short")
    c=db()
    if c.execute("SELECT setting_value FROM system_settings WHERE setting_key='bootstrap_completed'").fetchone()[0]=="true": c.close(); raise HTTPException(409,"already_initialized")
    c.execute("UPDATE admin_accounts SET password_hash=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE is_protected=1",(pw_hash(p),))
    c.execute("UPDATE system_settings SET setting_value='true',updated_at=CURRENT_TIMESTAMP WHERE setting_key='bootstrap_completed'")
    audit(c,None,"auth.bootstrap","admin",None); c.commit(); c.close()
    return {"ok":True}
@app.post("/api/auth/login")
async def login(req:FRequest,res:Response):
    b=json_body(await req.json()); email=str(b.get("email","")).lower().strip(); password=str(b.get("password",""))
    c=db(); ident=digest(email); now=int(time.time())
    a=c.execute("SELECT * FROM admin_accounts WHERE email=? COLLATE NOCASE AND status='active'",(email,)).fetchone()
    attempt=c.execute("SELECT * FROM auth_attempts WHERE identity_key=?",(ident,)).fetchone()
    if attempt and attempt["locked_until"] and attempt["locked_until"]>now: c.close(); raise HTTPException(429,"too_many_attempts")
    if not a or not a["password_hash"] or not pw_ok(password,a["password_hash"]):
        if attempt and now-attempt["window_started_at"]<900: c.execute("UPDATE auth_attempts SET attempt_count=attempt_count+1,locked_until=CASE WHEN attempt_count>=7 THEN ? ELSE locked_until END WHERE identity_key=?",(now+900,ident))
        else: c.execute("INSERT OR REPLACE INTO auth_attempts(identity_key,attempt_count,window_started_at) VALUES(?,?,?)",(ident,1,now))
        c.commit(); c.close(); raise HTTPException(401,"invalid_credentials")
    c.execute("DELETE FROM auth_attempts WHERE identity_key=?",(ident,)); token=secrets.token_urlsafe(40)
    c.execute("INSERT INTO admin_sessions(id,admin_id,token_hash,expires_at) VALUES(?,?,?,datetime('now','+7 days'))",(uid(),a["id"],digest(token)))
    c.execute("UPDATE admin_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE id=?",(a["id"],)); audit(c,a["id"],"auth.login","admin",a["id"]); c.commit(); c.close()
    res.set_cookie(COOKIE_NAME,token,httponly=True,secure=True,samesite="none",max_age=604800)
    return {"admin":{"id":a["id"],"email":a["email"],"role":a["role"]}}
@app.get("/api/auth/me")
def me(req:FRequest):
    c=db(); a=admin_for(req,c); c.commit(); c.close()
    return {"admin":{k:a[k] for k in ("id","email","role")} if a else None}
@app.post("/api/auth/logout")
def logout(req:FRequest,res:Response):
    c=db(); t=req.cookies.get(COOKIE_NAME)
    if t: c.execute("DELETE FROM admin_sessions WHERE token_hash=?",(digest(t),))
    c.commit(); c.close(); res.delete_cookie(COOKIE_NAME); return {"ok":True}
@app.post("/api/auth/change-password")
async def change_password(req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True)
    x=c.execute("SELECT password_hash FROM admin_accounts WHERE id=?",(a["id"],)).fetchone()
    if not pw_ok(str(b.get("current_password","")),x["password_hash"]): c.close(); raise HTTPException(400,"current_password_incorrect")
    p=str(b.get("new_password",""))
    if len(p)<12: c.close(); raise HTTPException(400,"password_too_short")
    c.execute("UPDATE admin_accounts SET password_hash=?,password_changed_at=CURRENT_TIMESTAMP WHERE id=?",(pw_hash(p),a["id"]))
    c.execute("DELETE FROM admin_sessions WHERE admin_id=? AND id!=?",(a["id"],a["session_id"])); audit(c,a["id"],"auth.password_change","admin",a["id"]); c.commit(); c.close(); return {"ok":True}

@app.get("/api/sites")
def sites(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT s.*,(SELECT key_prefix FROM site_api_keys k WHERE k.site_id=s.id AND k.status='active' ORDER BY created_at DESC LIMIT 1) key_prefix FROM business_sites s ORDER BY created_at DESC")); c.close(); return {"items":x}
@app.post("/api/sites")
async def create_site(req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True)
    name=str(b.get("name","")).strip(); slug=str(b.get("slug","")).strip()
    if not name or not re.fullmatch(r"[a-z0-9-]{2,48}",slug): c.close(); raise HTTPException(400,"invalid_site")
    mode=b.get("delivery_mode","manual"); cfg={}
    if mode not in ("manual","webhook","internal"): c.close(); raise HTTPException(400,"invalid_delivery_mode")
    if mode=="webhook":
        try: cfg={"url":safe_webhook(str(b.get("delivery_url") or ""))}
        except Exception: c.close(); raise HTTPException(400,"invalid_delivery_url")
    sid=uid()
    c.execute("INSERT INTO business_sites(id,name,slug,base_url,delivery_mode,delivery_config_json) VALUES(?,?,?,?,?,?)",(sid,name,slug,b.get("base_url"),mode,json.dumps(cfg)))
    audit(c,a["id"],"site.create","site",slug); c.commit()
    secret=site_delivery_secret(sid) if mode=="webhook" else None
    c.close(); return {"ok":True,"site_id":sid,"delivery_secret":secret}
@app.get("/api/products")
def products(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT p.*,s.name site_name,json_extract(p.delivery_rule_json,'$.mode') delivery_mode FROM products p JOIN business_sites s ON s.id=p.site_id ORDER BY p.created_at DESC")); c.close(); return {"items":x}
@app.post("/api/products")
async def create_product(req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True); amount=int(b.get("amount_minor",0))
    if amount<=0 or not b.get("name"): c.close(); raise HTTPException(400,"invalid_product")
    sid=b.get("site_id")
    if not c.execute("SELECT 1 FROM business_sites WHERE id=? AND status='active'",(sid,)).fetchone(): c.close(); raise HTTPException(400,"invalid_site")
    c.execute("INSERT INTO products(id,site_id,name,description,amount_minor,delivery_rule_json) VALUES(?,?,?,?,?,?)",(uid(),sid,b["name"],b.get("description"),amount,json.dumps(b.get("delivery_rule")) if b.get("delivery_rule") else None)); audit(c,a["id"],"product.create","product",sid); c.commit(); c.close(); return {"ok":True}
@app.post("/api/sites/{site_id}/api-keys")
async def create_key(site_id:str,req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True)
    if not c.execute("SELECT 1 FROM business_sites WHERE id=?",(site_id,)).fetchone(): c.close(); raise HTTPException(404,"site_not_found")
    raw="qt_live_"+secrets.token_urlsafe(32); kid=uid()
    c.execute("INSERT INTO site_api_keys(id,site_id,label,key_prefix,secret_hash) VALUES(?,?,?,?,?)",(kid,site_id,b.get("label") or "default",raw[:15],digest(raw))); audit(c,a["id"],"api_key.create","api_key",kid); c.commit(); c.close(); return {"id":kid,"api_key":raw}
@app.get("/api/api-keys")
def keys(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT k.*,s.name site_name FROM site_api_keys k JOIN business_sites s ON s.id=k.site_id ORDER BY k.created_at DESC")); c.close(); return {"items":x}
@app.post("/api/api-keys/{kid}/revoke")
def revoke_key(kid:str,req:FRequest):
    c=db(); a=need_admin(req,c,True); c.execute("UPDATE site_api_keys SET status='revoked' WHERE id=?",(kid,)); audit(c,a["id"],"api_key.revoke","api_key",kid); c.commit(); c.close(); return {"ok":True}
@app.get("/api/orders")
def orders(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT o.*,s.name site_name FROM orders o JOIN business_sites s ON s.id=o.site_id ORDER BY o.created_at DESC LIMIT 300")); c.close(); return {"items":x}
@app.get("/api/payments")
def payments(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT p.*,o.order_no,s.name site_name,o.currency FROM payments p JOIN orders o ON o.id=p.order_id JOIN business_sites s ON s.id=p.site_id ORDER BY p.created_at DESC LIMIT 300")); c.close(); return {"items":x}
@app.get("/api/refunds")
def refunds(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT r.*,o.order_no,s.name site_name FROM refunds r JOIN orders o ON o.id=r.order_id JOIN business_sites s ON s.id=r.site_id ORDER BY r.created_at DESC LIMIT 300")); c.close(); return {"items":x}
@app.get("/api/deliveries")
def deliveries(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT d.*,o.order_no,s.name site_name FROM delivery_records d JOIN orders o ON o.id=d.order_id JOIN business_sites s ON s.id=d.site_id ORDER BY d.created_at DESC LIMIT 300")); c.close(); return {"items":x}
@app.post("/api/deliveries/{did}/retry")
def retry_delivery(did:str,req:FRequest):
    c=db(); a=need_admin(req,c,True); d=c.execute("SELECT order_id FROM delivery_records WHERE id=? AND status IN ('pending','failed')",(did,)).fetchone()
    if not d: c.close(); raise HTTPException(409,"delivery_not_retryable")
    deliver(c,d["order_id"]); audit(c,a["id"],"delivery.retry","delivery",did); c.commit(); x=dict(c.execute("SELECT status,attempt_count,last_error FROM delivery_records WHERE id=?",(did,)).fetchone()); c.close(); return x
@app.post("/api/deliveries/{did}/complete")
def complete_delivery(did:str,req:FRequest):
    c=db(); a=need_admin(req,c,True); d=c.execute("UPDATE delivery_records SET status='succeeded',delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND mode IN ('manual','internal') AND status!='succeeded'",(did,)); audit(c,a["id"],"delivery.complete","delivery",did); c.commit(); c.close(); return {"ok":True}
@app.get("/api/admins")
def admins(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT id,email,role,status,is_protected,last_login_at,created_at FROM admin_accounts ORDER BY is_protected DESC,created_at")); c.close(); return {"items":x}
@app.post("/api/admins")
async def create_admin(req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True); email=str(b.get("email","")).strip(); password=str(b.get("password","")); role=b.get("role","operator")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+",email) or len(password)<12 or role not in ("operator","viewer"): c.close(); raise HTTPException(400,"invalid_admin")
    c.execute("INSERT INTO admin_accounts(id,email,password_hash,role,status,is_protected) VALUES(?,?,?,?,'active',0)",(uid(),email,pw_hash(password),role)); audit(c,a["id"],"admin.create","admin",email); c.commit(); c.close(); return {"ok":True}
@app.patch("/api/admins/{aid}")
async def update_admin(aid:str,req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True); target=c.execute("SELECT is_protected FROM admin_accounts WHERE id=?",(aid,)).fetchone()
    if not target: c.close(); raise HTTPException(404,"admin_not_found")
    if target["is_protected"]: c.close(); raise HTTPException(403,"protected_admin")
    status=b.get("status")
    if status not in (None,"active","disabled"): c.close(); raise HTTPException(400,"invalid_status")
    c.execute("UPDATE admin_accounts SET status=COALESCE(?,status) WHERE id=?",(status,aid))
    if status=="disabled": c.execute("DELETE FROM admin_sessions WHERE admin_id=?",(aid,))
    audit(c,a["id"],"admin.update","admin",aid); c.commit(); c.close(); return {"ok":True}
@app.get("/api/audit-logs")
def logs(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT l.*,a.email actor_email FROM audit_logs l LEFT JOIN admin_accounts a ON a.id=l.actor_admin_id ORDER BY l.created_at DESC LIMIT 300")); c.close(); return {"items":x}
@app.get("/api/analytics/revenue")
def revenue(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT date(o.created_at) date,s.name site_name,COUNT(*) order_count,SUM(o.status IN ('paid','refunded')) paid_count,COALESCE(SUM(CASE WHEN o.status IN ('paid','refunded') THEN o.amount_minor ELSE 0 END),0) gross_minor,COALESCE(SUM((SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id=o.id AND r.status='succeeded')),0) refund_minor,COALESCE(SUM(CASE WHEN o.status IN ('paid','refunded') THEN o.amount_minor ELSE 0 END),0)-COALESCE(SUM((SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id=o.id AND r.status='succeeded')),0) net_minor FROM orders o JOIN business_sites s ON s.id=o.site_id GROUP BY date(o.created_at),o.site_id ORDER BY date DESC LIMIT 90")); c.close(); return {"items":x}
@app.get("/api/ledger")
def ledger(req:FRequest):
    c=db(); need_admin(req,c); x=rows(c.execute("SELECT p.id,p.site_id,s.name site_name,o.order_no,'收款' type,p.amount_minor,p.channel_trade_no,p.created_at FROM payments p JOIN orders o ON o.id=p.order_id JOIN business_sites s ON s.id=p.site_id WHERE p.status='succeeded' UNION ALL SELECT r.id,r.site_id,s.name,o.order_no,'退款',-r.amount_minor,p.channel_trade_no,r.created_at FROM refunds r JOIN orders o ON o.id=r.order_id JOIN payments p ON p.id=r.payment_id JOIN business_sites s ON s.id=r.site_id WHERE r.status='succeeded' ORDER BY created_at DESC LIMIT 300")); c.close(); return {"items":x}

@app.post("/api/v1/payments")
async def create_payment(req:FRequest):
    b=json_body(await req.json()); c=db(); k=site_key(req,c)
    if not ALIPAY_SELLER_ID:
        c.close(); raise HTTPException(503,"alipay_merchant_id_not_configured")
    product=c.execute("SELECT * FROM products WHERE id=? AND site_id=? AND status='active'",(b.get("product_id"),k["site_id"])).fetchone()
    if not product: c.close(); raise HTTPException(404,"product_not_found")
    if product["currency"] != "CNY": c.close(); raise HTTPException(400,"alipay_only_supports_cny")
    ext=str(b.get("external_order_no","")).strip()
    # This merchant is provisioned for Alipay JSAPI only. Do not silently
    # fall back to website-pay products that may not be enabled.
    method=str(b.get("payment_method","alipay_jsapi")).strip().lower()
    if method != "alipay_jsapi":
        c.close(); raise HTTPException(400,"unsupported_payment_method_jsapi_only")
    buyer=str(b.get("buyer_id","")).strip()
    if not buyer:
        c.close(); raise HTTPException(400,"alipay_buyer_id_required")
    if not ext:
        c.close(); raise HTTPException(400,"external_order_no_required")
    old=c.execute("SELECT order_no,status FROM orders WHERE site_id=? AND external_order_no=?",(k["site_id"],ext)).fetchone()
    if old: c.close(); raise HTTPException(409,"duplicate_external_order")
    oid=uid(); order_no="QT"+time.strftime("%y%m%d%H%M%S")+secrets.token_hex(4).upper(); pid=uid()
    c.execute("INSERT INTO orders(id,site_id,order_no,external_order_no,product_id,buyer_ref,buyer_email,amount_minor,currency,status,subject,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)",(oid,k["site_id"],order_no,ext,product["id"],b.get("buyer_ref"),b.get("buyer_email"),product["amount_minor"],product["currency"],product["name"],json.dumps(b.get("metadata") or {})))
    c.execute("INSERT INTO payments(id,site_id,order_id,channel,channel_out_trade_no,amount_minor,status) VALUES(?,?,?,'alipay',?,?,'processing')",(pid,k["site_id"],oid,order_no,product["amount_minor"])); c.commit()
    try:
        amount=f'{(Decimal(product["amount_minor"])/Decimal(100)):.2f}'
        site=c.execute("SELECT base_url FROM business_sites WHERE id=?",(k["site_id"],)).fetchone()
        base=(site["base_url"] or "https://pay.lynli.me").rstrip("/")
        if not base.startswith("https://"): raise RuntimeError("merchant_base_url_https_required")
        return_url=base+"/payment/result?order_no="+order_no
        result=alipay("alipay.trade.create",{
            "out_trade_no":order_no,
            "total_amount":amount,
            "subject":product["name"],
            "buyer_id":buyer,
            "product_code":"JSAPI_PAY",
            "timeout_express":"15m"
        })
        if str(result.get("code","")) != "10000" or not result.get("trade_no"):
            raise RuntimeError("alipay_jsapi_create_rejected")
        trade_no=str(result["trade_no"])
        response={"order_no":order_no,"status":"pending","payment_method":"alipay_jsapi","invoke":{"tradeNO":trade_no}}
        c.execute("UPDATE payments SET status='created',channel_trade_no=?,channel_response_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(trade_no,json.dumps({"method":"alipay.trade.create","trade_no":trade_no}),pid)); c.commit()
        c.close(); return response
    except Exception as e:
        c.execute("UPDATE payments SET status='failed',channel_response_json=? WHERE id=?",(json.dumps({"error":str(e)}),pid)); c.execute("UPDATE orders SET status='failed' WHERE id=?",(oid,)); c.commit(); c.close(); raise HTTPException(502,"alipay_create_failed")
@app.post("/api/alipay/notify")
async def alipay_notify(req:FRequest):
    form=await req.form(); p={k:str(v) for k,v in form.items()}
    if not verify_alipay(p): return Response("failure",status_code=400,media_type="text/plain")
    c=db(); o=c.execute("SELECT o.*,p.id payment_id,p.amount_minor payment_amount,p.channel_out_trade_no FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_no=? AND p.channel='alipay'",(p.get("out_trade_no"),)).fetchone()
    try: notified_amount=int((Decimal(str(p.get("total_amount","0")))*100).quantize(Decimal("1")))
    except (InvalidOperation, ValueError, TypeError): notified_amount=-1
    if not ALIPAY_SELLER_ID or not o or p.get("seller_id")!=ALIPAY_SELLER_ID or o["channel_out_trade_no"]!=p.get("out_trade_no") or o["payment_amount"]!=notified_amount or o["amount_minor"]!=notified_amount or not p.get("trade_no") or not p.get("notify_id"): c.close(); return Response("failure",status_code=400,media_type="text/plain")
    if p.get("trade_status") in ("TRADE_SUCCESS","TRADE_FINISHED"):
        c.execute("UPDATE payments SET status='succeeded',channel_trade_no=?,notified_at=CURRENT_TIMESTAMP,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'",(p.get("trade_no"),o["payment_id"]))
        c.execute("UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')",(o["id"],)); c.commit(); deliver(c,o["id"])
    elif p.get("trade_status")=="TRADE_CLOSED":
        c.execute("UPDATE payments SET status='closed',notified_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'",(o["payment_id"],)); c.execute("UPDATE orders SET status='closed' WHERE id=? AND status='pending'",(o["id"],))
    c.commit(); c.close(); return Response("success",media_type="text/plain")
@app.get("/api/v1/orders/{order_no}")
def site_order(order_no:str,req:FRequest):
    c=db(); k=site_key(req,c); o=c.execute("SELECT o.*,p.id payment_id,p.status payment_status,p.channel_trade_no FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_no=? AND o.site_id=?",(order_no,k["site_id"])).fetchone()
    if not o: c.close(); raise HTTPException(404,"order_not_found")
    if o["status"] in ("pending","failed") and ALIPAY_SELLER_ID:
        try:
            result=alipay("alipay.trade.query",{"out_trade_no":order_no})
            paid_amount=int((Decimal(str(result.get("total_amount","0")))*100).quantize(Decimal("1")))
            if result.get("seller_id")==ALIPAY_SELLER_ID and paid_amount==o["amount_minor"] and result.get("trade_status") in ("TRADE_SUCCESS","TRADE_FINISHED"):
                c.execute("UPDATE payments SET status='succeeded',channel_trade_no=?,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'",(result.get("trade_no"),o["payment_id"]))
                c.execute("UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')",(o["id"],))
                c.commit(); deliver(c,o["id"]); c.commit()
            elif result.get("trade_status")=="TRADE_CLOSED":
                c.execute("UPDATE payments SET status='closed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'",(o["payment_id"],))
                c.execute("UPDATE orders SET status='closed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",(o["id"],)); c.commit()
        except Exception:
            pass
        o=c.execute("SELECT o.*,p.status payment_status,p.channel_trade_no FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_no=? AND o.site_id=?",(order_no,k["site_id"])).fetchone()
    c.close(); return {"order_no":o["order_no"],"external_order_no":o["external_order_no"],"status":o["status"],"amount_minor":o["amount_minor"],"currency":o["currency"],"payment_status":o["payment_status"],"trade_no":o["channel_trade_no"],"paid_at":o["paid_at"]}
@app.post("/api/refunds")
async def create_refund(req:FRequest):
    b=json_body(await req.json()); c=db(); a=need_admin(req,c,True)
    o=c.execute("SELECT o.*,p.id payment_id,p.channel_out_trade_no FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=? AND o.status='paid' AND p.status='succeeded'",(b.get("order_id"),)).fetchone()
    amount=int(b.get("amount_minor",0))
    if not o or amount<=0 or amount>o["amount_minor"]: c.close(); raise HTTPException(400,"invalid_refund")
    rid=uid(); refund_no="RF"+secrets.token_hex(8).upper()
    try: c.execute("INSERT INTO refunds(id,site_id,order_id,payment_id,refund_no,amount_minor,reason,status,requested_by) VALUES(?,?,?,?,?,?,?,'processing',?)",(rid,o["site_id"],o["id"],o["payment_id"],refund_no,amount,b.get("reason"),a["id"])); c.commit()
    except Exception: c.close(); raise HTTPException(409,"refund_amount_exceeds_remaining")
    try:
        r=alipay("alipay.trade.refund",{"out_trade_no":o["order_no"],"refund_amount":f"{(Decimal(amount)/Decimal(100)):.2f}","out_request_no":refund_no,"refund_reason":b.get("reason") or "customer request"})
        c.execute("UPDATE refunds SET status='succeeded',channel_refund_no=?,processed_at=CURRENT_TIMESTAMP WHERE id=?",(r.get("trade_no") or r.get("out_trade_no"),rid))
        total=c.execute("SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE order_id=? AND status='succeeded'",(o["id"],)).fetchone()[0]
        if total>=o["amount_minor"]: c.execute("UPDATE orders SET status='refunded' WHERE id=?",(o["id"],))
        c.commit(); c.close(); return {"ok":True,"refund_no":refund_no,"status":"succeeded"}
    except Exception:
        c.execute("UPDATE refunds SET status='processing' WHERE id=?",(rid,)); c.commit(); c.close(); raise HTTPException(202,"refund_status_processing_check_channel")

@app.post("/api/refunds/{rid}/check")
def check_refund(rid:str,req:FRequest):
    c=db(); a=need_admin(req,c,True)
    r=c.execute("SELECT r.*,o.order_no,o.amount_minor order_amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=?",(rid,)).fetchone()
    if not r: c.close(); raise HTTPException(404,"refund_not_found")
    if r["status"]!="processing": c.close(); return {"refund_no":r["refund_no"],"status":r["status"]}
    try:
        result=alipay("alipay.trade.fastpay.refund.query",{"out_trade_no":r["order_no"],"out_request_no":r["refund_no"]})
        channel_status=result.get("refund_status")
        if channel_status=="REFUND_SUCCESS":
            c.execute("UPDATE refunds SET status='succeeded',channel_refund_no=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'",(result.get("trade_no") or r["refund_no"],rid))
            total=c.execute("SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE order_id=? AND status='succeeded'",(r["order_id"],)).fetchone()[0]
            if total>=r["order_amount"]: c.execute("UPDATE orders SET status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?",(r["order_id"],))
        elif channel_status in ("REFUND_FAIL","REFUND_CLOSED"):
            c.execute("UPDATE refunds SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'",(rid,))
        audit(c,a["id"],"refund.check","refund",rid,detail={"channel_status":channel_status})
        c.commit()
        current=c.execute("SELECT status FROM refunds WHERE id=?",(rid,)).fetchone()[0]
        c.close(); return {"refund_no":r["refund_no"],"status":current,"channel_status":channel_status}
    except Exception:
        c.close(); raise HTTPException(502,"refund_query_failed")

@app.get("/api/sites/{site_id}/delivery-secret")
def get_site_delivery_secret(site_id:str,req:FRequest):
    c=db(); a=need_admin(req,c)
    site=c.execute("SELECT id,delivery_mode FROM business_sites WHERE id=?",(site_id,)).fetchone()
    if not site: c.close(); raise HTTPException(404,"site_not_found")
    if site["delivery_mode"]!="webhook": c.close(); raise HTTPException(400,"webhook_delivery_not_enabled")
    secret=site_delivery_secret(site_id)
    audit(c,a["id"],"site.delivery_secret.read","site",site_id)
    c.commit(); c.close(); return {"site_id":site_id,"delivery_secret":secret,"algorithm":"HMAC-SHA256"}