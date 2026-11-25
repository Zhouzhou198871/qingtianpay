import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API_BASE = 'https://pay-api.lynli.me';
function apiFetch(input, init = {}) {
  const target = typeof input === 'string' && input.startsWith('/api/') ? API_BASE + input : input;
  return fetch(target, { ...init, credentials: init.credentials ?? 'include' });
}


function Brand({ compact = false }) {
  return <div className={compact ? 'brand brand-compact' : 'brand'}>
    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="晴天支付中心" />
    <div className="brand-copy"><strong>晴天支付中心</strong><span>QINGTIAN PAYMENT</span></div>
  </div>;
}

const modules = [
  { key: 'overview', label: '总览', group: '工作台', code: '01', description: '查看支付中心整体运行情况、待处理事项与业务概况。' },
  { key: 'sites', label: '业务网站', group: '业务管理', code: '02', description: '管理接入支付中心的自有网站、站点状态和独立 API 凭证。' },
  { key: 'products', label: '商品管理', group: '业务管理', code: '03', description: '按业务网站管理商品名称、价格、状态和交付规则。' },
  { key: 'api', label: 'API 接口管理', group: '业务管理', code: '04', description: '管理各业务网站独立 API 凭证、权限范围、轮换和调用记录。' },
  { key: 'orders', label: '订单管理', group: '交易中心', code: '05', description: '统一查询各业务网站订单，查看订单状态和完整交易信息。' },
  { key: 'payments', label: '支付记录', group: '交易中心', code: '06', description: '查看支付宝交易流水、支付结果与异步通知处理记录。' },
  { key: 'refunds', label: '退款管理', group: '交易中心', code: '07', description: '处理退款申请，追踪渠道退款状态与退款结果。' },
  { key: 'delivery', label: '交付管理', group: '交易中心', code: '08', description: '管理支付成功后的自动交付、失败重试和人工补发记录。' },
  { key: 'revenue', label: '收款统计', group: '财务中心', code: '09', description: '按业务网站和时间查看收款趋势、成功率与退款汇总。' },
  { key: 'ledger', label: '资金流水', group: '财务中心', code: '10', description: '查看收款、退款和渠道流水，支持核对与追踪。' },
  { key: 'admins', label: '管理员管理', group: '系统管理', code: '11', description: '管理超级管理员、后台管理员、角色和模块权限。' },
  { key: 'security', label: '安全设置', group: '系统管理', code: '12', description: '管理登录保护、会话安全、密码策略和 API 安全。' },
  { key: 'logs', label: '操作日志', group: '系统管理', code: '13', description: '追踪管理员操作、变更内容、执行结果和时间。' },
  { key: 'settings', label: '系统设置', group: '系统管理', code: '14', description: '配置支付宝渠道参数和支付中心系统选项。' },
  { key: 'profile', label: '个人中心', group: '账户中心', code: '15', description: '管理当前登录账号的个人资料、密码和登录会话。' },
];

const moduleData = {
  sites: { title: '业务网站', eyebrow: 'BUSINESS SITES', action: '添加业务网站', columns: ['网站名称', '站点标识', '网站地址', 'API 凭证', '交付模式', '状态', '创建时间', '操作'], empty: '还没有接入业务网站', note: '添加网站后，每个网站会获得独立的站点标识和 API 凭证。各站点商品、订单与交付数据相互隔离。' },
  products: { title: '商品管理', eyebrow: 'PRODUCT CATALOG', action: '添加商品', columns: ['商品名称', '所属网站', '商品价格', '币种', '交付方式', '状态', '更新时间'], empty: '暂无商品', note: '商品必须归属于一个业务网站。商品价格以人民币分为单位存储，避免浮点金额误差。' },
  api: { title: 'API 接口管理', eyebrow: 'API ACCESS', action: '创建 API 凭证', columns: ['凭证名称', '所属网站', 'Key 前缀', '权限范围', '最近调用', '有效期', '状态', '操作'], empty: '暂无 API 凭证', note: '每个业务网站使用独立 API 凭证。密钥只在创建时展示一次，数据库只保存 SHA-256 摘要；支持轮换、吊销和调用审计。' },
  orders: { title: '订单管理', eyebrow: 'ORDERS', action: '', columns: ['订单编号', '所属网站', '商品 / 订单标题', '订单金额', '买家信息', '订单状态', '创建时间'], empty: '暂无订单记录', note: '订单数据将按站点隔离展示。支付成功状态以服务端验签和渠道查询结果为准。' },
  payments: { title: '支付记录', eyebrow: 'PAYMENT TRANSACTIONS', action: '', columns: ['支付流水号', '订单编号', '所属网站', '支付渠道', '支付金额', '支付状态', '支付时间'], empty: '暂无支付流水', note: '当前仅支持支付宝 JSAPI。付款链接需在支付宝客户端中打开，由 AlipayJSBridge 唤起收银台。服务端订单创建、OAuth 跳转、trade.create、通知验签和交付流程已通过隔离测试；真实客户端唤起仍待容器验收。' },
  refunds: { title: '退款管理', eyebrow: 'REFUNDS', action: '发起退款', columns: ['退款单号', '原订单号', '所属网站', '退款金额', '退款原因', '退款状态', '申请时间', '操作'], empty: '暂无退款申请', note: '退款状态将与支付宝渠道结果同步，保留每次操作记录和管理员审计信息。' },
  delivery: { title: '交付管理', eyebrow: 'FULFILLMENT', action: '', columns: ['交付编号', '订单编号', '所属网站', '交付方式', '尝试次数', '交付状态', '最近执行时间', '操作'], empty: '暂无交付任务', note: 'Webhook 交付支持失败重试；人工和内部交付支持确认完成，所有操作保留审计记录。' },
  admins: { title: '管理员管理', eyebrow: 'ADMINISTRATION', action: '添加管理员', columns: ['管理员账号', '角色', '受保护状态', '账号状态', '最近登录', '创建时间', '操作'], empty: '管理员数据尚未初始化', note: '三个指定邮箱已在生产数据库初始化为受保护的超级管理员。可在此管理其他管理员、角色授权、账号启停和登录记录。密码只保存安全哈希，不写入代码或明文数据库字段。' },
  revenue: { title: '收款统计', eyebrow: 'REVENUE ANALYTICS', action: '', columns: ['统计日期', '所属网站', '订单总数', '支付成功', '收款金额', '退款金额', '净收款'], empty: '暂无收款统计', note: '统计数据以真实支付记录为基础，支持按网站和日期汇总，不展示模拟金额。' },
  ledger: { title: '资金流水', eyebrow: 'FINANCIAL LEDGER', action: '', columns: ['流水编号', '所属网站', '关联订单', '流水类型', '发生金额', '渠道交易号', '发生时间'], empty: '暂无资金流水', note: '收款和退款流水分别记录，保留渠道交易号与关联订单，便于核对追踪。' },
  security: { title: '安全设置', eyebrow: 'SECURITY CENTER', action: '', columns: [], empty: '', note: '' },
  logs: { title: '操作日志', eyebrow: 'AUDIT LOGS', action: '', columns: ['操作时间', '管理员', '操作模块', '操作内容', '来源 IP', '执行结果'], empty: '暂无操作记录', note: '记录关键配置变更、管理员操作、支付处理和权限调整，日志不允许普通管理员修改。' },
  settings: { title: '系统设置', eyebrow: 'SYSTEM CONFIGURATION', action: '', columns: [], empty: '', note: '' },
};

function Overview({ onNavigate }) {
  const [metrics, setMetrics] = useState({ orders: 0, revenue: 0, refunds: 0, sites: 0 });
  const [health, setHealth] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [ordersRes, paymentsRes, refundsRes, sitesRes, healthRes] = await Promise.all([
          apiFetch('/api/orders', { credentials:'include' }),
          apiFetch('/api/payments', { credentials:'include' }),
          apiFetch('/api/refunds', { credentials:'include' }),
          apiFetch('/api/sites', { credentials:'include' }),
          apiFetch('/api/health', { credentials:'include' }),
        ]);
        const [ordersData, paymentsData, refundsData, sitesData, healthData] = await Promise.all([
          ordersRes.json(), paymentsRes.json(), refundsRes.json(), sitesRes.json(), healthRes.json(),
        ]);
        if (!ordersRes.ok || !paymentsRes.ok || !refundsRes.ok || !sitesRes.ok) throw new Error('dashboard_api_failed');
        const today = new Date().toLocaleDateString('en-CA');
        const todayOrders = (ordersData.items || []).filter(x => String(x.created_at || '').slice(0,10) === today);
        const todayRevenue = (paymentsData.items || []).filter(x => x.status === 'succeeded' && String(x.paid_at || '').slice(0,10) === today)
          .reduce((sum, x) => sum + Number(x.amount_minor || 0), 0);
        const pendingRefunds = (refundsData.items || []).filter(x => ['processing','pending'].includes(x.status)).length;
        if (alive) {
          setMetrics({ orders: todayOrders.length, revenue: todayRevenue, refunds: pendingRefunds, sites: (sitesData.items || []).length });
          setHealth(healthData);
        }
      } catch {
        if (alive) setHealth(null);
      } finally {
        if (alive) setLoadingMetrics(false);
      }
    };
    load();
    return () => { alive = false; };
  }, []);
  const cards = [
    ['今日订单', loadingMetrics ? '…' : String(metrics.orders), '今日新建订单', 'orders'],
    ['今日收款', loadingMetrics ? '¥ …' : '¥ ' + (metrics.revenue / 100).toFixed(2), '今日已成功收款', 'payments'],
    ['待处理退款', loadingMetrics ? '…' : String(metrics.refunds), '等待渠道处理', 'refunds'],
    ['接入业务', loadingMetrics ? '…' : String(metrics.sites), '已登记业务网站', 'sites'],
  ];
  return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">OVERVIEW</div><h1>业务总览</h1><p>晴天旗下业务的统一支付管理入口。</p></div><div className="data-state"><i /> {health?.ok ? '服务正常' : '服务状态待确认'}</div></div>
    <div className="overview-grid">{cards.map(([label,value,hint,target]) => <button className="metric-card" key={label} onClick={() => onNavigate(target)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></button>)}</div>
    <div className="overview-columns">
      <section className="workspace-card"><div className="card-heading"><div><span className="section-kicker">SYSTEM STATUS</span><h2>系统接入进度</h2></div><span className="soft-tag">生产服务</span></div>
        <div className="status-list">
          <div className="status-row"><span className="status-mark pending">01</span><div><b>独立数据库</b><small>服务器独立 SQLite 数据库已初始化，API 健康检查通过</small></div><em>已连接</em></div>
          <div className="status-row"><span className="status-mark pending">02</span><div><b>管理员认证</b><small>三个受保护超级管理员已在生产数据库初始化，登录、会话和密码哈希接口已部署</small></div><em>已初始化</em></div>
          <div className="status-row"><span className="status-mark pending">03</span><div><b>支付宝 JSAPI 支付</b><small>服务端 JSAPI OAuth、交易创建和付款启动流程已通过隔离测试；需在支付宝客户端容器中完成最终唤起验收</small></div><em>待容器验收</em></div>
          <div className="status-row"><span className="status-mark pending">04</span><div><b>多网站数据隔离</b><small>站点 API Key、订单隔离和 Webhook 交付接口已建立，待接入业务网站</small></div><em>待接入业务</em></div>
        </div>
      </section>
      <section className="workspace-card"><div className="card-heading"><div><span className="section-kicker">WORKSPACE</span><h2>管理模块</h2></div></div>
        <div className="quick-links">{modules.filter(m => m.key !== 'overview').map(m => <button key={m.key} onClick={() => onNavigate(m.key)}><span>{m.code}</span><b>{m.label}</b><small>{m.description}</small></button>)}</div>
      </section>
    </div>
    <div className="workspace-footnote">当前页面为管理中心开发工作区。统计数据仅在真实 API 和数据库接通后展示，不使用模拟交易数据。</div>
  </div>;
}

function DataModule({ moduleKey, admin }) {
  const data = moduleData[moduleKey];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [createdDeliverySecret, setCreatedDeliverySecret] = useState('');
  const [siteOptions, setSiteOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [form, setForm] = useState({ name:'', slug:'', base_url:'', delivery_mode:'manual', delivery_url:'', site_id:'', amount:'', description:'', delivery_rule:'', label:'', email:'', password:'', role:'operator', order_id:'', reason:'' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [health, setHealth] = useState(null);
  const endpoints = { sites: '/api/sites', products: '/api/products', api: '/api/api-keys', orders: '/api/orders', payments: '/api/payments', refunds: '/api/refunds', delivery: '/api/deliveries', admins: '/api/admins', logs: '/api/audit-logs', revenue: '/api/analytics/revenue', ledger: '/api/ledger' };
  const fields = {
    sites: ['name','slug','base_url','key_prefix','delivery_mode','status','created_at','actions'],
    products: ['name','site_name','amount_minor','currency','delivery_mode','status','updated_at'],
    api: ['label','site_name','key_prefix','scope','last_used_at','expires_at','status','actions'],
    orders: ['order_no','site_name','subject','amount_minor','buyer_ref','status','created_at'],
    payments: ['channel_trade_no','order_no','site_name','channel','amount_minor','status','paid_at'],
    refunds: ['refund_no','order_no','site_name','amount_minor','reason','status','created_at','actions'],
    delivery: ['id','order_no','site_name','mode','attempt_count','status','updated_at','actions'],
    admins: ['email','role','is_protected','status','last_login_at','created_at','actions'],
    logs: ['created_at','actor_email','action','resource_type','resource_id','result'],
    revenue: ['date','site_name','order_count','paid_count','gross_minor','refund_minor','net_minor'],
    ledger: ['id','site_name','order_no','type','amount_minor','channel_trade_no','created_at'],
  };
  useEffect(() => {
    let alive = true;
    const endpoint = endpoints[moduleKey];
    if (!endpoint) { setItems([]); setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    apiFetch(endpoint, { credentials: 'include' }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || '接口读取失败');
      return payload.items || [];
    }).then(rows => { if (alive) setItems(rows); }).catch(() => { if (alive) setItems([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [moduleKey]);
  useEffect(() => {
    apiFetch('/api/health', { credentials:'include' }).then(r=>r.json()).then(setHealth).catch(()=>setHealth(null));
  }, []);
  useEffect(() => {
    if (!['products','api'].includes(moduleKey)) return;
    apiFetch('/api/sites', { credentials:'include' }).then(r => r.json()).then(data => setSiteOptions(data.items || [])).catch(() => setSiteOptions([]));
  }, [moduleKey]);
  useEffect(() => {
    if (moduleKey !== 'refunds') return;
    Promise.all([
      apiFetch('/api/orders', { credentials:'include' }).then(r => r.json()),
      apiFetch('/api/refunds', { credentials:'include' }).then(r => r.json()),
    ]).then(([ordersData, refundsData]) => {
      const reserved = new Map();
      for (const item of refundsData.items || []) {
        if (['pending','processing','succeeded'].includes(item.status)) reserved.set(item.order_id, (reserved.get(item.order_id) || 0) + Number(item.amount_minor || 0));
      }
      setOrderOptions((ordersData.items || []).filter(item => item.status === 'paid').map(item => ({ ...item, remaining_minor: Math.max(0, Number(item.amount_minor || 0) - (reserved.get(item.id) || 0)) })).filter(item => item.remaining_minor > 0));
    }).catch(() => setOrderOptions([]));
  }, [moduleKey]);
  async function runRowAction(item) {
    try {
      let url = '', method = 'POST', payload = {};
      if (moduleKey === 'api') url = '/api/api-keys/' + encodeURIComponent(item.id) + '/revoke';
      else if (moduleKey === 'delivery') {
        if (item.status === 'succeeded') return;
        url = '/api/deliveries/' + encodeURIComponent(item.id) + (['manual','internal'].includes(item.mode) ? '/complete' : '/retry');
      } else if (moduleKey === 'refunds') {
        if (item.status !== 'processing') return;
        url = '/api/refunds/' + encodeURIComponent(item.id) + '/check';
      } else if (moduleKey === 'sites') {
        if (item.delivery_mode !== 'webhook') return;
        url = '/api/sites/' + encodeURIComponent(item.id) + '/delivery-secret';
        method = 'GET';
      }
      else if (moduleKey === 'admins') {
        if (item.is_protected) return;
        url = '/api/admins/' + encodeURIComponent(item.id);
        method = 'PATCH';
        payload = { status: item.status === 'disabled' ? 'active' : 'disabled' };
      } else return;
      const response = await apiFetch(url, { method, headers:{'content-type':'application/json'}, credentials:'include', ...(method === 'GET' ? {} : { body:JSON.stringify(payload) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.detail || '操作失败');
      if (moduleKey === 'sites') { setCreatedDeliverySecret(result.delivery_secret || ''); return; }
      const refreshed = await apiFetch(endpoints[moduleKey], { credentials:'include' });
      const data = await refreshed.json().catch(() => ({}));
      setItems(data.items || []);
    } catch (error) { setFormError(error.message || '操作失败'); }
  }
  async function submitPasswordChange(event) {
    event.preventDefault(); setPasswordNotice('');
    if (newPassword.length < 12) { setPasswordNotice('新密码至少需要 12 位。'); return; }
    try {
      const response = await apiFetch('/api/auth/change-password', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body:JSON.stringify({ current_password:currentPassword, new_password:newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'current_password_incorrect' || data.detail === 'current_password_incorrect' ? '当前密码不正确。' : (data.error || data.detail || '密码修改失败'));
      setCurrentPassword(''); setNewPassword(''); setPasswordNotice('密码已更新，其他登录会话已退出。');
    } catch (error) { setPasswordNotice(error.message || '密码修改失败'); }
  }
  async function submitCreate(event) {
    event.preventDefault(); setSaving(true); setFormError('');
    try {
      let endpoint = '', payload = {};
      if (moduleKey === 'sites') {
        endpoint = '/api/sites';
        payload = { name:form.name, slug:form.slug, base_url:form.base_url || null, delivery_mode:form.delivery_mode, delivery_url:form.delivery_url || null };
      } else if (moduleKey === 'products') {
        endpoint = '/api/products';
        payload = { site_id:form.site_id, name:form.name, amount_minor:Math.round(Number(form.amount) * 100), description:form.description || null, delivery_rule:form.delivery_rule ? JSON.parse(form.delivery_rule) : null };
      } else if (moduleKey === 'api') {
        endpoint = '/api/sites/' + encodeURIComponent(form.site_id) + '/api-keys';
        payload = { label:form.label || '默认 API 凭证' };
      } else if (moduleKey === 'admins') {
        endpoint = '/api/admins';
        payload = { email:form.email, password:form.password, role:form.role };
      } else if (moduleKey === 'refunds') {
        endpoint = '/api/refunds';
        payload = { order_id:form.order_id, amount_minor:Math.round(Number(form.amount) * 100), reason:form.reason || null };
      }
      if (!endpoint) throw new Error('此模块暂不支持创建');
      const response = await apiFetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body:JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.detail || '创建失败');
      if (moduleKey === 'api' || moduleKey === 'sites') setCreatedKey(data.api_key || '');
      if (moduleKey === 'sites' && data.delivery_secret) setCreatedDeliverySecret(data.delivery_secret);
      setShowCreate(false);
      setForm({ name:'', slug:'', base_url:'', delivery_mode:'manual', delivery_url:'', site_id:'', amount:'', description:'', delivery_rule:'', label:'', email:'', password:'', role:'operator', order_id:'', reason:'' });
      const refreshed = await apiFetch(endpoints[moduleKey], { credentials:'include' });
      const result = await refreshed.json().catch(() => ({}));
      setItems(result.items || []);
    } catch (error) { setFormError(error.message || '创建失败'); }
    finally { setSaving(false); }
  }
  const filteredItems = items.filter(item => {
    const matchesSearch = !search || JSON.stringify(item).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === 'all' || item.status === status || (status === 'active' && ['succeeded','paid'].includes(item.status)) || (status === 'pending' && ['processing','created'].includes(item.status));
    return matchesSearch && matchesStatus;
  });
  function cellValue(value, field) {
    if (value === null || value === undefined || value === '') return '—';
    if (['amount_minor','gross_minor','refund_minor','net_minor'].includes(field)) return '¥' + (Number(value) / 100).toFixed(2);
    if (field === 'is_protected') return value ? '受保护' : '普通管理员';
    if (field === 'scope') return '仅限所属站点';
    if (field === 'delivery_mode') return ({ manual: '人工交付', webhook: 'Webhook 自动交付', internal: '内部交付' })[value] || value;
    if (field === 'status') return ({ active: '正常', disabled: '停用', pending: '待处理', paid: '已支付', succeeded: '成功', failed: '失败', processing: '处理中', refunded: '已退款', closed: '已关闭' })[value] || value;
    if (field.endsWith('_at')) return String(value).replace('T',' ').replace('Z','').slice(0,19);
    return String(value);
  }
  if (moduleKey === 'profile') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">MY ACCOUNT</div><h1>个人中心</h1><p>管理当前登录账号的资料与安全凭证。</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">ACCOUNT PROFILE</span><h2>个人资料</h2><p>登录邮箱：<b>{admin?.email || '—'}</b></p><p>账号角色：<b>{admin?.role === 'superadmin' ? '超级管理员' : admin?.role || '—'}</b></p><div className="setting-bottom"><span className="soft-tag">已认证</span><span>账号信息</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">PASSWORD & SECURITY</span><h2>修改登录密码</h2><form className="create-form" onSubmit={submitPasswordChange}><label>当前密码<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></label><label>新密码（至少 12 位）<input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></label><button className="submit-button" type="submit">更新密码</button></form>{passwordNotice && <p className="notice">{passwordNotice}</p>}</section>
      <section className="workspace-card settings-card"><span className="section-kicker">ACTIVE SESSIONS</span><h2>登录会话</h2><p>修改密码后，当前会话保留，其他会话将自动退出。你也可以通过退出按钮结束当前会话。</p><div className="setting-bottom"><span className="soft-tag">HttpOnly Cookie</span><span>会话管理</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">ACCOUNT ACTIVITY</span><h2>账号活动</h2><p>登录成功、失败和密码修改都会记录到操作日志，便于安全追踪。</p><div className="setting-bottom"><span className="soft-tag">已启用审计</span><span>登录记录</span></div></section>
    </div>
  </div>;
  if (moduleKey === 'security') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">SECURITY CENTER</div><h1>安全设置</h1><p>统一管理后台身份验证、会话和访问保护。</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">LOGIN PROTECTION</span><h2>登录保护</h2><p>登录失败限流、异常尝试锁定、管理员登录验证和安全告警。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>身份验证</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SESSION POLICY</span><h2>会话策略</h2><p>安全 Cookie、会话有效期、闲置超时和远程撤销会话。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>会话管理</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">API CREDENTIALS</span><h2>接口凭证安全</h2><p>API 密钥仅展示一次，数据库只保存摘要，支持轮换与吊销。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>密钥保护</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SECURITY EVENTS</span><h2>安全事件</h2><p>登录失败、权限拒绝、凭证轮换和敏感配置变更统一记录。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>安全审计</span></div></section>
    </div>
  </div>;
  if (moduleKey === 'settings') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">{data.eyebrow}</div><h1>{data.title}</h1><p>{modules.find(m => m.key === moduleKey).description}</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">PAYMENT CHANNEL</span><h2>支付渠道</h2><p>AppID：{health?.alipay?.app_id ? '已配置' : '未配置'}；应用私钥：{health?.alipay?.private_key ? '已配置' : '未配置'}；支付宝公钥：{health?.alipay?.public_key ? '已配置' : '未配置'}；商户 PID：{health?.alipay?.seller_id ? '已配置' : '未配置'}。异步通知地址：{health?.alipay?.notify_url || '未配置'}。密钥保存在服务器受限目录。</p><div className="setting-bottom"><span className="soft-tag">{health?.alipay?.seller_id ? '官方接口签名验证已通过，待支付宝客户端唤起验收' : '缺少商户 PID'}</span><span>支付宝</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SECURITY</span><h2>安全策略</h2><p>登录限流、安全会话、管理员权限保护、API 凭证哈希和操作审计。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>访问控制</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">DATA ISOLATION</span><h2>数据隔离</h2><p>每笔业务数据绑定站点上下文。服务端从 API 凭证解析站点身份，不信任客户端传入的站点标识。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>站点隔离</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">AUDIT LOG</span><h2>操作审计</h2><p>记录管理员、操作类型、目标资源、执行结果和时间，拒绝与失败操作同样留痕。</p><div className="setting-bottom"><span className="soft-tag">已启用</span><span>审计记录</span></div></section>
    </div>
  </div>;
  return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">{data.eyebrow}</div><h1>{data.title}</h1><p>{modules.find(m => m.key === moduleKey).description}</p></div>{data.action && ['sites','products','api','admins','refunds'].includes(moduleKey) && admin?.role !== 'viewer' && <button className="primary-action" onClick={() => { setFormError(''); setShowCreate(true); }}>{data.action}</button>}</div>
    {createdKey && <section className="workspace-card create-panel"><b>新 API Key（仅显示一次，请立即保存）</b><code>{createdKey}</code><button className="filter-reset" onClick={() => setCreatedKey('')}>我已保存</button></section>}
    {createdDeliverySecret && <section className="workspace-card create-panel"><b>站点 Webhook 签名密钥（请保存到对应业务网站）</b><code>{createdDeliverySecret}</code><button className="filter-reset" onClick={() => setCreatedDeliverySecret('')}>我已保存</button></section>}
    {showCreate && <section className="workspace-card create-panel"><div className="card-heading"><h2>{data.action}</h2><button className="filter-reset" type="button" onClick={() => setShowCreate(false)}>取消</button></div><form onSubmit={submitCreate} className="create-form">
      {moduleKey === 'sites' && <><label>网站名称<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></label><label>站点标识（小写字母、数字、短横线）<input required value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})} /></label><label>网站地址<input type="url" value={form.base_url} onChange={e=>setForm({...form,base_url:e.target.value})} placeholder="https://example.com" /></label><label>交付模式<select value={form.delivery_mode} onChange={e=>setForm({...form,delivery_mode:e.target.value})}><option value="manual">人工交付</option><option value="webhook">Webhook 自动交付</option><option value="internal">内部交付</option></select></label>{form.delivery_mode === 'webhook' && <label>HTTPS 交付接口<input required type="url" value={form.delivery_url} onChange={e=>setForm({...form,delivery_url:e.target.value})} placeholder="https://example.com/api/delivery" /></label>}</>}
      {moduleKey === 'products' && <><label>所属网站<select required value={form.site_id} onChange={e=>setForm({...form,site_id:e.target.value})}><option value="">请选择网站</option>{siteOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>商品名称<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></label><label>价格（人民币元）<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} /></label><label>商品说明<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></label><label>交付规则 JSON（可选）<textarea value={form.delivery_rule} onChange={e=>setForm({...form,delivery_rule:e.target.value})} placeholder='{"type":"license"}' /></label></>}
      {moduleKey === 'api' && <><label>所属网站<select required value={form.site_id} onChange={e=>setForm({...form,site_id:e.target.value})}><option value="">请选择网站</option>{siteOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>凭证名称<input value={form.label} onChange={e=>setForm({...form,label:e.target.value})} /></label></>}
      {moduleKey === 'admins' && <><label>管理员邮箱<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label><label>初始密码（至少 12 位）<input required type="password" minLength={12} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label><label>角色<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="operator">运营管理员</option><option value="viewer">只读管理员</option></select></label></>}
      {moduleKey === 'refunds' && <><p className="notice">发起后将调用支付宝官方退款接口，请先核对订单和退款金额。待处理及成功退款会占用可退额度。</p><label>已支付订单<select required value={form.order_id} onChange={e=>setForm({...form,order_id:e.target.value,amount:''})}><option value="">请选择订单</option>{orderOptions.map(o=><option key={o.id} value={o.id}>{o.order_no} · ¥{(o.amount_minor/100).toFixed(2)}（剩余可退 ¥{(o.remaining_minor/100).toFixed(2)}）</option>)}</select></label><label>退款金额（人民币元）<input required type="number" min="0.01" step="0.01" max={orderOptions.find(o=>o.id===form.order_id)?.remaining_minor / 100 || undefined} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} /></label><label>退款原因<input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} maxLength={120} /></label></>}
      {formError && <p className="notice">{formError}</p>}<button className="submit-button" type="submit" disabled={saving}>{saving ? '正在保存…' : '确认创建'}</button>
    </form></section>}
    <div className="table-toolbar"><div className="search-field"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`搜索${data.title}`} /></div><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="active">正常 / 已启用</option><option value="pending">待处理</option><option value="disabled">已停用</option></select><button className="filter-reset" onClick={() => {setSearch('');setStatus('all');}}>重置筛选</button></div>
    <section className="workspace-card table-card"><div className="table-scroll"><table><thead><tr>{data.columns.map(col => <th key={col}>{col}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={data.columns.length}><div className="empty-state"><h3>正在读取真实数据…</h3></div></td></tr> : filteredItems.length ? filteredItems.map((item, index) => <tr key={item.id || item.order_no || index}>{(fields[moduleKey] || []).map((field, i) => <td key={field + i}>{field === 'actions' ? (admin?.role === 'viewer' ? '只读' : moduleKey === 'sites' && item.delivery_mode !== 'webhook' ? '—' : moduleKey === 'admins' && item.is_protected ? '受保护' : moduleKey === 'delivery' && item.status === 'succeeded' ? '已完成' : <button className="filter-reset" onClick={() => runRowAction(item)}>{moduleKey === 'api' ? '吊销' : moduleKey === 'delivery' ? (['manual','internal'].includes(item.mode) ? '标记已交付' : '重试交付') : moduleKey === 'refunds' ? '核对渠道' : moduleKey === 'sites' ? '查看签名密钥' : item.status === 'disabled' ? '启用' : '停用'}</button>) : cellValue(item[field], field)}</td>)}</tr>) : <tr><td colSpan={data.columns.length}><div className="empty-state"><div className="empty-symbol">{modules.find(m => m.key === moduleKey).code}</div><h3>{data.empty}</h3><p>{data.note}</p><span>{endpoints[moduleKey] ? '当前没有真实记录或接口暂不可用' : '该模块接口尚未接入'}</span></div></td></tr>}</tbody></table></div></section>
    <div className="module-footnote">筛选控件和列表结构已建立；新增、编辑、删除及状态变更将在对应 API 和权限校验完成后开放。</div>
  </div>;
}

function Dashboard({ onExit, admin }) {
  const [active, setActive] = useState('overview');
  const current = modules.find(m => m.key === active) || modules[0];
  const groups = ['工作台', '业务管理', '交易中心', '财务中心', '系统管理', '账户中心'];
  return <main className="dashboard">
    <aside className="dash-sidebar"><Brand /><div className="sidebar-divider" /><div className="sidebar-groups">{groups.map(group => <div className="sidebar-group" key={group}><div className="dash-caption">{group}</div>{modules.filter(m => m.group === group).map(item => <button key={item.key} className={active === item.key ? 'dash-nav active' : 'dash-nav'} onClick={() => setActive(item.key)}><span className="nav-code">{item.code}</span>{item.label}</button>)}</div>)}</div><div className="sidebar-bottom"><div className="admin-chip"><span className="admin-avatar">管</span><div><b>{admin?.email || "管理员工作区"}</b><small>{admin?.role === "superadmin" ? "超级管理员" : "管理员"}</small></div></div><button className="dash-exit" onClick={onExit}>返回登录页</button></div></aside>
    <section className="dash-main"><header className="dash-top"><div className="breadcrumb"><span>晴天支付中心</span><i>/</i><b>{current.label}</b></div><div className="top-right"><span className="environment-tag">生产环境</span><button className="account-menu" onClick={() => setActive('profile')} aria-label="打开个人中心"><span className="top-logo">管</span><span>个人中心</span></button></div></header>
      {active === 'overview' ? <Overview onNavigate={setActive} /> : <DataModule key={active} moduleKey={active} admin={admin} />}
    </section>
  </main>;
}

function CheckoutPage() {
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!token || token.length > 256) {
      setError('付款链接无效，请返回商家重新获取订单。');
      setLoading(false);
      return;
    }
    apiFetch('/api/checkout/' + encodeURIComponent(token) + '/details', { credentials: 'omit', cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 410 ? '付款链接已过期或已使用，请返回商家重新获取。' : response.status === 409 ? '该订单当前不可付款。' : '暂时无法读取订单，请稍后重试。');
        return data;
      })
      .then(data => { if (alive) setOrder(data); })
      .catch(err => { if (alive) setError(err.message || '订单读取失败。'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);
  function beginAlipay() {
    if (!token || starting || !order) return;
    setStarting(true);
    window.location.assign(API_BASE + '/api/checkout/' + encodeURIComponent(token) + '/authorize');
  }
  const amount = order ? (Number(order.amount_minor) / 100).toFixed(2) : '—';
  return <main className="page-shell"><section className="login-panel" style={{minHeight:'100vh',justifyContent:'center'}}><div className="login-card">
    <div className="login-heading"><div className="welcome-tag">QINGTIAN PAYMENT</div><h2>订单收银台</h2><p>请核对订单信息后，使用支付宝完成付款。</p></div>
    {loading ? <p className="notice" role="status">正在安全读取订单…</p> : error ? <p className="notice" role="alert">{error}</p> : order && <>
      <div className="checkout-summary" style={{padding:'20px',border:'1px solid var(--line, #e5e7eb)',borderRadius:'14px',margin:'20px 0'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:'16px',paddingBottom:'14px'}}><span>商品 / 服务</span><strong style={{textAlign:'right'}}>{order.subject}</strong></div>
        <div style={{display:'flex',justifyContent:'space-between',gap:'16px',paddingBottom:'14px'}}><span>订单编号</span><strong style={{fontSize:'12px',textAlign:'right',wordBreak:'break-all'}}>{order.order_no}</strong></div>
        <div style={{borderTop:'1px solid var(--line, #e5e7eb)',paddingTop:'16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>应付金额</span><strong style={{fontSize:'28px',color:'var(--primary, #2563eb)'}}>¥{amount}</strong></div>
      </div>
      <button className="submit-button" type="button" onClick={beginAlipay} disabled={starting}>{starting ? '正在前往支付宝…' : '支付宝付款'}</button>
      <p className="secure-note" style={{marginTop:'16px'}}>支付将通过支付宝官方 JSAPI 完成。请在支付宝授权页面继续操作；支付结果以支付中心服务器确认为准。</p>
    </>}
    <div className="login-divider"><span>SECURE CHECKOUT</span></div>
    <p className="secure-note" style={{textAlign:'center'}}>晴天支付中心 · 安全收银台</p>
  </div></section></main>;
}

function PaymentLaunch() {
  const params = new URLSearchParams(window.location.search);
  const orderNo = params.get('order_no') || '';
  const tradeNO = params.get('trade_no') || '';
  const inAlipay = /AlipayClient/i.test(navigator.userAgent || '');
  const [bridgeReady, setBridgeReady] = useState(Boolean(window.AlipayJSBridge));
  const [state, setState] = useState('正在检查支付宝支付环境…');
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!tradeNO || !orderNo) {
      setState('付款链接无效，请返回商家重新获取二维码。');
      return;
    }
    if (!inAlipay) {
      setState('当前不是支付宝客户端。请返回支付宝，使用支付宝扫一扫打开此付款二维码。');
      return;
    }
    const onBridgeReady = () => setBridgeReady(true);
    if (window.AlipayJSBridge) setBridgeReady(true);
    else document.addEventListener('AlipayJSBridgeReady', onBridgeReady, { once: true });
    const bridgeTimeout = window.setTimeout(() => {
      if (!window.AlipayJSBridge) setState('支付宝支付组件尚未就绪，请稍后重试或重新扫码。');
    }, 10000);
    return () => {
      window.clearTimeout(bridgeTimeout);
      document.removeEventListener('AlipayJSBridgeReady', onBridgeReady);
    };
  }, [tradeNO, orderNo, inAlipay]);

  async function startPayment() {
    if (started || !tradeNO || !orderNo || !inAlipay || !window.AlipayJSBridge) return;
    setStarted(true);
    setState('正在打开支付宝收银台…');
    let pollTimer = null;
    let pollCount = 0;
    const checkOrder = async () => {
      try {
        const url = 'https://pay-api.lynli.me/api/payment-status?' + new URLSearchParams({ order_no: orderNo, trade_no: tradeNO });
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (data.status === 'paid') {
          setState('支付已由服务器确认到账，订单处理完成。');
          if (pollTimer) window.clearInterval(pollTimer);
        } else if (data.status === 'closed' || data.status === 'failed') {
          setState('订单状态：' + data.status + '。如有疑问请联系商家。');
          if (pollTimer) window.clearInterval(pollTimer);
        }
      } catch {}
    };
    const beginPolling = () => {
      if (pollTimer) return;
      checkOrder();
      pollTimer = window.setInterval(() => {
        pollCount += 1;
        if (pollCount > 60) {
          window.clearInterval(pollTimer);
          pollTimer = null;
          return;
        }
        checkOrder();
      }, 2000);
    };
    try {
      window.AlipayJSBridge.call('tradePay', { tradeNO }, result => {
        const code = String(result?.resultCode || result?.result_code || '');
        if (code === '9000') setState('支付宝已返回成功，正在向服务器核实到账…');
        else if (code === '8000') setState('支付宝处理中，正在核实订单，请勿重复付款。');
        else if (code === '6001') setState('你已取消支付。正在核实订单状态…');
        else if (code === '6002') setState('网络异常，正在向服务器核实订单状态…');
        else if (code === '6004') setState('支付结果未知，正在向服务器核实，请勿重复付款。');
        else setState('支付宝返回状态（' + (code || '未知') + '），正在核实服务器订单。');
        beginPolling();
      });
    } catch {
      setState('支付宝收银台未能唤起。请勿重复付款，正在核实订单状态。');
      beginPolling();
    }
  }

  return <main className="page-shell"><section className="login-panel" style={{minHeight:'100vh',justifyContent:'center'}}><div className="login-card">
    <div className="login-heading"><div className="welcome-tag">QINGTIAN PAYMENT</div><h2>支付宝订单付款</h2><p>订单号：{orderNo || '—'}</p></div>
    <p className="notice" role="status">{state}</p>
    {inAlipay && <button className="submit-button" type="button" onClick={startPayment} disabled={!bridgeReady || started || !tradeNO || !orderNo}>{started ? '已发起，请在支付宝完成操作' : bridgeReady ? '打开支付宝收银台' : '正在连接支付宝…'}</button>}
    {!inAlipay && <p className="secure-note">请在支付宝 App 中使用扫一扫打开此付款二维码；普通浏览器不能调用支付宝 JSAPI。</p>}
    {inAlipay && !bridgeReady && <p className="secure-note">请保持页面打开，等待支付宝支付组件加载。</p>}
  </div></section></main>;
}

function App() {
  const [account, setAccount] = useState(() => { try { return window.localStorage.getItem('qt_admin_account') || ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => { try { return window.localStorage.getItem('qt_remember_account') !== 'false'; } catch { return true; } });
  const [workspace, setWorkspace] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupSecret, setSetupSecret] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  if (window.location.pathname.startsWith('/checkout/')) return <CheckoutPage />;
  useEffect(() => {
    let alive = true;
    apiFetch('/api/auth/bootstrap-status', { credentials: 'include' }).then(r => r.json()).then(data => { if (alive) setSetupRequired(Boolean(data.required)); }).catch(() => {});
    apiFetch('/api/auth/me', { credentials: 'include' })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (alive && data?.admin) { setAdmin(data.admin); setWorkspace(true); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  async function handleBootstrap(event) {
    event.preventDefault(); setNotice('');
    if (initialPassword.length < 12) { setNotice('初始密码至少需要 12 位。'); return; }
    if (initialPassword !== confirmPassword) { setNotice('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      const response = await apiFetch('/api/auth/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Bootstrap-Secret': setupSecret }, credentials: 'include', body: JSON.stringify({ password: initialPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'forbidden' ? '初始化密钥不正确，请检查服务器初始化密钥。' : '初始化失败：' + (data.error || response.status));
      setSetupRequired(false); setSetupSecret(''); setInitialPassword(''); setConfirmPassword('');
      setNotice('超级管理员初始化成功，请使用管理员邮箱和新密码登录。');
    } catch (error) { setNotice(error.message || '初始化失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  if (setupRequired) return <main className="page-shell"><section className="login-panel"><div className="mobile-brand"><Brand compact /></div><div className="login-card"><div className="login-heading"><div className="welcome-tag">FIRST TIME SETUP</div><h2>初始化超级管理员</h2><p>首次使用，请设置三个受保护超级管理员的统一密码。</p></div><form onSubmit={handleBootstrap}><label htmlFor="setupSecret">一次性初始化密钥</label><div className="input-wrap"><input id="setupSecret" type="password" value={setupSecret} onChange={e => setSetupSecret(e.target.value)} autoComplete="off" required /></div><label htmlFor="initialPassword">设置新密码</label><div className="input-wrap"><input id="initialPassword" type="password" value={initialPassword} onChange={e => setInitialPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></div><label htmlFor="confirmPassword">再次确认密码</label><div className="input-wrap"><input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></div><button className="submit-button" type="submit" disabled={busy}>{busy ? '正在初始化…' : '完成初始化'}</button>{notice && <div className="notice" role="status">{notice}</div>}</form></div></section></main>;
  if (workspace) return <Dashboard admin={admin} onExit={async () => {
    await apiFetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setAdmin(null); setWorkspace(false);
  }} />;
  async function handleSubmit(event) {
    event.preventDefault(); setNotice(''); setBusy(true);
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ email: account, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'too_many_attempts' ? '登录尝试过多，请稍后再试。' : '账号或密码不正确，或账号尚未初始化。');
      if (remember) {
        try { window.localStorage.setItem('qt_admin_account', account); window.localStorage.setItem('qt_remember_account', 'true'); } catch {}
      } else {
        try { window.localStorage.removeItem('qt_admin_account'); window.localStorage.setItem('qt_remember_account', 'false'); } catch {}
      }
      setAdmin(data.admin); setPassword(''); setWorkspace(true);
    } catch (error) {
      setNotice(error.message || '登录服务暂时不可用，请稍后重试。');
    } finally { setBusy(false); }
  }
  return <main className="page-shell">
    <section className="visual-panel" aria-label="品牌介绍">
      <div className="visual-top"><Brand /></div>
      <div className="visual-content"><div className="eyebrow"><i /> PRIVATE PAYMENT WORKSPACE</div><h1>让每一笔收款<br /><em>清晰、有序、可控。</em></h1><p>为晴天旗下业务打造的统一支付管理中心。订单、支付与交付状态，在一个安全空间内集中管理。</p>
        <div className="feature-list"><div className="feature"><span className="feature-icon">01</span><div><b>统一收款管理</b><small>集中查看各业务订单与支付状态</small></div></div><div className="feature"><span className="feature-icon">02</span><div><b>多业务独立隔离</b><small>不同网站的数据与规则分别管理</small></div></div><div className="feature"><span className="feature-icon">03</span><div><b>支付流程可追踪</b><small>支付、退款与交付记录清晰可查</small></div></div></div>
      </div><div className="visual-footer"><span>SECURE BY DESIGN</span><span>晴天 · 专属支付系统</span></div>
    </section>
    <section className="login-panel"><div className="mobile-brand"><Brand compact /></div><div className="login-card">
      <div className="login-heading"><div className="welcome-tag">WELCOME BACK</div><h2>欢迎回来</h2><p>登录你的晴天支付中心账户</p></div>
      <form onSubmit={handleSubmit}><label htmlFor="account">账号</label><div className="input-wrap"><span className="input-symbol">◎</span><input id="account" name="account" type="email" autoComplete="username" placeholder="请输入管理员邮箱" value={account} onChange={e => setAccount(e.target.value)} required /></div><div className="label-row"><label htmlFor="password">登录密码</label></div><div className="input-wrap"><span className="input-symbol">⌑</span><input id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入登录密码" value={password} onChange={e => setPassword(e.target.value)} required /></div><div className="form-options"><label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="checkmark" />记住账号</label><span className="secure-note"><span>●</span> 安全登录</span></div><button className="submit-button" type="submit" disabled={busy}>{busy ? "正在验证…" : "登录管理中心"}</button>{notice && <div className="notice" role="status">{notice}</div>}</form>
      <div className="login-divider"><span>PRIVATE ACCESS</span></div><div className="access-note"><span className="lock">⌑</span><p>此系统仅供晴天自有业务管理使用<br /><b>仅限授权管理员访问</b></p></div>
    </div><footer className="login-footer"><span>© {new Date().getFullYear()} 晴天支付中心</span><span>专属管理 · 安全可靠</span></footer></section>
  </main>;
}

const Root = window.location.pathname === '/payment/launch' ? PaymentLaunch : App;
createRoot(document.getElementById('root')).render(<Root />);
