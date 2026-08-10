# 🌐 伽桦环保 · 对外官网

> 客户版官网（静态站），与内部看板（app/web）完全分离。**不含**供应商名、SKU、内部系统与成本信息。

## 目录
```
website/
├── index.html        # 单页官网（Hero/总成本/承诺/品类/代表产品/应用/资料下载/为什么/服务支持/流程/常见问题/关于/联系）
├── css/style.css     # 品牌样式（伽桦绿 #0E5A3A / 青绿 #12A594 / 米白）
├── js/main.js        # 导航 / 表单（表单为前端演示，接入后端后替换）
└── assets/
    ├── brand/        # 伽桦徽标
    ├── products/     # 品牌化产品实拍图（无水印）
    └── downloads/    # 可对外 PDF（产品图册 / 公司介绍 / Company Profile）
```

## 本地预览
```bash
cd "/Users/william/Desktop/workspace for codex/projects/project_006_伽桦环保工业过滤"
python3 scripts/start_daemon.py 8902     # 双 fork 守护启动（不会被会话回收）
# 浏览器打开 http://127.0.0.1:8902/site/  （内部预览路由）
# 或独立预览：
python3 -m http.server 8080 -d website
# 浏览器打开 http://127.0.0.1:8080
```

## 生产域名
- 已注册：`gavatech.cn`（伽桦科技，公司主域名）
- 官网 canonical / og:url 已指向 `https://gavatech.cn/`；.com 外贸域名后续可再补

## 部署（上线 · 推荐 Vercel）
1. 完整手把手步骤见 `../docs/官网部署上线_Vercel.md`
2. `website/` 含 `api/site_quote.js`（零依赖 SMTP 表单函数），Vercel 自动识别
3. 域名 `gavatech.cn`：www CNAME → `cname.vercel-dns.com`；@ A → `76.76.21.21`（MX/SPF 邮箱记录勿动）
4. 环境变量：GAVA_SMTP_HOST/PORT/USER/PASS/MAIL_TO（见部署文档）

## 上线前待办
- [ ] 联系表单接入真实提交（后端/邮箱/CRM），当前为前端演示
- [ ] 补充正式联系方式（电话/微信/邮箱）到「联系我们」
- [ ] 产品页可扩展为独立详情页或对接产品图册
- [ ] 英文版官网（可复用 company_en 文案）

## 维护
- 内容更新：直接改 `index.html` 文案；图片放 `assets/products/`；可对外 PDF 放 `assets/downloads/`
- 品牌规范：与品牌手册一致（色彩/字体/徽标），改动前先看 `app/web/brandbook.html`
- 参考学习：排版与使用参考 Camfil / Donaldson / 洁科膜等同类 B2B 过滤网站（产品→应用→资源→信任→联系 的漏斗结构 + 总拥有成本 TCO 话术）

## 自动部署
- 本仓库与 Vercel 项目 `website` 已连接：push 到 `main` 自动上线 https://www.gavatech.cn
- 生产环境变量：GAVA_SMTP_HOST / PORT / USER / PASS / MAIL_TO（在 Vercel 控制台配置）
