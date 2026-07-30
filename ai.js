/* ===== AI Module - ai.js ===== */

const AI = {
  // Provider presets
  presets: {
    zhipu: {
      name: '智谱GLM',
      apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4-flash'
    },
    openai: {
      name: 'OpenAI',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini'
    },
    deepseek: {
      name: 'DeepSeek',
      apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat'
    },
    custom: {
      name: '自定义',
      apiUrl: '',
      model: ''
    }
  },

  // Core API call
  async callAI(messages) {
    const settings = App.data.loadSettings();
    if (!settings.ai.apiKey) {
      throw new Error('请先在设置页配置 API Key');
    }

    const response = await fetch(settings.ai.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.ai.apiKey}`
      },
      body: JSON.stringify({
        model: settings.ai.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0]) {
      throw new Error('API 返回格式异常');
    }

    return data.choices[0].message.content;
  },

  // Test connection
  async testConnection() {
    try {
      const result = await this.callAI([
        { role: 'user', content: '回复两个字：你好' }
      ]);
      return { success: true, message: `连接成功！模型回复: ${result.substring(0, 50)}` };
    } catch (e) {
      return { success: false, message: `连接失败: ${e.message}` };
    }
  },

  // Strip markdown code block wrapper from AI response
  stripMarkdown(text) {
    // Remove ```json ... ``` or ``` ... ``` wrapper
    let cleaned = text.trim();
    const mdMatch = cleaned.match(/^```(?:json)?\s*\n?(.*?)\n?\s*```$/s);
    if (mdMatch) {
      cleaned = mdMatch[1].trim();
    }
    return cleaned;
  },

  // Parse AI JSON response with fallback
  parseAIJSON(text) {
    const cleaned = this.stripMarkdown(text);

    // Try direct JSON parse
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Try extracting JSON with regex
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          // Last resort: try to find the outermost { }
          const braceStart = cleaned.indexOf('{');
          const braceEnd = cleaned.lastIndexOf('}');
          if (braceStart !== -1 && braceEnd > braceStart) {
            try {
              return JSON.parse(cleaned.substring(braceStart, braceEnd + 1));
            } catch (e3) {
              throw new Error('无法解析AI返回的JSON数据');
            }
          }
          throw new Error('无法解析AI返回的JSON数据');
        }
      }
      throw new Error('AI返回数据中没有找到JSON');
    }
  },

  // Validate category
  validateCategory(cat) {
    const valid = ['work', 'life', 'social'];
    return valid.includes(cat) ? cat : 'life';
  },

  // Validate priority
  validatePriority(pri) {
    if (pri && typeof pri.important === 'boolean' && typeof pri.urgent === 'boolean') {
      return pri;
    }
    return { important: false, urgent: false };
  },

  // ===== Prompt 1: Pattern Analysis =====
  buildAnalysisPrompt(schedules) {
    const simplified = schedules.map(s => ({
      title: s.title,
      category: s.category,
      priority: s.priority,
      scheduledDate: s.scheduledDate,
      scheduledTime: s.scheduledTime || '全天',
      repeat: s.repeat
    }));

    const systemPrompt = `你是一个个人行程管理助手。你的任务是分析用户的历史行程数据，识别重复出现的行程模式，总结作息规律，并给出将某些行程转为常态化固定行程的建议。

你必须严格按以下JSON格式返回结果，不要包含任何其他文字：
{
  "patterns": [
    {
      "title": "建议的固定行程标题",
      "category": "work|life|social",
      "priority": { "important": true或false, "urgent": true或false },
      "repeat": { "type": "daily|weekly|monthly", "weekdays": [1-7数字数组], "interval": 1 },
      "scheduledTime": "HH:MM格式时间或null",
      "reason": "识别依据，简要说明为什么建议这个模式",
      "confidence": 0.0到1.0的数字
    }
  ],
  "routineSummary": "用1-2句话总结用户的作息规律",
  "suggestions": [
    {
      "type": "priority_adjustment",
      "description": "建议调整某个行程的优先级，说明原因"
    }
  ]
}

注意：
- patterns数组最多返回5条，只包含你有较高把握的模式（confidence > 0.6）
- weekdays数字含义：1=周一, 2=周二, ..., 7=周日
- 如果数据不足以识别模式，返回空patterns数组和简短routineSummary
- repeat字段中type为daily时weekdays留空数组`;

    const userPrompt = `以下是我最近的历史行程数据（JSON格式）：

${JSON.stringify(simplified, null, 2)}

请分析这些行程数据，找出：
1. 重复出现的行程模式（如每周固定时间开会、每天固定时间运动等）
2. 作息规律总结
3. 建议转为常态化固定行程的项

请按要求的JSON格式返回分析结果。`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  },

  // Run pattern analysis
  async analyzePatterns() {
    const schedules = App.data.loadSchedules();
    if (schedules.length < 3) {
      throw new Error('行程数据太少（至少需要3条），AI无法有效分析模式');
    }

    const recent = schedules.slice(0, 50);
    const messages = this.buildAnalysisPrompt(recent);
    const rawResponse = await this.callAI(messages);

    const parsed = this.parseAIJSON(rawResponse);

    // Validate and clean patterns
    if (parsed.patterns && Array.isArray(parsed.patterns)) {
      parsed.patterns = parsed.patterns
        .filter(p => p.confidence > 0.5)
        .slice(0, 5)
        .map(p => ({
          ...p,
          category: this.validateCategory(p.category),
          priority: this.validatePriority(p.priority),
          id: 'ai_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          type: 'recurring_pattern',
          adopted: false,
          createdAt: new Date().toISOString()
        }));
    } else {
      parsed.patterns = [];
    }

    if (!parsed.routineSummary) {
      parsed.routineSummary = '暂未识别出明显的作息规律';
    }

    if (!parsed.suggestions) {
      parsed.suggestions = [];
    }

    // Save suggestions
    App.data.saveAISuggestions(parsed.patterns);

    return parsed;
  },

  // ===== Prompt 2: Category & Priority Recommendation =====
  buildRecommendPrompt(title, recentSchedules) {
    const simplified = recentSchedules.map(s => ({
      title: s.title,
      category: s.category,
      priority: s.priority,
      scheduledTime: s.scheduledTime
    }));

    const systemPrompt = `你是一个个人行程管理助手。根据用户输入的行程标题和历史行程数据，推荐最合适的分类和优先级。

你必须严格按以下JSON格式返回，不要包含任何其他文字：
{
  "category": "work|life|social",
  "priority": { "important": true或false, "urgent": true或false },
  "repeat": { "type": "none|daily|weekly|monthly", "weekdays": [], "interval": 1 },
  "reason": "简要说明推荐理由"
}

注意：
- weekdays数字含义：1=周一, 2=周二, ..., 7=周日
- repeat.type为none或daily时weekdays留空数组`;

    const userPrompt = `用户输入的新行程标题："${title}"

用户的历史行程数据（用于参考用户的习惯）：
${JSON.stringify(simplified, null, 2)}

请根据标题内容和用户习惯，推荐分类、优先级和重复频率。`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  },

  // Recommend category and priority for a new schedule
  async recommendForTitle(title) {
    if (!title || title.trim().length < 2) {
      throw new Error('请先输入行程标题（至少2个字）');
    }

    const schedules = App.data.loadSchedules();
    const recent = schedules.slice(0, 20);
    const messages = this.buildRecommendPrompt(title.trim(), recent);
    const rawResponse = await this.callAI(messages);

    const parsed = this.parseAIJSON(rawResponse);

    return {
      category: this.validateCategory(parsed.category),
      priority: this.validatePriority(parsed.priority),
      repeat: parsed.repeat || { type: 'none', weekdays: [], interval: 1 },
      reason: parsed.reason || '基于行程标题的语义分析'
    };
  },

  // Adopt a suggestion as a recurring schedule
  adoptSuggestion(suggestion) {
    const schedule = {
      id: 'sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: suggestion.title,
      description: `AI建议采纳：${suggestion.reason}`,
      category: suggestion.category,
      priority: suggestion.priority,
      scheduledDate: new Date().toISOString().split('T')[0], // Start from today
      scheduledTime: suggestion.scheduledTime || null,
      duration: 60,
      repeat: suggestion.repeat || { type: 'weekly', weekdays: [], interval: 1 },
      reminder: {
        enabled: true,
        advanceMinutes: App.data.loadSettings().notification.notifyBefore || 15,
        notified: false
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'ai_adopted',
      isRecurringInstance: false
    };

    App.data.addSchedule(schedule);

    // Mark suggestion as adopted
    const suggestions = App.data.loadAISuggestions();
    const idx = suggestions.findIndex(s => s.id === suggestion.id);
    if (idx !== -1) {
      suggestions[idx].adopted = true;
      App.data.saveAISuggestions(suggestions);
    }

    return schedule;
  }
};