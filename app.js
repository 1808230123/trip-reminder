/* ===== App Module - app.js ===== */

const App = {
  // Current state
  currentView: 'today',
  calMonth: new Date(), // Calendar current month
  editingId: null, // null = new, string = editing
  selectedWeekdays: [], // For repeat weekday selection
  reminderTimer: null,

  // ===== DATA LAYER =====
  data: {
    KEYS: {
      schedules: 'tripler_schedules',
      settings: 'tripler_settings',
      aiSuggestions: 'tripler_ai_suggestions'
    },

    defaultSettings() {
      return {
        ai: {
          provider: 'zhipu',
          apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
          apiKey: '',
          model: 'glm-4-flash'
        },
        notification: {
          soundEnabled: true,
          soundType: 'bell',
          notifyBefore: 15
        },
        theme: 'auto',
        lastAIAnalysis: null
      };
    },

    defaultSchedule() {
      const now = new Date();
      const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      return {
        id: 'sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        title: '',
        description: '',
        category: 'work',
        priority: { important: false, urgent: false },
        scheduledDate: today,
        scheduledTime: '',
        duration: 60,
        repeat: { type: 'none', interval: 1, weekdays: [], endDate: null },
        reminder: { enabled: true, advanceMinutes: 15, notified: false },
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'manual',
        isRecurringInstance: false
      };
    },

    loadSchedules() {
      try {
        const raw = localStorage.getItem(this.KEYS.schedules);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    saveSchedules(arr) {
      localStorage.setItem(this.KEYS.schedules, JSON.stringify(arr));
    },

    addSchedule(obj) {
      const arr = this.loadSchedules();
      arr.unshift(obj);
      this.saveSchedules(arr);
    },

    updateSchedule(id, patch) {
      const arr = this.loadSchedules();
      const idx = arr.findIndex(s => s.id === id);
      if (idx !== -1) {
        arr[idx] = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
        this.saveSchedules(arr);
      }
    },

    deleteSchedule(id) {
      const arr = this.loadSchedules().filter(s => s.id !== id);
      this.saveSchedules(arr);
    },

    loadSettings() {
      try {
        const raw = localStorage.getItem(this.KEYS.settings);
        return raw ? { ...this.defaultSettings(), ...JSON.parse(raw) } : this.defaultSettings();
      } catch { return this.defaultSettings(); }
    },

    saveSettings(obj) {
      localStorage.setItem(this.KEYS.settings, JSON.stringify(obj));
    },

    loadAISuggestions() {
      try {
        const raw = localStorage.getItem(this.KEYS.aiSuggestions);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    saveAISuggestions(arr) {
      localStorage.setItem(this.KEYS.aiSuggestions, JSON.stringify(arr));
    },

    getSchedulesByDate(dateStr) {
      const oneTime = this.loadSchedules().filter(s =>
        s.scheduledDate === dateStr && s.repeat.type === 'none'
      );
      const recurring = this.expandRecurringSchedules(dateStr, dateStr);
      return [...oneTime, ...recurring].sort((a, b) => {
        if (!a.scheduledTime) return 1;
        if (!b.scheduledTime) return -1;
        return a.scheduledTime.localeCompare(b.scheduledTime);
      });
    },

    getTodaySchedules() {
      const today = new Date().toISOString().split('T')[0];
      return this.getSchedulesByDate(today);
    },

    expandRecurringSchedules(startStr, endStr) {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const schedules = this.loadSchedules();
      const instances = [];

      schedules.forEach(s => {
        if (s.repeat.type === 'none' || !s.repeat.type) return;
        const sDate = new Date(s.scheduledDate);
        if (sDate > end) return;

        // Reset notified for recurring instances based on current date
        const todayStr = new Date().toISOString().split('T')[0];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1-7
          let shouldOccur = false;

          if (s.repeat.type === 'daily') {
            const diffDays = Math.floor((d - sDate) / 86400000);
            shouldOccur = diffDays >= 0 && diffDays % (s.repeat.interval || 1) === 0;
          } else if (s.repeat.type === 'weekly') {
            const diffWeeks = Math.floor((d - sDate) / (7 * 86400000));
            shouldOccur = diffWeeks >= 0 && diffWeeks % (s.repeat.interval || 1) === 0
              && (s.repeat.weekdays || []).includes(dayOfWeek);
          } else if (s.repeat.type === 'monthly') {
            shouldOccur = d.getDate() === sDate.getDate()
              && Math.floor((d - sDate) / (30 * 86400000)) >= 0
              && Math.floor((d - sDate) / (30 * 86400000)) % (s.repeat.interval || 1) === 0;
          }

          if (shouldOccur) {
            const dateStr = d.toISOString().split('T')[0];
            // Only generate instance if it's not the original date (original handled separately)
            // Actually include original too for recurring items
            const instance = {
              ...s,
              scheduledDate: dateStr,
              isRecurringInstance: dateStr !== s.scheduledDate,
              id: dateStr === s.scheduledDate ? s.id : s.id + '_' + dateStr,
              // Reset notified for today's instances
              reminder: {
                ...s.reminder,
                notified: dateStr !== todayStr ? false : s.reminder.notified
              }
            };
            instances.push(instance);
          }
        }
      });

      return instances;
    },

    exportData() {
      const data = {
        schedules: this.loadSchedules(),
        settings: this.loadSettings(),
        aiSuggestions: this.loadAISuggestions(),
        exportDate: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `行程数据_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    importData(jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        if (data.schedules && Array.isArray(data.schedules)) {
          this.saveSchedules(data.schedules);
        }
        if (data.settings) {
          this.saveSettings(data.settings);
        }
        if (data.aiSuggestions) {
          this.saveAISuggestions(data.aiSuggestions);
        }
        return true;
      } catch (e) {
        throw new Error('导入数据格式错误: ' + e.message);
      }
    }
  },

  // ===== UI LAYER =====
  ui: {
    // Priority quadrant helper
    getPriorityClass(priority) {
      if (priority.important && priority.urgent) return 'pri-q1';
      if (priority.important && !priority.urgent) return 'pri-q2';
      if (!priority.important && priority.urgent) return 'pri-q3';
      return 'pri-q4';
    },

    getPriorityLabel(priority) {
      if (priority.important && priority.urgent) return '立即做';
      if (priority.important && !priority.urgent) return '计划做';
      if (!priority.important && priority.urgent) return '委托做';
      return '减少做';
    },

    getCategoryLabel(cat) {
      const map = { work: '工作', life: '生活', social: '社交' };
      return map[cat] || cat;
    },

    getCategoryEmoji(cat) {
      const map = { work: '💼', life: '🌿', social: '🎉' };
      return map[cat] || '';
    },

    // Greeting based on time
    getGreeting() {
      const h = new Date().getHours();
      if (h < 6) return '夜深了 🌙';
      if (h < 9) return '早上好 ☀️';
      if (h < 12) return '上午好 🌤';
      if (h < 14) return '中午好 🌞';
      if (h < 18) return '下午好 🌅';
      return '晚上好 🌆';
    },

    formatDate(date) {
      const parts = typeof date === 'string' ? date.split('-') : null;
      const d = parts ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])) : new Date(date);
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`;
    },

    // Render today view
    renderToday() {
      const greeting = this.getGreeting();
      document.getElementById('greeting').textContent = greeting;
      document.getElementById('date-info').textContent = this.formatDate(new Date());

      const schedules = App.data.getTodaySchedules();
      const list = document.getElementById('today-list');
      const summary = document.getElementById('today-summary');

      // Summary stats
      const pending = schedules.filter(s => s.status === 'pending').length;
      const done = schedules.filter(s => s.status === 'done').length;
      const work = schedules.filter(s => s.category === 'work' && s.status === 'pending').length;
      const life = schedules.filter(s => s.category === 'life' && s.status === 'pending').length;
      const social = schedules.filter(s => s.category === 'social' && s.status === 'pending').length;

      summary.innerHTML = `
        <div class="summary-stat"><span class="dot" style="background:var(--primary)"></span> 待办 ${pending}</div>
        <div class="summary-stat"><span class="dot" style="background:var(--pri-q2)"></span> 完成 ${done}</div>
        <div class="summary-stat"><span class="dot" style="background:var(--cat-work)"></span> 工作 ${work}</div>
        <div class="summary-stat"><span class="dot" style="background:var(--cat-life)"></span> 生活 ${life}</div>
        <div class="summary-stat"><span class="dot" style="background:var(--cat-social)"></span> 社交 ${social}</div>
      `;

      // Show AI button only if API key is configured
      const settings = App.data.loadSettings();
      document.getElementById('btn-ai-analyze').style.display = settings.ai.apiKey ? '' : 'none';
      document.getElementById('btn-ai-recommend').classList.toggle('hidden', !settings.ai.apiKey);

      // Render schedule list
      if (schedules.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 80 80" fill="none" stroke="var(--text-muted)" stroke-width="2">
                <rect x="8" y="12" width="64" height="56" rx="8"/>
                <line x1="56" y2="4" x2="56" y2="16"/>
                <line x1="24" y2="4" x2="24" y2="16"/>
                <line x1="8" y2="28" x2="72" y2="28"/>
                <text x="40" y="50" text-anchor="middle" font-size="12" fill="var(--text-muted)">✨</text>
              </svg>
            </div>
            <div class="empty-title">今日暂无行程</div>
            <div class="empty-desc">点击右下角 + 添加新行程</div>
          </div>`;
        return;
      }

      list.innerHTML = schedules.map(s => {
        const priClass = this.getPriorityClass(s.priority);
        const priLabel = this.getPriorityLabel(s.priority);
        const catClass = 'cat-' + s.category;
        const catLabel = this.getCategoryLabel(s.category);
        const isDone = s.status === 'done';
        const timeStr = s.scheduledTime ? s.scheduledTime : '全天';
        const sourceLabel = s.source === 'ai_adopted' ? '🤖' : '';

        return `
          <div class="swipe-wrapper" data-id="${s.id}">
            <div class="schedule-card ${priClass} ${isDone ? 'done' : ''}">
              <div class="pri-bar"></div>
              <div class="card-check ${isDone ? 'checked' : ''}" data-action="toggle" data-id="${s.id}"></div>
              <div class="card-body">
                <div class="card-title">${sourceLabel} ${s.title}</div>
                <div class="card-meta">
                  <span class="card-time">${timeStr}</span>
                  <span class="cat-tag ${catClass}">${catLabel}</span>
                  <span class="pri-label">${priLabel}</span>
                </div>
              </div>
              <div class="card-actions">
                <button class="card-act-btn" data-action="edit" data-id="${s.id}" title="编辑">✏️</button>
                <button class="card-act-btn delete" data-action="delete" data-id="${s.id}" title="删除">🗑</button>
              </div>
            </div>
            <div class="swipe-actions">
              <button class="swipe-act-btn skip" data-action="skip" data-id="${s.id}">跳过</button>
              <button class="swipe-act-btn del" data-action="delete" data-id="${s.id}">删除</button>
            </div>
          </div>`;
      }).join('');
    },

    // Render calendar view
    renderCalendar() {
      const month = App.calMonth;
      const year = month.getFullYear();
      const m = month.getMonth();

      // Title
      document.getElementById('cal-title').textContent = `${year}年${m + 1}月`;

      // Weekday headers
      const wdContainer = document.getElementById('cal-weekdays');
      wdContainer.innerHTML = ['一', '二', '三', '四', '五', '六', '日']
        .map(d => `<div class="cal-weekday">${d}</div>`).join('');

      // Grid
      const grid = document.getElementById('cal-grid');
      const firstDay = new Date(year, m, 1);
      const startWeekday = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday=0
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      const todayStr = new Date().toISOString().split('T')[0];

      // Previous month days
      const prevMonthDays = new Date(year, m, 0).getDate();
      const prevDays = [];
      for (let i = startWeekday - 1; i >= 0; i--) {
        prevDays.push(prevMonthDays - i);
      }

      // Get schedules for this month
      const monthStart = new Date(year, m, 1).toISOString().split('T')[0];
      const monthEnd = new Date(year, m + 1, 0).toISOString().split('T')[0];
      const monthSchedules = App.data.getSchedulesByDate(monthStart);

      // Build a map: date -> schedules
      const dateMap = {};
      // Load all schedules for the month range
      const allMonthSchedules = App.data.loadSchedules().filter(s =>
        s.scheduledDate.startsWith(`${year}-${String(m + 1).padStart(2, '0')}`)
      );
      const recurringInstances = App.data.expandRecurringSchedules(monthStart, monthEnd);
      const combined = [...allMonthSchedules, ...recurringInstances];

      combined.forEach(s => {
        if (!dateMap[s.scheduledDate]) dateMap[s.scheduledDate] = [];
        dateMap[s.scheduledDate].push(s);
      });

      let html = '';

      // Previous month padding
      prevDays.forEach(d => {
        html += `<div class="cal-day other-month">${d}</div>`;
      });

      // Current month
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const daySchedules = dateMap[dateStr] || [];
        const isToday = dateStr === todayStr;
        const hasEvents = daySchedules.length > 0;

        const cats = [...new Set(daySchedules.map(s => s.category))];
        const dots = cats.slice(0, 3).map(c => `<span class="day-dot ${c}"></span>`).join('');

        html += `
          <div class="cal-day ${isToday ? 'today' : ''} ${hasEvents ? 'has-events' : ''}"
               data-date="${dateStr}" data-action="select-date">
            <span class="day-num">${d}</span>
            ${hasEvents ? `<div class="day-dots">${dots}</div>` : ''}
          </div>`;
      }

      // Next month padding (fill to complete grid)
      const totalCells = prevDays.length + daysInMonth;
      const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
      for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month">${i}</div>`;
      }

      grid.innerHTML = html;

      // Hide detail panel
      document.getElementById('cal-detail').classList.add('hidden');
    },

    // Show detail for selected date
    showDateDetail(dateStr) {
      const detail = document.getElementById('cal-detail');
      const schedules = App.data.getSchedulesByDate(dateStr);
      const dateLabel = App.ui.formatDate(dateStr);

      detail.classList.remove('hidden');

      if (schedules.length === 0) {
        detail.innerHTML = `
          <div class="detail-title">${dateLabel}</div>
          <div class="empty-state" style="padding:20px">
            <div class="empty-desc">这天暂无行程安排</div>
          </div>`;
        return;
      }

      const items = schedules.map(s => {
        const priClass = App.ui.getPriorityClass(s.priority);
        const timeStr = s.scheduledTime || '全天';
        const catLabel = App.ui.getCategoryLabel(s.category);
        const catClass = 'cat-' + s.category;

        return `
          <div class="schedule-card ${priClass}" style="margin-bottom:8px;">
            <div class="pri-bar"></div>
            <div class="card-body">
              <div class="card-title">${s.title}</div>
              <div class="card-meta">
                <span class="card-time">${timeStr}</span>
                <span class="cat-tag ${catClass}">${catLabel}</span>
              </div>
            </div>
          </div>`;
      }).join('');

      detail.innerHTML = `
        <div class="detail-title">${dateLabel} · ${schedules.length} 项行程</div>
        ${items}`;
    },

    // Render settings view
    renderSettings() {
      const settings = App.data.loadSettings();

      // AI config
      document.getElementById('ai-api-url').value = settings.ai.apiUrl;
      document.getElementById('ai-api-key').value = settings.ai.apiKey;
      document.getElementById('ai-model').value = settings.ai.model;

      // Provider preset active state
      document.querySelectorAll('.provider-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.provider === settings.ai.provider);
      });

      // Notification
      const soundToggle = document.getElementById('toggle-sound');
      soundToggle.classList.toggle('on', settings.notification.soundEnabled);
      document.getElementById('notify-before').value = settings.notification.notifyBefore;

      // Sound preset active state
      document.querySelectorAll('.sound-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sound === settings.notification.soundType);
      });

      // Custom ringtone area
      const customArea = document.getElementById('custom-ringtone-area');
      if (customArea) {
        customArea.style.display = settings.notification.soundType === 'custom' ? 'flex' : 'none';
      }

      // Show remove button if custom ringtone exists
      const hasCustom = localStorage.getItem('tripler_custom_ringtone');
      const removeBtn = document.getElementById('btn-remove-ringtone');
      if (removeBtn) removeBtn.classList.toggle('hidden', !hasCustom);

      // Current sound name
      const soundNames = { bell: '铃声', chime: '提示音', digital: '电子音', gentle: '柔和音', custom: '自定义铃声' };
      const soundNameEl = document.getElementById('current-sound-name');
      if (soundNameEl) soundNameEl.textContent = '当前: ' + (soundNames[settings.notification.soundType] || '铃声');

      // Theme
      document.getElementById('theme-select').value = settings.theme;

      // Schedule count
      document.getElementById('schedule-count').textContent = App.data.loadSchedules().length;

      // Hide API status
      document.getElementById('api-status').classList.add('hidden');
    },

    // Open schedule modal (new or edit)
    openScheduleModal(scheduleId) {
      const modal = document.getElementById('modal-schedule');
      modal.classList.add('open');

      App.editingId = scheduleId;
      App.selectedWeekdays = [];

      let schedule;
      if (scheduleId) {
        // Edit existing
        schedule = App.data.loadSchedules().find(s => s.id === scheduleId) || App.data.defaultSchedule();
        document.getElementById('sheet-title').textContent = '编辑行程';
      } else {
        // New
        schedule = App.data.defaultSchedule();
        document.getElementById('sheet-title').textContent = '新建行程';
      }

      // Fill form
      document.getElementById('inp-title').value = schedule.title;
      document.getElementById('inp-desc').value = schedule.description || '';
      document.getElementById('inp-date').value = schedule.scheduledDate;
      document.getElementById('inp-time').value = schedule.scheduledTime || '';
      document.getElementById('inp-duration').value = schedule.duration;
      document.getElementById('inp-repeat').value = schedule.repeat.type;
      document.getElementById('inp-advance').value = schedule.reminder.advanceMinutes;

      // Category
      document.querySelectorAll('.cat-btn[data-cat]').forEach(btn => {
        btn.classList.remove('active-work', 'active-life', 'active-social');
        if (btn.dataset.cat === schedule.category) {
          btn.classList.add('active-' + schedule.category);
        }
      });

      // Priority
      const priClass = App.ui.getPriorityClass(schedule.priority);
      document.querySelectorAll('.pri-cell').forEach(cell => {
        cell.classList.remove('active-q1', 'active-q2', 'active-q3', 'active-q4');
      });
      const priCell = document.querySelector(`.pri-cell[data-q="${priClass}"]`);
      if (priCell) priCell.classList.add('active-' + priClass);

      // Repeat weekdays
      App.selectedWeekdays = [...(schedule.repeat.weekdays || [])];
      document.querySelectorAll('.cat-btn[data-wd]').forEach(btn => {
        const wd = parseInt(btn.dataset.wd);
        btn.classList.toggle('active-work', App.selectedWeekdays.includes(wd));
      });

      // Weekday group visibility
      const weekdayGroup = document.getElementById('weekday-group');
      weekdayGroup.classList.toggle('hidden', schedule.repeat.type !== 'weekly');

      // Reminder toggle
      const reminderToggle = document.getElementById('toggle-reminder');
      reminderToggle.classList.toggle('on', schedule.reminder.enabled);

      // Show AI recommend button if API key configured
      const settings = App.data.loadSettings();
      document.getElementById('btn-ai-recommend').classList.toggle('hidden', !settings.ai.apiKey);
    },

    closeScheduleModal() {
      document.getElementById('modal-schedule').classList.remove('open');
      App.editingId = null;
    },

    // Save schedule from modal
    saveSchedule() {
      const title = document.getElementById('inp-title').value.trim();
      if (!title) {
        App.showToast('请输入行程标题');
        return;
      }

      const date = document.getElementById('inp-date').value;
      if (!date) {
        App.showToast('请选择日期');
        return;
      }

      // Get category
      const activeCatBtn = document.querySelector('.cat-btn.active-work, .cat-btn.active-life, .cat-btn.active-social');
      const category = activeCatBtn ? activeCatBtn.dataset.cat : 'work';

      // Get priority
      const activePriCell = document.querySelector('.pri-cell.active-q1, .pri-cell.active-q2, .pri-cell.active-q3, .pri-cell.active-q4');
      let priority = { important: false, urgent: false };
      if (activePriCell) {
        const q = activePriCell.dataset.q;
        if (q === 'q1') priority = { important: true, urgent: true };
        else if (q === 'q2') priority = { important: true, urgent: false };
        else if (q === 'q3') priority = { important: false, urgent: true };
        else priority = { important: false, urgent: false };
      }

      // Get repeat
      const repeatType = document.getElementById('inp-repeat').value;
      const repeat = {
        type: repeatType,
        interval: 1,
        weekdays: repeatType === 'weekly' ? App.selectedWeekdays : [],
        endDate: null
      };

      // Get reminder
      const reminderEnabled = document.getElementById('toggle-reminder').classList.contains('on');
      const advanceMinutes = parseInt(document.getElementById('inp-advance').value);

      const scheduleData = {
        title,
        description: document.getElementById('inp-desc').value.trim(),
        category,
        priority,
        scheduledDate: date,
        scheduledTime: document.getElementById('inp-time').value || '',
        duration: parseInt(document.getElementById('inp-duration').value) || 60,
        repeat,
        reminder: {
          enabled: reminderEnabled,
          advanceMinutes,
          notified: false // Reset on save
        },
        updatedAt: new Date().toISOString()
      };

      if (App.editingId) {
        App.data.updateSchedule(App.editingId, scheduleData);
      } else {
        const newSchedule = {
          ...App.data.defaultSchedule(),
          ...scheduleData,
          id: 'sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          createdAt: new Date().toISOString(),
          source: 'manual'
        };
        App.data.addSchedule(newSchedule);
      }

      const wasEditing = App.editingId;
      
      // Close modal FIRST, then refresh and show toast
      try {
        document.getElementById('modal-schedule').classList.remove('open');
        App.editingId = null;
        App.selectedWeekdays = [];
        App.refresh();
        App.showToast(wasEditing ? '行程已更新 ✓' : '行程已添加 ✓');
      } catch(e) {
        console.error('Save error:', e);
        // Even if refresh fails, ensure modal closes
        document.getElementById('modal-schedule').classList.remove('open');
        App.showToast('保存成功');
      }
    },

    // Show AI analysis panel
    showAIPanel() {
      document.getElementById('ai-panel').classList.add('open');
      document.getElementById('ai-loading').classList.remove('hidden');
      document.getElementById('ai-results').innerHTML = '';
      document.getElementById('btn-ai-adopt-all').classList.add('hidden');

      AI.analyzePatterns()
        .then(result => {
          document.getElementById('ai-loading').classList.add('hidden');

          let html = '';

          if (result.routineSummary) {
            html += `<div class="ai-summary">📋 ${result.routineSummary}</div>`;
          }

          if (result.patterns.length === 0) {
            html += `
              <div class="empty-state" style="padding:20px">
                <div class="empty-title">暂未识别出明显模式</div>
                <div class="empty-desc">继续记录行程，AI会逐步识别你的规律</div>
              </div>`;
          } else {
            document.getElementById('btn-ai-adopt-all').classList.remove('hidden');

            result.patterns.forEach(p => {
              const catLabel = App.ui.getCategoryLabel(p.category);
              const catClass = 'cat-' + p.category;
              const priClass = App.ui.getPriorityClass(p.priority);
              const priLabel = App.ui.getPriorityLabel(p.priority);
              const repeatLabel = p.repeat.type === 'weekly'
                ? `每周 ${p.repeat.weekdays.map(w => ['一','二','三','四','五','六','日'][w-1]).join(',')}`
                : p.repeat.type === 'daily' ? '每天'
                : p.repeat.type === 'monthly' ? '每月' : '不重复';
              const confPercent = Math.round(p.confidence * 100);

              html += `
                <div class="ai-suggestion-card">
                  <div class="ai-sug-title">${p.title}</div>
                  <div class="ai-sug-reason">${p.reason}</div>
                  <div class="ai-sug-meta">
                    <span class="cat-tag ${catClass}">${catLabel}</span>
                    <span class="pri-label ${priClass}" style="${priClass === 'pri-q1' ? 'background:#FEE2E2;color:#B91C1C;' : priClass === 'pri-q2' ? 'background:#FEF3C7;color:#B45309;' : priClass === 'pri-q3' ? 'background:#DBEAFE;color:#1D4ED8;' : 'background:#F3F4F6;color:#6B7280;'}">${priLabel}</span>
                    <span>${p.scheduledTime || '全天'}</span>
                    <span>${repeatLabel}</span>
                  </div>
                  <div class="ai-sug-confidence">置信度: ${confPercent}%</div>
                  <div class="ai-sug-actions">
                    <button class="btn btn-primary btn-sm" data-action="adopt" data-sug-id="${p.id}">采纳此建议</button>
                    <button class="btn btn-secondary btn-sm" data-action="dismiss-sug">不采纳</button>
                  </div>
                </div>`;
            });
          }

          if (result.suggestions.length > 0) {
            html += `<div style="margin-top:12px;font-size:14px;font-weight:600;">💡 优化建议</div>`;
            result.suggestions.forEach(s => {
              html += `<div style="padding:8px;background:var(--bg-hover);border-radius:var(--radius-sm);margin-top:6px;font-size:13px;color:var(--text-secondary);">${s.description}</div>`;
            });
          }

          document.getElementById('ai-results').innerHTML = html;

          // Store patterns for adoption
          window.__aiPatterns = result.patterns;
        })
        .catch(err => {
          document.getElementById('ai-loading').classList.add('hidden');
          document.getElementById('ai-results').innerHTML = `
            <div class="empty-state" style="padding:20px">
              <div class="empty-title">分析失败</div>
              <div class="empty-desc">${err.message}</div>
            </div>`;
        });
    },

    closeAIPanel() {
      document.getElementById('ai-panel').classList.remove('open');
    }
  },

  // ===== REMINDER SYSTEM =====
  reminder: {
    audioCtx: null,

    init() {
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Pre-warm AudioContext on first user gesture (CRITICAL for iOS Safari)
      // Browsers require AudioContext to be created/resumed within a user gesture.
      // Without this, playSound() called from the 30s timer will be blocked.
      const warmUp = () => {
        this.ensureAudioContext().then(ctx => {
          if (ctx && ctx.state === 'running') {
            console.log('AudioContext pre-warmed successfully');
          }
        });
        // Remove listeners after first successful warm-up
        document.removeEventListener('touchstart', warmUp);
        document.removeEventListener('click', warmUp);
      };
      document.addEventListener('touchstart', warmUp, { once: false });
      document.addEventListener('click', warmUp, { once: false });

      // Start 30-second check cycle
      this.startPolling();

      // Resume check when page becomes visible
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.checkReminders();
        }
      });

      // Check immediately
      this.checkReminders();
    },

    startPolling() {
      if (App.reminderTimer) clearInterval(App.reminderTimer);
      App.reminderTimer = setInterval(() => this.checkReminders(), 30000);
    },

    checkReminders() {
      const settings = App.data.loadSettings();
      if (!settings.notification) return;

      // Request notification permission if needed
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Use local date components to avoid UTC off-by-one (toISOString returns UTC)
      const nowLocal = new Date();
      const todayStr = nowLocal.getFullYear() + '-' +
        String(nowLocal.getMonth() + 1).padStart(2, '0') + '-' +
        String(nowLocal.getDate()).padStart(2, '0');
      const now = nowLocal;

      // Get ALL schedules active today (one-time + recurring instances)
      const todaySchedules = App.data.getSchedulesByDate(todayStr);

      todaySchedules.forEach(s => {
        if (s.status !== 'pending') return;
        if (!s.reminder || !s.reminder.enabled) return;
        if (s.reminder.notified) return;
        if (!s.scheduledTime) return; // All-day: skip timed reminder

        // Parse time robustly for Safari compatibility
        const timeParts = s.scheduledTime.split(':');
        const h = parseInt(timeParts[0]) || 0;
        const m = parseInt(timeParts[1]) || 0;
        const sec = parseInt(timeParts[2]) || 0;
        
        // Build Date using local time components (avoids ISO parsing issues)
        const dateParts = s.scheduledDate.split('-');
        const scheduledDateTime = new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2]),
          h, m, sec
        );

        if (isNaN(scheduledDateTime.getTime())) return;

        const advanceMinutes = s.reminder.advanceMinutes || 15;
        const reminderTime = new Date(scheduledDateTime.getTime() - advanceMinutes * 60000);
        const windowEnd = new Date(scheduledDateTime.getTime() + 5 * 60000);

        if (now >= reminderTime && now <= windowEnd) {
          this.sendNotification(s);
          this.playSound(settings.notification.soundType, settings.notification.soundEnabled).catch(function(){});

          // Mark as notified using parent ID for recurring
          const parentId = s.id.includes('_2') ? s.id.split('_2')[0] : s.id;
          App.data.updateSchedule(parentId, { reminder: { ...s.reminder, notified: true } });
        }
      });
    },

    sendNotification(schedule) {
      const advance = schedule.reminder.advanceMinutes || 15;
      const catLabel = App.ui.getCategoryLabel(schedule.category);

      // System notification (works on desktop + Android Chrome)
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(`小宝的行程: ${schedule.title}`, {
            body: `${advance}分钟后开始 · ${catLabel}`,
            tag: schedule.id,
            icon: 'icon.svg',
            requireInteraction: false
          });

          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch(e) {
          console.warn('System notification failed:', e);
        }
      }

      // In-app banner notification (works on iOS Safari PWA where system notifications are unreliable)
      this.showInAppBanner(schedule, advance, catLabel);
    },

    // Show an in-app floating banner for reminders
    showInAppBanner(schedule, advance, catLabel) {
      const catColors = {
        work: '#6366f1', life: '#10b981', social: '#f59e0b'
      };
      const color = catColors[schedule.category] || '#6366f1';

      // Remove any existing banner
      const existing = document.getElementById('reminder-banner');
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.id = 'reminder-banner';
      banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
        background: linear-gradient(135deg, ${color}, ${color}dd);
        color: white; padding: 14px 16px; padding-top: max(14px, env(safe-area-inset-top));
        display: flex; align-items: center; gap: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        transform: translateY(-100%); transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `;

      const iconDiv = document.createElement('div');
      iconDiv.style.cssText = `
        width: 36px; height: 36px; border-radius: 50%;
        background: rgba(255,255,255,0.25); display: flex;
        align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
      `;
      iconDiv.textContent = '🔔';

      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'flex: 1; min-width: 0;';
      textDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${schedule.title}</div>
        <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">${advance}分钟后开始 · ${catLabel}</div>
      `;

      const closeBtn = document.createElement('button');
      closeBtn.style.cssText = `
        background: rgba(255,255,255,0.2); border: none; color: white;
        width: 28px; height: 28px; border-radius: 50%; font-size: 16px;
        cursor: pointer; flex-shrink: 0; display: flex; align-items: center;
        justify-content: center; -webkit-tap-highlight-color: transparent;
      `;
      closeBtn.textContent = '✕';
      closeBtn.onclick = () => {
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => banner.remove(), 400);
      };

      banner.appendChild(iconDiv);
      banner.appendChild(textDiv);
      banner.appendChild(closeBtn);
      document.body.appendChild(banner);

      // Animate in
      requestAnimationFrame(() => {
        banner.style.transform = 'translateY(0)';
      });

      // Auto-dismiss after 15 seconds
      setTimeout(() => {
        if (banner.parentNode) {
          banner.style.transform = 'translateY(-100%)';
          setTimeout(() => {
            if (banner.parentNode) banner.remove();
          }, 400);
        }
      }, 15000);

      // Vibrate if supported (mobile)
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    },

    // Ensure AudioContext is ready (must be called from user gesture)
    async ensureAudioContext() {
      if (!this.audioCtx) {
        try {
          this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
          console.warn('Cannot create AudioContext:', e);
          return null;
        }
      }
      // Resume if suspended - CRITICAL for iOS Safari and Chrome
      if (this.audioCtx.state === 'suspended') {
        try {
          await this.audioCtx.resume();
        } catch(e) {
          console.warn('Cannot resume AudioContext:', e);
        }
      }
      return this.audioCtx;
    },

    async playSound(type, enabled) {
      if (!enabled) return;

      // Check for custom ringtone first
      if (type === 'custom') {
        const customRingtone = localStorage.getItem('tripler_custom_ringtone');
        if (customRingtone) {
          try {
            const audio = new Audio(customRingtone);
            audio.volume = 0.8;
            await audio.play();
            return;
          } catch (e) {
            console.warn('Custom ringtone failed, using default', e);
            type = 'bell'; // Fallback
          }
        } else {
          type = 'bell';
        }
      }

      // Synthesized sounds - ensure context is running first
      try {
        const ctx = await this.ensureAudioContext();
        if (!ctx || ctx.state !== 'running') {
          console.warn('AudioContext not running, state:', ctx ? ctx.state : 'null');
          // Fallback: try HTML5 Audio with a short beep data URI
          this.fallbackBeep();
          return;
        }

        const playTone = (freq, waveType, duration, startDelay, volume) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          const startTime = ctx.currentTime + (startDelay || 0);
          osc.frequency.setValueAtTime(freq, startTime);
          osc.type = waveType || 'sine';
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(volume || 0.3, startTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        if (type === 'bell') {
          playTone(880, 'sine', 0.5, 0, 0.3);
          playTone(1108, 'sine', 0.7, 0.1, 0.15);
          playTone(1318, 'sine', 0.8, 0.2, 0.08);
        } else if (type === 'chime') {
          playTone(523, 'triangle', 0.35, 0, 0.25);
          playTone(659, 'triangle', 0.35, 0.12, 0.2);
          playTone(784, 'triangle', 0.6, 0.24, 0.2);
          playTone(1046, 'triangle', 0.8, 0.36, 0.1);
        } else if (type === 'digital') {
          playTone(1000, 'square', 0.12, 0, 0.15);
          playTone(1000, 'square', 0.12, 0.18, 0.15);
          playTone(1200, 'square', 0.25, 0.36, 0.15);
        } else if (type === 'gentle') {
          playTone(440, 'sine', 0.8, 0, 0.2);
          playTone(554, 'sine', 0.8, 0.2, 0.15);
          playTone(659, 'sine', 1.2, 0.4, 0.15);
        }
      } catch (e) {
        console.warn('Audio playback failed:', e);
      }
    },

    // Set custom ringtone from file
    setCustomRingtone(file) {
      return new Promise(function(resolve, reject) {
        if (!file) { reject(new Error('No file selected')); return; }
        // Limit file size to 2MB
        if (file.size > 2 * 1024 * 1024) {
          reject(new Error('音频文件不能超过2MB'));
          return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            localStorage.setItem('tripler_custom_ringtone', e.target.result);
            // Update settings to use custom
            const settings = App.data.loadSettings();
            settings.notification.soundType = 'custom';
            App.data.saveSettings(settings);
            resolve();
          } catch(err) {
            reject(new Error('存储失败，文件可能太大'));
          }
        };
        reader.onerror = function() { reject(new Error('文件读取失败')); };
        reader.readAsDataURL(file);
      });
    },

    // Remove custom ringtone
    removeCustomRingtone() {
      localStorage.removeItem('tripler_custom_ringtone');
      const settings = App.data.loadSettings();
      settings.notification.soundType = 'bell';
      App.data.saveSettings(settings);
    },

    // Preview/test sound - called from user click
    async previewSound(type) {
      await this.playSound(type, true);
    },

    // Fallback beep using HTML5 Audio (no AudioContext needed)
    // Uses a short WAV data URI - works even when AudioContext is suspended
    fallbackBeep() {
      try {
        // Short beep: 880Hz sine wave, 0.3s, generated as WAV
        const sampleRate = 8000;
        const duration = 0.3;
        const numSamples = Math.floor(sampleRate * duration);
        const freq = 880;
        const buffer = new ArrayBuffer(44 + numSamples * 2);
        const view = new DataView(buffer);
        // WAV header
        const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + numSamples * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);        // PCM
        view.setUint16(22, 1, true);        // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, numSamples * 2, true);
        // Audio data - sine wave with envelope
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 3); // decay
          const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
          view.setInt16(44 + i * 2, sample * 32767, true);
        }
        // Convert to base64
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const dataURI = 'data:audio/wav;base64,' + btoa(binary);
        const audio = new Audio(dataURI);
        audio.volume = 0.6;
        audio.play().catch(function(e) {
          console.warn('Fallback beep also failed:', e);
        });
      } catch(e) {
        console.warn('Fallback beep generation failed:', e);
      }
    }
  },

  // ===== THEME =====
  theme: {
    apply(theme) {
      if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
    }
  },

  // ===== TOAST =====
  showToast(message, duration = 2500) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ===== REFRESH =====
  refresh() {
    if (App.currentView === 'today') {
      App.ui.renderToday();
    } else if (App.currentView === 'calendar') {
      App.ui.renderCalendar();
    } else if (App.currentView === 'settings') {
      App.ui.renderSettings();
    }
  },

  // ===== INIT =====
  init() {
    // Force clear old service worker caches
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          if (name !== 'xiaobao-v2') {
            caches.delete(name);
          }
        });
      });
    }
    // Unregister old service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(reg => reg.update());
      });
    }

    // Apply theme
    const settings = App.data.loadSettings();
    App.theme.apply(settings.theme);

    // Render initial view
    App.ui.renderToday();
    App.ui.renderCalendar();
    App.ui.renderSettings();

    // Init reminder
    App.reminder.init();

    // ===== EVENT BINDINGS =====

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const viewId = btn.dataset.view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');

        App.currentView = viewId;
        App.refresh();
      });
    });

    // FAB - new schedule
    document.getElementById('fab-add').addEventListener('click', () => {
      App.ui.openScheduleModal(null);
    });

    // Modal cancel - robust close
    document.getElementById('btn-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('modal-schedule').classList.remove('open');
      App.editingId = null;
      App.selectedWeekdays = [];
    });

    // Click outside modal to close
    document.getElementById('modal-schedule').addEventListener('click', (e) => {
      if (e.target.id === 'modal-schedule') {
        document.getElementById('modal-schedule').classList.remove('open');
        App.editingId = null;
        App.selectedWeekdays = [];
      }
    });

    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('modal-schedule').classList.remove('open');
        document.getElementById('ai-panel').classList.remove('open');
        App.editingId = null;
        App.selectedWeekdays = [];
      }
    });

    // Save schedule - with visual feedback
    document.getElementById('btn-save').addEventListener('click', (e) => {
      e.preventDefault();
      const btn = e.target.closest('.btn') || e.target;
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
      App.ui.saveSchedule();
    });

    // Category selector
    document.querySelectorAll('.cat-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn[data-cat]').forEach(b => {
          b.classList.remove('active-work', 'active-life', 'active-social');
        });
        btn.classList.add('active-' + btn.dataset.cat);
      });
    });

    // Priority selector
    document.querySelectorAll('.pri-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        document.querySelectorAll('.pri-cell').forEach(c => {
          c.classList.remove('active-q1', 'active-q2', 'active-q3', 'active-q4');
        });
        cell.classList.add('active-' + cell.dataset.q);
      });
    });

    // Repeat type change -> show/hide weekday group
    document.getElementById('inp-repeat').addEventListener('change', (e) => {
      const weekdayGroup = document.getElementById('weekday-group');
      weekdayGroup.classList.toggle('hidden', e.target.value !== 'weekly');
    });

    // Weekday selector for repeat
    document.querySelectorAll('.cat-btn[data-wd]').forEach(btn => {
      btn.addEventListener('click', () => {
        const wd = parseInt(btn.dataset.wd);
        const idx = App.selectedWeekdays.indexOf(wd);
        if (idx === -1) {
          App.selectedWeekdays.push(wd);
          btn.classList.add('active-work');
        } else {
          App.selectedWeekdays.splice(idx, 1);
          btn.classList.remove('active-work');
        }
      });
    });

    // Reminder toggle
    document.getElementById('toggle-reminder').addEventListener('click', function() {
      this.classList.toggle('on');
    });

    // Schedule card actions (using event delegation)
    document.getElementById('today-list').addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      const id = target.dataset.id;

      if (action === 'toggle') {
        const schedules = App.data.loadSchedules();
        const s = schedules.find(s => s.id === id);
        if (s) {
          App.data.updateSchedule(id, {
            status: s.status === 'done' ? 'pending' : 'done'
          });
          App.refresh();
        }
      } else if (action === 'edit') {
        App.ui.openScheduleModal(id);
      } else if (action === 'delete') {
        App.data.deleteSchedule(id);
        App.refresh();
        App.showToast('行程已删除');
      } else if (action === 'skip') {
        App.data.updateSchedule(id, { status: 'skipped' });
        App.refresh();
        App.showToast('行程已跳过');
      }
    });

    // Swipe support for mobile
    this.initSwipe();

    // Calendar navigation
    document.getElementById('cal-prev').addEventListener('click', () => {
      App.calMonth.setMonth(App.calMonth.getMonth() - 1);
      App.ui.renderCalendar();
    });

    document.getElementById('cal-next').addEventListener('click', () => {
      App.calMonth.setMonth(App.calMonth.getMonth() + 1);
      App.ui.renderCalendar();
    });

    // Calendar date click
    document.getElementById('cal-grid').addEventListener('click', (e) => {
      const dayEl = e.target.closest('.cal-day[data-date]');
      if (!dayEl) return;

      // Highlight selected
      document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
      dayEl.classList.add('selected');

      App.ui.showDateDetail(dayEl.dataset.date);
    });

    // AI analyze button
    document.getElementById('btn-ai-analyze').addEventListener('click', () => {
      App.ui.showAIPanel();
    });

    // AI panel close
    document.getElementById('btn-ai-close').addEventListener('click', () => {
      App.ui.closeAIPanel();
    });

    // AI panel click outside
    document.getElementById('ai-panel').addEventListener('click', (e) => {
      if (e.target === document.getElementById('ai-panel')) {
        App.ui.closeAIPanel();
      }
    });

    // AI adopt actions (event delegation)
    document.getElementById('ai-results').addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;

      if (action === 'adopt') {
        const sugId = target.dataset.sugId;
        const patterns = window.__aiPatterns || [];
        const suggestion = patterns.find(p => p.id === sugId);
        if (suggestion) {
          AI.adoptSuggestion(suggestion);
          App.refresh();
          App.showToast('建议已采纳，行程已添加');
          // Remove this card
          target.closest('.ai-suggestion-card').remove();
        }
      } else if (action === 'dismiss-sug') {
        target.closest('.ai-suggestion-card').remove();
      }
    });

    // Adopt all
    document.getElementById('btn-ai-adopt-all').addEventListener('click', () => {
      const patterns = window.__aiPatterns || [];
      patterns.forEach(p => {
        if (!p.adopted) {
          AI.adoptSuggestion(p);
        }
      });
      App.refresh();
      App.ui.closeAIPanel();
      App.showToast(`已采纳 ${patterns.length} 条建议`);
    });

    // AI recommend for new schedule
    document.getElementById('btn-ai-recommend').addEventListener('click', async () => {
      const title = document.getElementById('inp-title').value.trim();
      if (!title) {
        App.showToast('请先输入标题');
        return;
      }

      const btn = document.getElementById('btn-ai-recommend');
      btn.disabled = true;
      btn.textContent = '⏳ AI 分析中...';

      try {
        const result = await AI.recommendForTitle(title);

        // Apply recommendation
        document.querySelectorAll('.cat-btn[data-cat]').forEach(b => {
          b.classList.remove('active-work', 'active-life', 'active-social');
        });
        const catBtn = document.querySelector(`.cat-btn[data-cat="${result.category}"]`);
        if (catBtn) catBtn.classList.add('active-' + result.category);

        // Priority
        const priClass = App.ui.getPriorityClass(result.priority);
        document.querySelectorAll('.pri-cell').forEach(c => {
          c.classList.remove('active-q1', 'active-q2', 'active-q3', 'active-q4');
        });
        const priCell = document.querySelector(`.pri-cell[data-q="${priClass}"]`);
        if (priCell) priCell.classList.add('active-' + priClass);

        // Repeat
        if (result.repeat && result.repeat.type !== 'none') {
          document.getElementById('inp-repeat').value = result.repeat.type;
          if (result.repeat.type === 'weekly') {
            document.getElementById('weekday-group').classList.remove('hidden');
            App.selectedWeekdays = result.repeat.weekdays || [];
            document.querySelectorAll('.cat-btn[data-wd]').forEach(btn => {
              const wd = parseInt(btn.dataset.wd);
              btn.classList.toggle('active-work', App.selectedWeekdays.includes(wd));
            });
          }
        }

        App.showToast(`AI推荐: ${result.reason}`);
      } catch (err) {
        App.showToast(err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg> AI 推荐分类和优先级`;
      }
    });

    // ===== SETTINGS EVENTS =====

    // Provider presets
    document.querySelectorAll('.provider-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.provider-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const preset = AI.presets[btn.dataset.provider];
        if (preset && preset.apiUrl) {
          document.getElementById('ai-api-url').value = preset.apiUrl;
          document.getElementById('ai-model').value = preset.model;
        }
      });
    });

    // API key visibility toggle
    document.getElementById('toggle-key-vis').addEventListener('click', () => {
      const inp = document.getElementById('ai-api-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Test connection
    document.getElementById('btn-test-ai').addEventListener('click', async () => {
      // Save settings first
      App.saveSettingsFromForm();

      const statusEl = document.getElementById('api-status');
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.textContent = '测试中...';

      const result = await AI.testConnection();
      statusEl.classList.add(result.success ? 'success' : 'error');
      statusEl.textContent = result.message;
    });

    // Sound toggle
    document.getElementById('toggle-sound').addEventListener('click', function() {
      this.classList.toggle('on');
      App.saveSettingsFromForm();
    });

    // Sound preset buttons
    document.querySelectorAll('.sound-preset').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.sound-preset').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const sound = this.dataset.sound;

        // Show/hide custom ringtone upload area
        const customArea = document.getElementById('custom-ringtone-area');
        customArea.style.display = sound === 'custom' ? 'flex' : 'none';

        // Update setting
        const settings = App.data.loadSettings();
        settings.notification.soundType = sound;
        App.data.saveSettings(settings);

        // Update current sound name
        const names = { bell: '铃声', chime: '提示音', digital: '电子音', gentle: '柔和音', custom: '自定义铃声' };
        document.getElementById('current-sound-name').textContent = '当前: ' + (names[sound] || sound);

        // Preview the sound (except custom which needs upload)
        if (sound !== 'custom') {
          App.reminder.previewSound(sound);
        }
      });
    });

    // Upload custom ringtone
    document.getElementById('btn-upload-ringtone').addEventListener('click', function() {
      document.getElementById('ringtone-file').click();
    });

    document.getElementById('ringtone-file').addEventListener('change', async function(e) {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await App.reminder.setCustomRingtone(file);
        document.getElementById('btn-remove-ringtone').classList.remove('hidden');
        document.getElementById('current-sound-name').textContent = '当前: 自定义 - ' + file.name;
        App.showToast('铃声上传成功 ✓');
        // Preview it
        App.reminder.previewSound('custom');
      } catch (err) {
        App.showToast(err.message);
      }
      e.target.value = '';
    });

    // Remove custom ringtone
    document.getElementById('btn-remove-ringtone').addEventListener('click', function() {
      App.reminder.removeCustomRingtone();
      document.getElementById('btn-remove-ringtone').classList.add('hidden');
      document.getElementById('current-sound-name').textContent = '当前: 铃声';
      // Switch to bell preset
      document.querySelectorAll('.sound-preset').forEach(b => b.classList.remove('active'));
      document.querySelector('.sound-preset[data-sound="bell"]').classList.add('active');
      document.getElementById('custom-ringtone-area').style.display = 'none';
      App.showToast('自定义铃声已删除');
    });

    // Preview sound button
    document.getElementById('btn-preview-sound').addEventListener('click', function() {
      const settings = App.data.loadSettings();
      App.reminder.previewSound(settings.notification.soundType);
    });

    // Theme change
    document.getElementById('theme-select').addEventListener('change', (e) => {
      App.theme.apply(e.target.value);
      App.saveSettingsFromForm();
    });

    // Save settings on any input change
    document.querySelectorAll('#view-settings input, #view-settings select').forEach(el => {
      el.addEventListener('change', () => App.saveSettingsFromForm());
    });

    // Export data
    document.getElementById('btn-export').addEventListener('click', () => {
      App.data.exportData();
      App.showToast('数据已导出');
    });

    // Import data
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          App.data.importData(evt.target.result);
          App.refresh();
          App.showToast('数据已导入');
        } catch (err) {
          App.showToast(err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = ''; // Reset file input
    });

    // Clear all data
    document.getElementById('btn-clear').addEventListener('click', () => {
      if (confirm('确定要清除所有行程数据吗？此操作不可撤销！')) {
        localStorage.removeItem(App.data.KEYS.schedules);
        localStorage.removeItem(App.data.KEYS.aiSuggestions);
        App.refresh();
        App.showToast('所有数据已清除');
      }
    });

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('SW registered:', reg.scope);
      }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  },

  // Save settings from form inputs
  saveSettingsFromForm() {
    const activePreset = document.querySelector('.provider-preset.active');
    const provider = activePreset ? activePreset.dataset.provider : 'custom';

    const settings = {
      ai: {
        provider,
        apiUrl: document.getElementById('ai-api-url').value,
        apiKey: document.getElementById('ai-api-key').value,
        model: document.getElementById('ai-model').value
      },
      notification: {
        soundEnabled: document.getElementById('toggle-sound').classList.contains('on'),
        soundType: App.data.loadSettings().notification.soundType,
        notifyBefore: parseInt(document.getElementById('notify-before').value)
      },
      theme: document.getElementById('theme-select').value,
      lastAIAnalysis: App.data.loadSettings().lastAIAnalysis
    };

    App.data.saveSettings(settings);
    App.theme.apply(settings.theme);

    // Update AI button visibility
    document.getElementById('btn-ai-analyze').style.display = settings.ai.apiKey ? '' : 'none';
  },

  // Swipe support for mobile
  initSwipe() {
    const list = document.getElementById('today-list');
    let startX = 0;
    let currentSwipeEl = null;

    list.addEventListener('touchstart', (e) => {
      const wrapper = e.target.closest('.swipe-wrapper');
      if (!wrapper) return;

      // Close any previously swiped element
      if (currentSwipeEl && currentSwipeEl !== wrapper) {
        currentSwipeEl.classList.remove('swiped');
      }

      startX = e.touches[0].clientX;
      currentSwipeEl = wrapper;
    }, { passive: true });

    list.addEventListener('touchmove', (e) => {
      if (!currentSwipeEl) return;
      const dx = e.touches[0].clientX - startX;
      if (dx < -30) {
        currentSwipeEl.classList.add('swiped');
      } else if (dx > 30) {
        currentSwipeEl.classList.remove('swiped');
      }
    }, { passive: true });

    list.addEventListener('touchend', () => {
      // Keep state, don't auto-close
    }, { passive: true });
  }
};

// Start app
document.addEventListener('DOMContentLoaded', () => App.init());