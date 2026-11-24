import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function Brand({ compact = false }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="晴天支付中心" />
      <div className="brand-copy">
        <strong>晴天支付中心</strong>
        <span>QINGTIAN PAYMENT</span>
      </div>
    </div>
  );
}

function App() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [notice, setNotice] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    setNotice('登录认证服务尚未接入。当前为登录页面界面预览，账号密码不会发送或保存。');
  }

  return (
    <main className="page-shell">
      <section className="visual-panel" aria-label="品牌介绍">
        <div className="visual-top"><Brand /></div>
        <div className="visual-content">
          <div className="eyebrow"><i /> PRIVATE PAYMENT WORKSPACE</div>
          <h1>让每一笔收款<br /><em>清晰、有序、可控。</em></h1>
          <p>为晴天旗下业务打造的统一支付管理中心。订单、支付与交付状态，在一个安全空间内集中管理。</p>
          <div className="feature-list">
            <div className="feature"><span className="feature-icon">↗</span><div><b>统一收款管理</b><small>集中查看各业务订单与支付状态</small></div></div>
            <div className="feature"><span className="feature-icon">⌘</span><div><b>多业务独立隔离</b><small>不同网站的数据与规则分别管理</small></div></div>
            <div className="feature"><span className="feature-icon">✓</span><div><b>支付流程可追踪</b><small>支付、退款与交付记录清晰可查</small></div></div>
          </div>
        </div>
        <div className="visual-footer"><span>SECURE BY DESIGN</span><span>晴天 · 专属支付系统</span></div>
      </section>

      <section className="login-panel">
        <div className="mobile-brand"><Brand compact /></div>
        <div className="login-card">
          <div className="login-heading">
            <div className="welcome-tag">WELCOME BACK</div>
            <h2>欢迎回来</h2>
            <p>登录你的晴天支付中心账户</p>
          </div>
          <form onSubmit={handleSubmit}>
            <label htmlFor="account">账号</label>
            <div className="input-wrap">
              <span className="input-symbol">◎</span>
              <input id="account" name="account" type="text" autoComplete="username" placeholder="请输入管理账号" value={account} onChange={e => setAccount(e.target.value)} required />
            </div>
            <div className="label-row"><label htmlFor="password">登录密码</label></div>
            <div className="input-wrap">
              <span className="input-symbol">⌑</span>
              <input id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入登录密码" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="form-options">
              <label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="checkmark" />记住账号</label>
              <span className="secure-note"><span>●</span> 安全登录</span>
            </div>
            <button className="submit-button" type="submit">登录管理中心 <span>→</span></button>
            {notice && <div className="notice" role="status">{notice}</div>}
          </form>
          <div className="login-divider"><span>PRIVATE ACCESS</span></div>
          <div className="access-note"><span className="lock">⌑</span><p>此系统仅供晴天自有业务管理使用<br /><b>未经授权，请勿尝试访问</b></p></div>
        </div>
        <footer className="login-footer"><span>© {new Date().getFullYear()} 晴天支付中心</span><span>专属管理 · 安全可靠</span></footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);