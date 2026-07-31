/**
 * fund.js - 基金盯盘模块
 * 数据层 + API层 + 交易规则引擎 + UI渲染 + 提醒系统 + AI分析 + 调度器
 */
const Fund = {

  // 大盘数据缓存
  marketData: { indices: {}, lastUpdate: null },
  // 基金估值缓存
  valuations: {},
  // 当前编辑的基金ID
  editingFundId: null,
  // 当前选择的基本面评级
  selectedQuality: 'solid',

  // ===== 数据层 =====
  data: {
    KEYS: {
      funds: 'tripler_funds',
      trades: 'tripler_fund_trades',
      signals: 'tripler_fund_signals',
      history: 'tripler_fund_history',
      aiCache: 'tripler_fund_ai_cache'
    },

    loadFunds() {
      try {
        return JSON.parse(localStorage.getItem(this.KEYS.funds)) || [];
      } catch { return []; }
    },
    saveFunds(arr) {
      localStorage.setItem(this.KEYS.funds, JSON.stringify(arr));
    },
    addFund(fund) {
      const arr = this.loadFunds();
      arr.unshift(fund);
      this.saveFunds(arr);
    },
    updateFund(id, patch) {
      const arr = this.loadFunds();
      const idx = arr.findIndex(f => f.id === id);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], ...patch };
        this.saveFunds(arr);
      }
    },
    removeFund(id) {
      const arr = this.loadFunds().filter(f => f.id !== id);
      this.saveFunds(arr);
    },
    loadTrades() {
      try { return JSON.parse(localStorage.getItem(this.KEYS.trades)) || []; }
      catch { return []; }
    },
    saveTrades(arr) {
      localStorage.setItem(this.KEYS.trades, JSON.stringify(arr));
    },
    loadSignals() {
      try { return JSON.parse(localStorage.getItem(this.KEYS.signals)) || []; }
      catch { return []; }
    },
    saveSignals(arr) {
      localStorage.setItem(this.KEYS.signals, JSON.stringify(arr));
    },
    loadHistory() {
      try { return JSON.parse(localStorage.getItem(this.KEYS.history)) || {}; }
      catch { return {}; }
    },
    saveHistory(obj) {
      localStorage.setItem(this.KEYS.history, JSON.stringify(obj));
    },
    loadAICache() {
      try { return JSON.parse(localStorage.getItem(this.KEYS.aiCache)) || {}; }
      catch { return {}; }
    },
    saveAICache(obj) {
      localStorage.setItem(this.KEYS.aiCache, JSON.stringify(obj));
    }
  },

  // ===== API层 =====
  api: {
    // 通用JSONP方法
    jsonp(url, callbackName, timeout) {
      timeout = timeout || 6000;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('JSONP请求超时'));
        }, timeout);
        const cleanup = () => {
          clearTimeout(timer);
          try { delete window[callbackName]; } catch(e) { window[callbackName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
        };
        window[callbackName] = (data) => {
          cleanup();
          resolve(data);
        };
        script.onerror = () => {
          cleanup();
          reject(new Error('JSONP请求失败'));
        };
        script.src = url;
        document.head.appendChild(script);
      });
    },

    // 获取大盘指数（东方财富Push2，支持自定义回调名）
    async fetchMarketIndices() {
      const cb = 'cb_market_' + Date.now();
      const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?cb=' + cb +
        '&fltt=2&secids=1.000001,0.399001,0.399006,100.DJIA,100.NDX,100.SPX' +
        '&fields=f2,f3,f4,f12,f14';
      const data = await this.jsonp(url, cb);
      if (!data || !data.data || !data.data.diff) return {};
      const result = {};
      data.data.diff.forEach(item => {
        result[item.f12] = {
          name: item.f14,
          price: item.f2,
          change: item.f4,
          changePercent: item.f3
        };
      });
      return result;
    },

    // 获取基金实时估值（fundgz，回调名固定为jsonpgz，必须串行）
    async fetchFundValuation(code) {
      const url = 'https://fundgz.1234567.com.cn/js/' + code + '.js?rt=' + Date.now();
      const data = await this.jsonp(url, 'jsonpgz');
      if (!data || !data.fundcode) throw new Error('估值数据为空');
      return {
        code: data.fundcode,
        name: data.name,
        navDate: data.jzrq,
        nav: parseFloat(data.dwjz),
        estimatedNav: parseFloat(data.gsz),
        estimatedChange: parseFloat(data.gszzl),
        estimateTime: data.gztime
      };
    },

    // 批量获取所有自选基金估值（串行，因为回调名固定）
    async fetchAllValuations(funds) {
      const results = {};
      for (const fund of funds) {
        try {
          results[fund.code] = await this.fetchFundValuation(fund.code);
          // 如果基金没有名称，从API数据中补全
          if (results[fund.code].name && !fund.name) {
            Fund.data.updateFund(fund.id, { name: results[fund.code].name });
          }
        } catch(e) {
          console.warn('基金估值获取失败:', fund.code, e.message);
        }
        await new Promise(r => setTimeout(r, 200)); // 200ms间隔避免限流
      }
      return results;
    },

    // 获取基金历史净值（pingzhongdata，设置全局变量后读取）
    async fetchFundHistory(code) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => {
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('历史数据请求超时'));
        }, 8000);
        script.src = 'https://fund.eastmoney.com/pingzhongdata/' + code + '.js?v=' + Date.now();
        script.onload = () => {
          clearTimeout(timeout);
          try {
            // 清理可能存在的旧数据
            const netWorthTrend = window.Data_netWorthTrend || [];
            if (netWorthTrend.length === 0) {
              reject(new Error('历史数据为空'));
              if (script.parentNode) script.parentNode.removeChild(script);
              return;
            }
            // 取最近90天
            const recent = netWorthTrend.slice(-90);
            const dates = [];
            const values = [];
            const changes = [];
            for (let i = 0; i < recent.length; i++) {
              const point = recent[i];
              const date = new Date(point.x).toISOString().slice(0, 10);
              dates.push(date);
              values.push(point.y);
              if (i > 0) {
                changes.push(parseFloat(((point.y - recent[i-1].y) / recent[i-1].y).toFixed(6)));
              } else {
                changes.push(0);
              }
            }
            const result = {
              name: window.fS_name || '',
              dates: dates,
              values: values,
              changes: changes,
              returns: {
                m1: parseFloat(window.syl_1y || 0),
                m3: parseFloat(window.syl_3y || 0),
                m6: parseFloat(window.syl_6y || 0),
                y1: parseFloat(window.syl_1n || 0)
              },
              latestNav: values[values.length - 1] || 0
            };
            // 清理全局变量防止污染下次请求
            try { delete window.Data_netWorthTrend; } catch(e) { window.Data_netWorthTrend = undefined; }
            try { delete window.fS_name; } catch(e) { window.fS_name = undefined; }
            try { delete window.fS_code; } catch(e) { window.fS_code = undefined; }
            resolve(result);
          } catch(e) {
            reject(new Error('解析历史数据失败: ' + e.message));
          }
          if (script.parentNode) script.parentNode.removeChild(script);
        };
        script.onerror = () => {
          clearTimeout(timeout);
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('历史数据请求失败'));
        };
        document.head.appendChild(script);
      });
    }
  },

  // ===== 交易时段判断 =====
  tradingHours: {
    isAStockTrading() {
      const now = new Date();
      const day = now.getDay();
      if (day === 0 || day === 6) return false;
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes >= 570 && minutes < 690) return true;  // 9:30-11:30
      if (minutes >= 780 && minutes < 900) return true;  // 13:00-15:00
      return false;
    },
    isUSTrading() {
      const now = new Date();
      const day = now.getDay();
      // 美股北京时间 22:30-次日04:00（周一至周五，跨日）
      // 周六凌晨（周五美股）算交易，周日不算
      if (day === 0) return false; // 周日全天不交易
      const minutes = now.getHours() * 60 + now.getMinutes();
      // 22:30-24:00
      if (minutes >= 1350) return day !== 6; // 周六晚不交易
      // 00:00-04:00
      if (minutes < 240) return day === 2 || day === 3 || day === 4 || day === 5 || day === 6;
      return false;
    },
    isAnyTrading() {
      return this.isAStockTrading() || this.isUSTrading();
    },
    getRefreshInterval() {
      return this.isAnyTrading() ? 30000 : 300000; // 交易30s，非交易5min
    }
  },

  // ===== 交易规则引擎 =====
  engine: {
    // 规则配置
    rules: {
      consecutiveUp: { days: 3, reduceRatio: 0.3 },
      lossAdd: [
        { days: 1, addRatio: 0.15 },
        { days: 2, addRatio: 0.20 },
        { days: 3, addRatio: 0.50 },
        { days: 4, addRatio: 0.80 }
      ],
      breakEven: { reduceRatio: 0.5 },
      profit: [
        { threshold: 0.10, sellRatio: 0.33 },
        { threshold: 0.20, sellRatio: 0.33 }
      ],
      surge: { dailyPct: 0.07 }
    },

    // 计算连续涨跌天数
    calcConsecutiveDays(history) {
      if (!history || !history.changes || history.changes.length < 2) {
        return { up: 0, down: 0 };
      }
      const changes = history.changes;
      let up = 0, down = 0;
      // 从最后一天开始往前数连续涨/跌
      for (let i = changes.length - 1; i >= 0; i--) {
        if (changes[i] > 0.0001) {
          if (down > 0) break; // 之前在跌，现在涨，停止
          up++;
        } else if (changes[i] < -0.0001) {
          if (up > 0) break; // 之前在涨，现在跌，停止
          down++;
        } else {
          break; // 平盘打断
        }
      }
      return { up: up, down: down };
    },

    // 计算持仓盈亏
    calcProfitLoss(fund, currentPrice) {
      if (!fund.holdings || !fund.holdings.shares || fund.holdings.shares <= 0) {
        return { currentValue: 0, profitLoss: 0, profitLossRatio: 0 };
      }
      const currentValue = fund.holdings.shares * currentPrice;
      const totalInvest = fund.holdings.totalInvest || (fund.holdings.shares * fund.holdings.avgCost);
      const profitLoss = currentValue - totalInvest;
      const profitLossRatio = totalInvest > 0 ? profitLoss / totalInvest : 0;
      return { currentValue: currentValue, profitLoss: profitLoss, profitLossRatio: profitLossRatio };
    },

    // 检查所有规则，生成信号列表
    checkAllRules(fund, currentPrice, history) {
      const signals = [];
      const consecutive = this.calcConsecutiveDays(history);
      const pl = this.calcProfitLoss(fund, currentPrice);

      // 只对有持仓的基金检查
      const hasHoldings = fund.holdings && fund.holdings.shares > 0;

      if (hasHoldings) {
        // 1. 连涨3天减仓30%
        if (consecutive.up >= this.rules.consecutiveUp.days) {
          signals.push({
            type: 'reduce_position',
            rule: 'consecutive_up_' + consecutive.up,
            message: '连涨' + consecutive.up + '天，建议减仓' + (this.rules.consecutiveUp.reduceRatio * 100) + '%',
            strength: 'strong'
          });
        }

        // 2. 浮亏阶梯加仓
        if (consecutive.down > 0 && pl.profitLossRatio < 0) {
          const lossRule = this.rules.lossAdd.find(r => r.days === consecutive.down);
          if (lossRule) {
            signals.push({
              type: 'add_position',
              rule: 'loss_' + consecutive.down + 'd_' + (lossRule.addRatio * 100) + 'pct',
              message: '浮亏' + consecutive.down + '天，建议加仓' + (lossRule.addRatio * 100) + '%',
              strength: consecutive.down >= 3 ? 'strong' : 'normal'
            });
          }
        }

        // 3. 回本砍半仓（持仓从浮亏状态回到盈亏平衡附近）
        // 不要求当前连跌，只要有持仓且盈亏接近0即可
        if (pl.profitLossRatio >= -0.01 && pl.profitLossRatio <= 0.01 && fund.holdings.avgCost > 0) {
          // 检查是否之前有过浮亏（通过历史记录）
          const hadLoss = history && history.changes &&
            history.changes.some(c => c < -0.001);
          if (hadLoss) {
            signals.push({
              type: 'reduce_position',
              rule: 'breakeven',
              message: '持仓回本，建议砍半仓，不贪心恋战',
              strength: 'normal'
            });
          }
        }

        // 4. 阶梯止盈
        if (pl.profitLossRatio >= this.rules.profit[1].threshold) {
          signals.push({
            type: 'stop_profit',
            rule: 'profit_20pct',
            message: '盈利达20%，建议再卖出1/3，落袋为安',
            strength: 'strong'
          });
        } else if (pl.profitLossRatio >= this.rules.profit[0].threshold) {
          signals.push({
            type: 'stop_profit',
            rule: 'profit_10pct',
            message: '盈利达10%，建议卖出1/3，锁住部分利润',
            strength: 'normal'
          });
        }

        // 5. 单日暴涨7%清仓留底仓
        const todayChange = history && history.changes && history.changes.length > 0
          ? history.changes[history.changes.length - 1] : 0;
        if (todayChange >= this.rules.surge.dailyPct) {
          signals.push({
            type: 'clear_position',
            rule: 'surge_7pct',
            message: '单日暴涨' + (todayChange * 100).toFixed(1) + '%，建议清仓只留底仓',
            strength: 'strong'
          });
        }
      }

      // 6. 买入红线检查（对所有基金都检查）
      if (fund.fundamentals === 'weak') {
        signals.push({
          type: 'buy_warning',
          rule: 'buy_redline',
          message: '该基金基本面评级不足，不建议买入',
          strength: 'strong'
        });
      }

      return signals;
    }
  },

  // ===== UI层 =====
  ui: {
    render() {
      this.renderMarketOverview();
      this.renderFundList();
      this.renderSignals();
    },

    renderMarketOverview() {
      const container = document.getElementById('market-indices');
      if (!container) return;
      const indices = Fund.marketData.indices;
      const keys = Object.keys(indices);

      if (keys.length === 0) {
        container.innerHTML = '<div class="fund-loading">加载大盘数据中...</div>';
        return;
      }

      // 更新时间
      const timeEl = document.getElementById('fund-update-time');
      if (timeEl && Fund.marketData.lastUpdate) {
        const t = new Date(Fund.marketData.lastUpdate);
        timeEl.textContent = '更新于 ' + t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0') + ':' + t.getSeconds().toString().padStart(2,'0');
      }

      const displayOrder = ['000001', '399001', '399006', 'DJIA', 'NDX', 'SPX'];
      container.innerHTML = displayOrder.filter(k => indices[k]).map(key => {
        const idx = indices[key];
        const pct = idx.changePercent || 0;
        const cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
        const arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '—');
        return '<div class="market-index-card ' + cls + '">' +
          '<div class="market-index-name">' + idx.name + '</div>' +
          '<div class="market-index-price">' + (idx.price || '--').toLocaleString() + '</div>' +
          '<div class="market-index-change">' + arrow + ' ' + Math.abs(pct).toFixed(2) + '%</div>' +
        '</div>';
      }).join('');
    },

    renderFundList() {
      const container = document.getElementById('fund-list');
      if (!container) return;
      const funds = Fund.data.loadFunds();

      if (funds.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
          '<div class="empty-icon" style="font-size:48px;">📊</div>' +
          '<div class="empty-title">暂无自选基金</div>' +
          '<div class="empty-desc">点击右上角"添加"按钮<br>输入基金代码开始盯盘</div>' +
        '</div>';
        return;
      }

      const historyCache = Fund.data.loadHistory();
      const aiCache = Fund.data.loadAICache();
      const today = new Date().toISOString().slice(0, 10);

      container.innerHTML = funds.map(fund => {
        const val = Fund.valuations[fund.code];
        const history = historyCache[fund.code];
        let navDisplay = '--';
        let changePct = 0;
        let cardCls = 'flat';
        let plHtml = '';
        let holdDays = 0;
        let tagsHtml = '';

        // 优先用实时估值，其次用历史最新净值
        let currentPrice = 0;
        let priceSource = '';

        if (val && val.estimatedNav) {
          navDisplay = val.estimatedNav.toFixed(4);
          changePct = val.estimatedChange || 0;
          currentPrice = val.estimatedNav;
          priceSource = '估值';
        } else if (val && val.nav) {
          navDisplay = val.nav.toFixed(4);
          changePct = val.estimatedChange || 0;
          currentPrice = val.nav;
          priceSource = '净值';
        } else if (history && history.values && history.values.length > 0) {
          const latestNav = history.values[history.values.length - 1];
          navDisplay = latestNav.toFixed(4);
          // 从历史数据计算今日涨跌
          if (history.changes && history.changes.length > 0) {
            changePct = (history.changes[history.changes.length - 1] * 100);
          }
          currentPrice = latestNav;
          priceSource = '历史';
        } else if (fund.holdings && fund.holdings.avgCost) {
          navDisplay = fund.holdings.avgCost.toFixed(4);
          currentPrice = fund.holdings.avgCost;
          priceSource = '成本';
        }

        cardCls = changePct > 0 ? 'up' : (changePct < 0 ? 'down' : 'flat');

        // 基金名称降级：API名称 > 历史名称 > 代码
        const displayName = fund.name || (history && history.name) || val?.name || ('基金' + fund.code);

        // 持仓信息
        if (fund.holdings && fund.holdings.shares > 0 && currentPrice > 0) {
          const pl = Fund.engine.calcProfitLoss(fund, currentPrice);
          const plCls = pl.profitLoss > 0 ? 'up' : (pl.profitLoss < 0 ? 'down' : '');
          plHtml = '<div class="fund-stat">' +
            '<div class="fund-stat-label">持仓盈亏</div>' +
            '<div class="fund-stat-value ' + plCls + '">' +
              (pl.profitLoss >= 0 ? '+' : '') + pl.profitLoss.toFixed(2) +
              ' (' + (pl.profitLossRatio >= 0 ? '+' : '') + (pl.profitLossRatio * 100).toFixed(2) + '%)' +
            '</div>' +
          '</div>' +
          '<div class="fund-stat">' +
            '<div class="fund-stat-label">当前市值</div>' +
            '<div class="fund-stat-value">' + pl.currentValue.toFixed(2) + '</div>' +
          '</div>' +
          '<div class="fund-stat">' +
            '<div class="fund-stat-label">持仓份额</div>' +
            '<div class="fund-stat-value">' + fund.holdings.shares.toFixed(2) + '</div>' +
          '</div>';

          // 持仓天数
          if (fund.holdings.buyDate) {
            const buyDate = new Date(fund.holdings.buyDate);
            holdDays = Math.floor((new Date() - buyDate) / 86400000);
            if (holdDays >= 0) {
              tagsHtml += '<span class="fund-tag hold-days">📅 持仓' + holdDays + '天</span>';
            }
          }
        }

        // 基本面标签
        if (fund.fundamentals === 'solid') {
          tagsHtml += '<span class="fund-tag quality-solid">⭐ 业绩过硬</span>';
        } else if (fund.fundamentals === 'weak') {
          tagsHtml += '<span class="fund-tag quality-weak">⚠️ 基本面差</span>';
        }

        // AI推荐标签
        const aiResult = aiCache[fund.code];
        if (aiResult && aiResult.result) {
          const rec = aiResult.result.recommendation;
          const recLabels = {
            short: '🔥 推荐短线',
            long: '💎 推荐长线持有',
            hold: '👀 建议观望',
            reduce: '🔻 建议减仓'
          };
          const recCls = {
            short: 'ai-short', long: 'ai-long', hold: 'ai-hold', reduce: 'ai-reduce'
          };
          if (recLabels[rec]) {
            tagsHtml += '<span class="fund-tag ' + recCls[rec] + '">' + recLabels[rec] + '</span>';
          }
        }

        // 今日交易信号标签
        const signals = Fund.data.loadSignals().filter(s =>
          s.fundId === fund.id && s.triggerTime.startsWith(today)
        );
        if (signals.length > 0) {
          tagsHtml += '<span class="fund-tag signal">⚡ ' + signals.length + '个信号</span>';
        }

        const arrow = changePct > 0 ? '▲' : (changePct < 0 ? '▼' : '—');

        return '<div class="fund-card ' + cardCls + '" data-fund-id="' + fund.id + '">' +
          '<div class="fund-card-header">' +
            '<div>' +
              '<div class="fund-card-name">' + displayName + '</div>' +
              '<div class="fund-card-code">' + fund.code + '</div>' +
            '</div>' +
            '<div class="fund-card-valuation">' +
              '<div class="fund-card-nav">' + navDisplay + '</div>' +
              '<div class="fund-card-change">' + arrow + ' ' + Math.abs(changePct).toFixed(2) + '%</div>' +
            '</div>' +
          '</div>' +
          '<div class="fund-card-body">' + plHtml +
            (priceSource ? '<div class="fund-stat"><div class="fund-stat-label">数据来源</div><div class="fund-stat-value" style="font-size:12px;">' + priceSource + '</div></div>' : '') +
          '</div>' +
          (tagsHtml ? '<div class="fund-card-tags">' + tagsHtml + '</div>' : '') +
          '<div class="fund-card-actions">' +
            '<button class="fund-action-btn" data-action="edit">✏️ 编辑</button>' +
            '<button class="fund-action-btn" data-action="ai">🤖 AI分析</button>' +
            '<button class="fund-action-btn danger" data-action="delete">🗑 删除</button>' +
          '</div>' +
        '</div>';
      }).join('');
    },

    renderSignals() {
      const section = document.getElementById('fund-signals-section');
      const list = document.getElementById('fund-signals-list');
      if (!section || !list) return;

      const today = new Date().toISOString().slice(0, 10);
      const signals = Fund.data.loadSignals().filter(s => s.triggerTime.startsWith(today));

      if (signals.length === 0) {
        section.classList.add('hidden');
        return;
      }

      section.classList.remove('hidden');
      list.innerHTML = signals.sort((a, b) => new Date(b.triggerTime) - new Date(a.triggerTime)).map(sig => {
        const time = new Date(sig.triggerTime);
        const timeStr = time.getHours().toString().padStart(2,'0') + ':' + time.getMinutes().toString().padStart(2,'0');
        return '<div class="fund-signal-item ' + sig.strength + '">' +
          '<div class="fund-signal-icon">' + (sig.strength === 'strong' ? '🔴' : '🟡') + '</div>' +
          '<div class="fund-signal-body">' +
            '<div class="fund-signal-title">' + sig.fundName + '</div>' +
            '<div class="fund-signal-msg">' + sig.message + '</div>' +
          '</div>' +
          '<div class="fund-signal-time">' + timeStr + '</div>' +
        '</div>';
      }).join('');
    }
  },

  // ===== 模态框 =====
  modal: {
    openAdd() {
      Fund.editingFundId = null;
      document.getElementById('fund-modal-title').textContent = '添加基金';
      document.getElementById('inp-fund-code').value = '';
      document.getElementById('inp-fund-code').disabled = false;
      document.getElementById('inp-fund-shares').value = '';
      document.getElementById('inp-fund-cost').value = '';
      document.getElementById('inp-fund-date').value = new Date().toISOString().slice(0, 10);
      Fund.selectedQuality = 'solid';
      document.querySelectorAll('#modal-fund .cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === 'solid');
      });
      document.getElementById('modal-fund').classList.add('open');
    },

    openEdit(fundId) {
      const fund = Fund.data.loadFunds().find(f => f.id === fundId);
      if (!fund) return;
      Fund.editingFundId = fundId;
      document.getElementById('fund-modal-title').textContent = '编辑基金';
      document.getElementById('inp-fund-code').value = fund.code;
      document.getElementById('inp-fund-code').disabled = true;
      document.getElementById('inp-fund-shares').value = fund.holdings?.shares || '';
      document.getElementById('inp-fund-cost').value = fund.holdings?.avgCost || '';
      document.getElementById('inp-fund-date').value = fund.holdings?.buyDate || new Date().toISOString().slice(0, 10);
      Fund.selectedQuality = fund.fundamentals || 'solid';
      document.querySelectorAll('#modal-fund .cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === Fund.selectedQuality);
      });
      document.getElementById('modal-fund').classList.add('open');
    },

    close() {
      document.getElementById('modal-fund').classList.remove('open');
    },

    async save() {
      const code = document.getElementById('inp-fund-code').value.trim();
      const shares = parseFloat(document.getElementById('inp-fund-shares').value) || 0;
      const cost = parseFloat(document.getElementById('inp-fund-cost').value) || 0;
      const date = document.getElementById('inp-fund-date').value;
      const quality = Fund.selectedQuality;

      if (!code || !/^\d{6}$/.test(code)) {
        App.showToast('请输入6位数字基金代码');
        return;
      }

      // 检查是否已存在（新增模式下）
      if (!Fund.editingFundId) {
        const existing = Fund.data.loadFunds().find(f => f.code === code);
        if (existing) {
          App.showToast('该基金已存在');
          return;
        }
      }

      // 先构建数据并立即保存，不阻塞等待网络请求
      let fundName = '';
      if (Fund.editingFundId) {
        const existing = Fund.data.loadFunds().find(f => f.id === Fund.editingFundId);
        if (existing) fundName = existing.name || '';
      }

      const fundData = {
        code: code,
        name: fundName,
        holdings: {
          shares: shares,
          avgCost: cost,
          totalInvest: shares * cost,
          buyDate: date
        },
        fundamentals: quality,
        createdAt: new Date().toISOString()
      };

      if (Fund.editingFundId) {
        const existing = Fund.data.loadFunds().find(f => f.id === Fund.editingFundId);
        if (existing) {
          fundData.createdAt = existing.createdAt;
        }
        Fund.data.updateFund(Fund.editingFundId, fundData);
        App.showToast('基金已更新');
      } else {
        fundData.id = 'fund_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        Fund.data.addFund(fundData);
        App.showToast('基金已添加，正在获取数据...');
      }

      // 先关闭模态框并刷新列表，让用户立即看到结果
      this.close();
      Fund.ui.renderFundList();

      // 异步获取基金名称（不阻塞保存流程）
      if (!fundName) {
        Fund.api.fetchFundValuation(code).then(val => {
          if (val && val.name) {
            const fundId = Fund.editingFundId || fundData.id;
            Fund.data.updateFund(fundId, { name: val.name });
            Fund.ui.renderFundList();
          }
        }).catch(() => {
          // 获取名称失败，后台静默处理
          console.warn('基金名称获取失败，可稍后自动补全');
        });
      }

      // 异步刷新估值数据
      Fund.scheduler.refreshAll();
    }
  },

  // ===== 提醒系统 =====
  reminder: {
    checkAndNotify() {
      const funds = Fund.data.loadFunds();
      const historyCache = Fund.data.loadHistory();
      const existingSignals = Fund.data.loadSignals();
      const notifiedIds = new Set(existingSignals.map(s => s.id));
      const today = new Date().toISOString().slice(0, 10);
      let newSignals = [];

      funds.forEach(fund => {
        const val = Fund.valuations[fund.code];
        if (!val) return;
        const currentPrice = val.estimatedNav || val.nav;
        if (!currentPrice || isNaN(currentPrice)) return;

        const history = historyCache[fund.code];
        const signals = Fund.engine.checkAllRules(fund, currentPrice, history);

        signals.forEach(sig => {
          const sigId = fund.id + '_' + sig.rule + '_' + today;
          if (notifiedIds.has(sigId)) return;

          const fullSignal = {
            id: sigId,
            fundId: fund.id,
            fundCode: fund.code,
            fundName: fund.name || fund.code,
            type: sig.type,
            rule: sig.rule,
            message: sig.message,
            strength: sig.strength,
            triggerTime: new Date().toISOString()
          };
          newSignals.push(fullSignal);
          existingSignals.push(fullSignal);
          this.sendNotification(fullSignal);
        });
      });

      if (newSignals.length > 0) {
        // 清理7天前的旧信号
        const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
        const cleaned = existingSignals.filter(s => s.triggerTime > cutoff);
        Fund.data.saveSignals(cleaned);
        Fund.ui.renderSignals();
      }
    },

    sendNotification(signal) {
      const fundName = signal.fundName;
      // 系统通知
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('基金盯盘: ' + fundName, {
            body: signal.message,
            icon: 'icon.svg',
            tag: signal.id
          });
        } catch(e) {}
      }
      // 应用内横幅（复用App.reminder）
      if (typeof App !== 'undefined' && App.reminder && App.reminder.showInAppBanner) {
        App.reminder.showInAppBanner(
          { title: fundName + ' - 交易信号', category: signal.strength === 'strong' ? 'work' : 'life', id: signal.id },
          0,
          signal.message
        );
      }
      // 播放声音
      if (typeof App !== 'undefined' && App.reminder) {
        const settings = App.data.loadSettings();
        App.reminder.playSound(settings.notification.soundType, settings.notification.soundEnabled).catch(function(){});
      }
      // 震动
      if ('vibrate' in navigator) {
        navigator.vibrate(signal.strength === 'strong' ? [300, 100, 300] : [200]);
      }
    }
  },

  // ===== AI分析 =====
  aiAnalysis: {
    async analyzeAll() {
      const settings = App.data.loadSettings();
      if (!settings.ai || !settings.ai.apiKey) return; // 无API Key跳过

      const funds = Fund.data.loadFunds();
      const aiCache = Fund.data.loadAICache();
      const historyCache = Fund.data.loadHistory();
      const now = Date.now();
      const oneDay = 86400000;

      for (const fund of funds) {
        const cached = aiCache[fund.code];
        // 24小时内已分析过则跳过
        if (cached && cached.updatedAt && (now - new Date(cached.updatedAt).getTime()) < oneDay) continue;

        try {
          const result = await this.analyzeFund(fund, historyCache[fund.code]);
          aiCache[fund.code] = { result: result, updatedAt: new Date().toISOString() };
          Fund.data.saveAICache(aiCache);
        } catch(e) {
          console.warn('AI分析失败:', fund.code, e.message);
        }
        await new Promise(r => setTimeout(r, 1000)); // 1s间隔避免API限流
      }
      Fund.ui.renderFundList();
    },

    async analyzeFund(fund, history) {
      const settings = App.data.loadSettings();
      if (!settings.ai || !settings.ai.apiKey) {
        App.showToast('请先在设置中配置AI API Key');
        return null;
      }

      App.showToast('正在分析 ' + (fund.name || fund.code) + '...');

      // 构建分析数据
      const returns = history?.returns || {};
      const changes = history?.changes || [];
      const recentTrend = changes.slice(-5);
      const trendDesc = recentTrend.map(c => (c * 100).toFixed(2) + '%').join(' → ') || '无数据';

      // 大盘数据
      const indices = Fund.marketData.indices;
      const shIdx = indices['000001'];
      const ndxIdx = indices['NDX'];

      const systemPrompt = '你是一个专业的基金分析助手。根据基金的净值走势、收益率和当前大盘环境，分析该基金的短期和长期投资价值。\n\n你必须严格按以下JSON格式返回，不要包含其他内容：\n{\n  "recommendation": "short" | "long" | "hold" | "reduce",\n  "reason": "50字以内的分析理由",\n  "confidence": 0.0到1.0的数字,\n  "riskLevel": "low" | "medium" | "high",\n  "keyPoints": ["要点1", "要点2", "要点3"]\n}\n\n分析维度：\n- short（推荐短线）：适合短期持有，预期1-2周内有较好表现\n- long（推荐长线持有）：基本面扎实，适合长期持有\n- hold（建议观望）：建议观望，等待更佳时机\n- reduce（建议减仓）：当前风险较高，建议减仓';

      const userPrompt = '基金名称：' + (fund.name || '未知') + '（' + fund.code + '）\n' +
        '基本面评级：' + (fund.fundamentals === 'solid' ? '业绩过硬' : fund.fundamentals === 'ok' ? '一般' : '基本面差') + '\n' +
        '近5天涨跌幅：' + trendDesc + '\n' +
        '近1月收益率：' + (returns.m1 || '未知') + '%\n' +
        '近3月收益率：' + (returns.m3 || '未知') + '%\n' +
        '近半年收益率：' + (returns.m6 || '未知') + '%\n' +
        '近1年收益率：' + (returns.y1 || '未知') + '%\n\n' +
        '大盘环境：\n' +
        '上证指数：' + (shIdx ? shIdx.price + ' (' + shIdx.changePercent + '%)' : '未知') + '\n' +
        '纳斯达克：' + (ndxIdx ? ndxIdx.price + ' (' + ndxIdx.changePercent + '%)' : '未知') + '\n\n' +
        '请分析该基金适合短线还是长线持有。';

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const rawResponse = await AI.callAI(messages);
      const parsed = AI.parseAIJSON(rawResponse);

      const result = {
        recommendation: parsed.recommendation || 'hold',
        reason: parsed.reason || '无法获取分析结果',
        confidence: parseFloat(parsed.confidence) || 0.5,
        riskLevel: parsed.riskLevel || 'medium',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        updatedAt: new Date().toISOString()
      };

      // 缓存结果
      const aiCache = Fund.data.loadAICache();
      aiCache[fund.code] = { result: result, updatedAt: new Date().toISOString() };
      Fund.data.saveAICache(aiCache);

      App.showToast((fund.name || fund.code) + ' 分析完成: ' + result.reason);
      Fund.ui.renderFundList();
      return result;
    }
  },

  // ===== 调度器 =====
  scheduler: {
    refreshTimer: null,
    isRefreshing: false,

    start() {
      this.stop();
      const tick = async () => {
        await this.refreshAll();
        const interval = Fund.tradingHours.getRefreshInterval();
        this.refreshTimer = setTimeout(tick, interval);
      };
      tick();
    },

    stop() {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
    },

    async refreshAll() {
      if (this.isRefreshing) return;
      this.isRefreshing = true;

      try {
        // 1. 刷新大盘指数
        const indices = await Fund.api.fetchMarketIndices();
        Fund.marketData.indices = indices;
        Fund.marketData.lastUpdate = new Date();
        Fund.ui.renderMarketOverview();
      } catch(e) {
        console.warn('大盘数据刷新失败:', e.message);
      }

      // 2. 刷新基金估值
      const funds = Fund.data.loadFunds();
      if (funds.length > 0) {
        try {
          const valuations = await Fund.api.fetchAllValuations(funds);
          Fund.valuations = { ...Fund.valuations, ...valuations };
          Fund.ui.renderFundList();
        } catch(e) {
          console.warn('基金估值刷新失败:', e.message);
        }

        // 3. 刷新历史数据（每天只需一次，检查缓存日期）
        const historyCache = Fund.data.loadHistory();
        const today = new Date().toISOString().slice(0, 10);
        for (const fund of funds) {
          const cached = historyCache[fund.code];
          const needsUpdate = !cached || !cached.lastUpdate || !cached.lastUpdate.startsWith(today);
          if (needsUpdate) {
            try {
              const histData = await Fund.api.fetchFundHistory(fund.code);
              historyCache[fund.code] = {
                dates: histData.dates,
                values: histData.values,
                changes: histData.changes,
                returns: histData.returns,
                name: histData.name,
                lastUpdate: new Date().toISOString()
              };
              Fund.data.saveHistory(historyCache);
              // 补全基金名称
              if (histData.name && !fund.name) {
                Fund.data.updateFund(fund.id, { name: histData.name });
              }
            } catch(e) {
              console.warn('历史数据获取失败:', fund.code, e.message);
            }
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // 4. 检查交易信号
        Fund.reminder.checkAndNotify();

        // 5. AI自动分析（每天每基金1次）
        Fund.aiAnalysis.analyzeAll().catch(e => console.warn('AI分析失败:', e.message));
      }

      this.isRefreshing = false;
    }
  },

  // ===== 事件绑定 =====
  initEvents() {
    // 添加基金按钮
    document.getElementById('btn-add-fund').addEventListener('click', () => {
      this.modal.openAdd();
    });

    // 模态框取消
    document.getElementById('btn-fund-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      this.modal.close();
    });

    // 模态框保存 - 带视觉反馈
    document.getElementById('btn-fund-save').addEventListener('click', (e) => {
      e.preventDefault();
      const btn = e.target.closest('.btn') || e.target;
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
      this.modal.save();
    });

    // 点击模态框外部关闭
    document.getElementById('modal-fund').addEventListener('click', (e) => {
      if (e.target.id === 'modal-fund') {
        e.preventDefault();
        this.modal.close();
      }
    });

    // ESC键关闭基金模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('modal-fund').classList.contains('open')) {
        this.modal.close();
      }
    });

    // 基本面评级选择
    document.querySelectorAll('#modal-fund .cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#modal-fund .cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedQuality = btn.dataset.quality;
      });
    });

    // 基金卡片操作（事件委托）
    document.getElementById('fund-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.fund-action-btn');
      if (!btn) return;
      const card = btn.closest('.fund-card');
      if (!card) return;
      const fundId = card.dataset.fundId;
      const action = btn.dataset.action;

      // 触觉反馈
      if ('vibrate' in navigator) navigator.vibrate(10);

      if (action === 'edit') {
        this.modal.openEdit(fundId);
      } else if (action === 'ai') {
        const fund = this.data.loadFunds().find(f => f.id === fundId);
        if (fund) {
          const historyCache = this.data.loadHistory();
          this.aiAnalysis.analyzeFund(fund, historyCache[fund.code]);
        }
      } else if (action === 'delete') {
        if (confirm('确认删除该基金？相关数据将一并清除。')) {
          this.data.removeFund(fundId);
          this.ui.renderFundList();
          App.showToast('基金已删除');
        }
      }
    });

    // 页面可见性变化时刷新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && App.currentView === 'fund') {
        this.scheduler.refreshAll();
      }
    });
  },

  // ===== 初始化 =====
  init() {
    this.initEvents();
    this.scheduler.start();
    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
};
