import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function Brand({ compact = false }) {
  return <div className={compact ? 'brand brand-compact' : 'brand'}>
    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="晴天支付中心" />
    <div className="brand-copy"><strong>晴天支付中心</strong><span>QINGTIAN PAYMENT</span></div>
  </div>;
}

function Dashboard({ onExit }) {
  const [active, setActive] = useState('总览');
  const nav = ['总览', '订单管理', '支付管理', '退款管理', '商品管理', '业务网站', '管理员设置', '系统设置'];
  return <main className="dashboard">
    <aside className="dash-sidebar"><Brand /><div className="dash-caption">管理中心</div>{nav.map(item =>
      <button key={item} className={active === item ? 'dash-nav active' : 'dash-nav'} onClick={() => setActive(item)}>{item}</button>)}
      <button className="dash-exit" onClick={onExit}>返回登录页</button>
    </aside>
    <section className="dash-main">
      <header className="dash-top"><div><b>{active}</b><small>晴天专属支付管理平台</small></div><span className="preview-pill">界面预览模式 · 非真实认证</span></header>
      <div className="dash-content"><div className="dash-welcome"><div><h1>{active === '总览' ? '业务总览' : active}</h1><p>管理入口与页面结构预览，真实数据和操作接口尚未接入。</p></div></div>
      {active === '总览' ? <>
        <div className="dash-stats">{[['今日订单','—'],['今日收款','¥ —'],['待处理退款','—'],['接入业务','—']].map(([label,value])=><article className="dash-stat" key={label}><span>{label}</span><strong>{value}</strong><small>等待连接真实数据</small></article>)}</div>
        <article className="dash-panel"><h3>系统初始化</h3><ul><li>超级管理员名单：待写入新数据库</li><li>登录认证与安全会话：待接入</li><li>支付宝官方支付接口：待配置</li><li>多网站业务隔离：待开发</li></ul></article>
      </> : <article className="dash-panel"><h3>{active}模块</h3><p>此模块已预留管理入口，下一步完善页面、数据结构和服务端接口。</p></article>}
      </div>
    </section>
  </main>;
}

function App() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [preview, setPreview] = useState(() => new URLSearchParams(window.location.search).get('workspace') === 'preview');
  const [notice, setNotice] = useState('');
  if (preview) return <Dashboard onExit={() => setPreview(false)} />;
  function handleSubmit(event) { event.preventDefault(); setNotice('登录认证服务尚未启用，请勿在此输入正式账户密码。'); }
  return <main className="page-shell">
    <section className="visual-panel" aria-label="品牌介绍">
      <div className="visual-top"><Brand /></div>
      <div className="visual-content">
        <div className="eyebrow"><i /> PRIVATE PAYMENT WORKSPACE</div>
        <h1>让每一笔收款<br /><em>清晰、有序、可控。</em></h1>
        <p>为晴天旗下业务打造的统一支付管理中心。订单、支付与交付状态，在一个安全空间内集中管理。</p>
        <div className="feature-list">
          <div className="feature"><span className="feature-icon">01</span><div><b>统一收款管理</b><small>集中查看各业务订单与支付状态</small></div></div>
          <div className="feature"><span className="feature-icon">02</span><div><b>多业务独立隔离</b><small>不同网站的数据与规则分别管理</small></div></div>
          <div className="feature"><span className="feature-icon">03</span><div><b>支付流程可追踪</b><small>支付、退款与交付记录清晰可查</small></div></div>
        </div>
      </div>
      <div className="visual-footer"><span>SECURE BY DESIGN</span><span>晴天 · 专属支付系统</span></div>
    </section>
    <section className="login-panel">
      <div className="mobile-brand"><Brand compact /></div>
      <div className="login-card">
        <div className="login-heading"><div className="welcome-tag">WELCOME BACK</div><h2>欢迎回来</h2><p>登录你的晴天支付中心账户</p></div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="account">账号</label><div className="input-wrap"><span className="input-symbol">◎</span><input id="account" name="account" type="email" autoComplete="username" placeholder="请输入管理员邮箱" value={account} onChange={e => setAccount(e.target.value)} required /></div>
          <div className="label-row"><label htmlFor="password">登录密码</label></div>
          <div className="input-wrap"><span className="input-symbol">⌑</span><input id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入登录密码" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <div className="form-options"><label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="checkmark" />记住账号</label><span className="secure-note"><span>●</span> 安全登录</span></div>
          <button className="submit-button" type="submit">登录管理中心</button>
          {notice && <div className="notice" role="status">{notice}</div>}
        </form>
        <div className="login-divider"><span>PRIVATE ACCESS</span></div>
        <div className="access-note"><span className="lock">⌑</span><p>此系统仅供晴天自有业务管理使用<br /><b>仅限授权管理员访问</b></p></div>
      </div>
      <footer className="login-footer"><span>© {new Date().getFullYear()} 晴天支付中心</span><span>专属管理 · 安全可靠</span></footer>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
