import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

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
  sites: { title: '业务网站', eyebrow: 'BUSINESS SITES', action: '添加业务网站', columns: ['网站名称', '站点标识', '网站地址', 'API 凭证', '状态', '创建时间'], empty: '还没有接入业务网站', note: '添加网站后，每个网站会获得独立的站点标识和 API 凭证。各站点商品、订单与交付数据相互隔离。' },
  products: { title: '商品管理', eyebrow: 'PRODUCT CATALOG', action: '添加商品', columns: ['商品名称', '所属网站', '商品价格', '币种', '交付方式', '状态', '更新时间'], empty: '暂无商品', note: '商品必须归属于一个业务网站。商品价格以人民币分为单位存储，避免浮点金额误差。' },
  api: { title: 'API 接口管理', eyebrow: 'API ACCESS', action: '创建 API 凭证', columns: ['凭证名称', '所属网站', 'Key 前缀', '权限范围', '最近调用', '有效期', '状态'], empty: '暂无 API 凭证', note: '每个业务网站使用独立 API 凭证。密钥只在创建时展示一次，数据库只保存 SHA-256 摘要；支持轮换、吊销和调用审计。' },
  orders: { title: '订单管理', eyebrow: 'ORDERS', action: '', columns: ['订单编号', '所属网站', '商品 / 订单标题', '订单金额', '买家信息', '订单状态', '创建时间'], empty: '暂无订单记录', note: '订单数据将按站点隔离展示。支付成功状态以服务端验签和渠道查询结果为准。' },
  payments: { title: '支付记录', eyebrow: 'PAYMENT TRANSACTIONS', action: '', columns: ['支付流水号', '订单编号', '所属网站', '支付渠道', '支付金额', '支付状态', '支付时间'], empty: '暂无支付流水', note: '首期接入支付宝官方接口。异步通知验签、主动查询补偿和幂等处理将在服务端实现。' },
  refunds: { title: '退款管理', eyebrow: 'REFUNDS', action: '', columns: ['退款单号', '原订单号', '所属网站', '退款金额', '退款原因', '退款状态', '申请时间'], empty: '暂无退款申请', note: '退款状态将与支付宝渠道结果同步，保留每次操作记录和管理员审计信息。' },
  delivery: { title: '交付管理', eyebrow: 'FULFILLMENT', action: '', columns: ['交付编号', '订单编号', '所属网站', '交付方式', '尝试次数', '交付状态', '最近执行时间'], empty: '暂无交付任务', note: '交付任务使用幂等键，支持失败重试与人工补发，避免重复交付。' },
  admins: { title: '管理员管理', eyebrow: 'ADMINISTRATION', action: '添加管理员', columns: ['管理员账号', '管理员名称', '角色', '模块权限', '账号状态', '最近登录', '创建时间'], empty: '管理员数据尚未初始化', note: '三个指定邮箱将作为受保护的超级管理员。可在此管理其他管理员、角色授权、账号启停和登录记录。密码只保存安全哈希，不写入代码或明文数据库字段。' },
  revenue: { title: '收款统计', eyebrow: 'REVENUE ANALYTICS', action: '', columns: ['统计日期', '所属网站', '订单总数', '支付成功', '收款金额', '退款金额', '净收款'], empty: '暂无收款统计', note: '统计数据以真实支付记录为基础，支持按网站和日期汇总，不展示模拟金额。' },
  ledger: { title: '资金流水', eyebrow: 'FINANCIAL LEDGER', action: '', columns: ['流水编号', '所属网站', '关联订单', '流水类型', '发生金额', '渠道交易号', '发生时间'], empty: '暂无资金流水', note: '收款和退款流水分别记录，保留渠道交易号与关联订单，便于核对追踪。' },
  security: { title: '安全设置', eyebrow: 'SECURITY CENTER', action: '', columns: [], empty: '', note: '' },
  logs: { title: '操作日志', eyebrow: 'AUDIT LOGS', action: '', columns: ['操作时间', '管理员', '操作模块', '操作内容', '来源 IP', '执行结果'], empty: '暂无操作记录', note: '记录关键配置变更、管理员操作、支付处理和权限调整，日志不允许普通管理员修改。' },
  settings: { title: '系统设置', eyebrow: 'SYSTEM CONFIGURATION', action: '', columns: [], empty: '', note: '' },
};

function Overview({ onNavigate }) {
  const cards = [
    ['今日订单', '—', '等待订单数据接入', 'orders'],
    ['今日收款', '¥ —', '等待支付数据接入', 'payments'],
    ['待处理退款', '—', '等待退款数据接入', 'refunds'],
    ['接入业务', '—', '等待站点数据接入', 'sites'],
  ];
  return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">OVERVIEW</div><h1>业务总览</h1><p>晴天旗下业务的统一支付管理入口。</p></div><div className="data-state"><i /> 后端已连接</div></div>
    <div className="overview-grid">{cards.map(([label,value,hint,target]) => <button className="metric-card" key={label} onClick={() => onNavigate(target)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></button>)}</div>
    <div className="overview-columns">
      <section className="workspace-card"><div className="card-heading"><div><span className="section-kicker">SYSTEM STATUS</span><h2>系统接入进度</h2></div><span className="soft-tag">开发中</span></div>
        <div className="status-list">
          <div className="status-row"><span className="status-mark pending">01</span><div><b>独立数据库</b><small>新建 D1 已创建并完成两份迁移，Worker 健康检查通过</small></div><em>已连接</em></div>
          <div className="status-row"><span className="status-mark pending">02</span><div><b>管理员认证</b><small>登录、会话和密码哈希接口已部署，等待首次超管初始化</small></div><em>待初始化</em></div>
          <div className="status-row"><span className="status-mark pending">03</span><div><b>支付宝 JSAPI</b><small>下单、异步通知验签和退款接口已部署，密钥配置与真实联调待完成</small></div><em>待联调</em></div>
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

function DataModule({ moduleKey }) {
  const data = moduleData[moduleKey];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const endpoints = { sites: '/api/sites', products: '/api/products', api: '/api/api-keys', orders: '/api/orders', payments: '/api/payments', refunds: '/api/refunds', delivery: '/api/deliveries', admins: '/api/admins', logs: '/api/audit-logs', revenue: '/api/analytics/revenue', ledger: '/api/ledger' };
  const fields = {
    sites: ['name','slug','base_url','key_prefix','status','created_at'],
    products: ['name','site_name','amount_minor','currency','delivery_mode','status','updated_at'],
    api: ['label','site_name','key_prefix','scope','last_used_at','expires_at','status'],
    orders: ['order_no','site_name','subject','amount_minor','buyer_ref','status','created_at'],
    payments: ['channel_trade_no','order_no','site_name','channel','amount_minor','status','paid_at'],
    refunds: ['refund_no','order_no','site_name','amount_minor','reason','status','created_at'],
    delivery: ['id','order_no','site_name','mode','attempt_count','status','updated_at'],
    admins: ['email','email','role','is_protected','status','last_login_at','created_at'],
    logs: ['created_at','actor_email','action','resource_type','resource_id','result'],
    revenue: ['date','site_name','order_count','paid_count','gross_minor','refund_minor','net_minor'],
    ledger: ['id','site_name','order_no','type','amount_minor','channel_trade_no','created_at'],
  };
  useEffect(() => {
    let alive = true;
    const endpoint = endpoints[moduleKey];
    if (!endpoint) { setItems([]); setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    fetch(endpoint, { credentials: 'include' }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '接口读取失败');
      return payload.items || [];
    }).then(rows => { if (alive) setItems(rows); }).catch(() => { if (alive) setItems([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [moduleKey]);
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
    if (field === 'status') return ({ active: '正常', disabled: '停用', pending: '待处理', paid: '已支付', succeeded: '成功', failed: '失败', processing: '处理中', refunded: '已退款', closed: '已关闭' })[value] || value;
    if (field.endsWith('_at')) return String(value).replace('T',' ').replace('Z','').slice(0,19);
    return String(value);
  }
  if (moduleKey === 'profile') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">MY ACCOUNT</div><h1>个人中心</h1><p>管理当前登录账号的资料、安全凭证和登录状态。</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">ACCOUNT PROFILE</span><h2>个人资料</h2><p>认证服务接入后显示当前管理员邮箱、账号名称、所属角色和账号创建时间。个人资料修改将保留变更记录。</p><div className="setting-bottom"><span className="soft-tag">等待登录认证</span><span>账号信息</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">PASSWORD & SECURITY</span><h2>密码与安全</h2><p>支持修改登录密码、查看密码更新时间，并对敏感操作执行身份验证。密码仅以安全哈希形式保存。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>安全凭证</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">ACTIVE SESSIONS</span><h2>登录会话</h2><p>查看当前设备和其他已登录设备，支持退出指定会话及全部其他会话。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>设备管理</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">ACCOUNT ACTIVITY</span><h2>账号活动</h2><p>查看最近登录时间、登录来源和安全事件。异常登录将进入安全审计记录。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>登录记录</span></div></section>
    </div>
  </div>;
  if (moduleKey === 'security') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">SECURITY CENTER</div><h1>安全设置</h1><p>统一管理后台身份验证、会话和访问保护。</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">LOGIN PROTECTION</span><h2>登录保护</h2><p>登录失败限流、异常尝试锁定、管理员登录验证和安全告警。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>身份验证</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SESSION POLICY</span><h2>会话策略</h2><p>安全 Cookie、会话有效期、闲置超时和远程撤销会话。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>会话管理</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">API CREDENTIALS</span><h2>接口凭证安全</h2><p>API 密钥仅展示一次，数据库只保存摘要，支持轮换与吊销。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>密钥保护</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SECURITY EVENTS</span><h2>安全事件</h2><p>登录失败、权限拒绝、凭证轮换和敏感配置变更统一记录。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>安全审计</span></div></section>
    </div>
  </div>;
  if (moduleKey === 'settings') return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">{data.eyebrow}</div><h1>{data.title}</h1><p>{modules.find(m => m.key === moduleKey).description}</p></div></div>
    <div className="settings-grid">
      <section className="workspace-card settings-card"><span className="section-kicker">PAYMENT CHANNEL</span><h2>支付渠道</h2><p>首期统一接入支付宝官方支付。应用 ID、私钥、支付宝公钥和证书等敏感配置仅保存在 Cloudflare Secrets。</p><div className="setting-bottom"><span className="soft-tag">尚未配置</span><span>支付宝</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">SECURITY</span><h2>安全策略</h2><p>登录限流、安全会话、管理员权限保护、API 凭证哈希和操作审计。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>访问控制</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">DATA ISOLATION</span><h2>数据隔离</h2><p>每笔业务数据绑定站点上下文。服务端从 API 凭证解析站点身份，不信任客户端传入的站点标识。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>站点隔离</span></div></section>
      <section className="workspace-card settings-card"><span className="section-kicker">AUDIT LOG</span><h2>操作审计</h2><p>记录管理员、操作类型、目标资源、执行结果和时间，拒绝与失败操作同样留痕。</p><div className="setting-bottom"><span className="soft-tag">待接入</span><span>审计记录</span></div></section>
    </div>
  </div>;
  return <div className="workspace-page">
    <div className="page-intro"><div><div className="page-eyebrow">{data.eyebrow}</div><h1>{data.title}</h1><p>{modules.find(m => m.key === moduleKey).description}</p></div>{data.action && <button className="primary-action" disabled title="数据库与服务端接口接通后启用">{data.action}</button>}</div>
    <div className="table-toolbar"><div className="search-field"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`搜索${data.title}`} /></div><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="active">正常 / 已启用</option><option value="pending">待处理</option><option value="disabled">已停用</option></select><button className="filter-reset" onClick={() => {setSearch('');setStatus('all');}}>重置筛选</button></div>
    <section className="workspace-card table-card"><div className="table-scroll"><table><thead><tr>{data.columns.map(col => <th key={col}>{col}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={data.columns.length}><div className="empty-state"><h3>正在读取真实数据…</h3></div></td></tr> : filteredItems.length ? filteredItems.map((item, index) => <tr key={item.id || item.order_no || index}>{(fields[moduleKey] || []).map((field, i) => <td key={field + i}>{cellValue(item[field], field)}</td>)}</tr>) : <tr><td colSpan={data.columns.length}><div className="empty-state"><div className="empty-symbol">{modules.find(m => m.key === moduleKey).code}</div><h3>{data.empty}</h3><p>{data.note}</p><span>{endpoints[moduleKey] ? '当前没有真实记录或接口暂不可用' : '该模块接口尚未接入'}</span></div></td></tr>}</tbody></table></div></section>
    <div className="module-footnote">筛选控件和列表结构已建立；新增、编辑、删除及状态变更将在对应 API 和权限校验完成后开放。</div>
  </div>;
}

function Dashboard({ onExit, admin }) {
  const [active, setActive] = useState('overview');
  const current = modules.find(m => m.key === active) || modules[0];
  const groups = ['工作台', '业务管理', '交易中心', '财务中心', '系统管理', '账户中心'];
  return <main className="dashboard">
    <aside className="dash-sidebar"><Brand /><div className="sidebar-divider" /><div className="sidebar-groups">{groups.map(group => <div className="sidebar-group" key={group}><div className="dash-caption">{group}</div>{modules.filter(m => m.group === group).map(item => <button key={item.key} className={active === item.key ? 'dash-nav active' : 'dash-nav'} onClick={() => setActive(item.key)}><span className="nav-code">{item.code}</span>{item.label}</button>)}</div>)}</div><div className="sidebar-bottom"><div className="admin-chip"><span className="admin-avatar">管</span><div><b>{admin?.email || "管理员工作区"}</b><small>{admin?.role === "superadmin" ? "超级管理员" : "管理员"}</small></div></div><button className="dash-exit" onClick={onExit}>返回登录页</button></div></aside>
    <section className="dash-main"><header className="dash-top"><div className="breadcrumb"><span>晴天支付中心</span><i>/</i><b>{current.label}</b></div><div className="top-right"><span className="environment-tag">开发环境</span><button className="account-menu" onClick={() => setActive('profile')} aria-label="打开个人中心"><span className="top-logo">管</span><span>个人中心</span></button></div></header>
      {active === 'overview' ? <Overview onNavigate={setActive} /> : <DataModule key={active} moduleKey={active} />}
    </section>
  </main>;
}

function App() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [workspace, setWorkspace] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupSecret, setSetupSecret] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/bootstrap-status', { credentials: 'include' }).then(r => r.json()).then(data => { if (alive) setSetupRequired(Boolean(data.required)); }).catch(() => {});
    fetch('/api/auth/me', { credentials: 'include' })
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
      const response = await fetch('/api/auth/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Bootstrap-Secret': setupSecret }, credentials: 'include', body: JSON.stringify({ password: initialPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'forbidden' ? '初始化密钥不正确，请检查 Cloudflare Secret。' : '初始化失败：' + (data.error || response.status));
      setSetupRequired(false); setSetupSecret(''); setInitialPassword(''); setConfirmPassword('');
      setNotice('超级管理员初始化成功，请使用管理员邮箱和新密码登录。');
    } catch (error) { setNotice(error.message || '初始化失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  if (setupRequired) return <main className="page-shell"><section className="login-panel"><div className="mobile-brand"><Brand compact /></div><div className="login-card"><div className="login-heading"><div className="welcome-tag">FIRST TIME SETUP</div><h2>初始化超级管理员</h2><p>首次使用，请设置三个受保护超级管理员的统一密码。</p></div><form onSubmit={handleBootstrap}><label htmlFor="setupSecret">一次性初始化密钥</label><div className="input-wrap"><input id="setupSecret" type="password" value={setupSecret} onChange={e => setSetupSecret(e.target.value)} autoComplete="off" required /></div><label htmlFor="initialPassword">设置新密码</label><div className="input-wrap"><input id="initialPassword" type="password" value={initialPassword} onChange={e => setInitialPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></div><label htmlFor="confirmPassword">再次确认密码</label><div className="input-wrap"><input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></div><button className="submit-button" type="submit" disabled={busy}>{busy ? '正在初始化…' : '完成初始化'}</button>{notice && <div className="notice" role="status">{notice}</div>}</form></div></section></main>;
  if (workspace) return <Dashboard admin={admin} onExit={async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setAdmin(null); setWorkspace(false);
  }} />;
  async function handleSubmit(event) {
    event.preventDefault(); setNotice(''); setBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ email: account, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'too_many_attempts' ? '登录尝试过多，请稍后再试。' : '账号或密码不正确，或账号尚未初始化。');
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

createRoot(document.getElementById('root')).render(<App />);
