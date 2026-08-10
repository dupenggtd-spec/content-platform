'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'content.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const nowISO = () => new Date().toISOString();
const makeId = prefix => `${prefix}_${randomUUID()}`;
const clampScore = value => Math.min(5, Math.max(0, Number.parseInt(value, 10) || 0));
const stringifyJSON = (value, fallback) => {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch (_) {
      return JSON.stringify(fallback);
    }
  }
  return JSON.stringify(value ?? fallback);
};
const parseJSON = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
};

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      section TEXT DEFAULT "",
      source TEXT DEFAULT "manual",
      score_intensity INTEGER DEFAULT 0,
      score_gap INTEGER DEFAULT 0,
      score_persona INTEGER DEFAULT 0,
      score_timing INTEGER DEFAULT 0,
      status TEXT DEFAULT "pending",
      note TEXT DEFAULT "",
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      idea_id TEXT,
      title TEXT NOT NULL,
      section TEXT DEFAULT "",
      body TEXT DEFAULT "",
      tags TEXT DEFAULT "[]",
      cover_image TEXT DEFAULT "",
      cover_idea TEXT DEFAULT "",
      cover_type TEXT DEFAULT "其他",
      images TEXT DEFAULT "[]",
      checklist TEXT DEFAULT "[false,false,false,false,false,false]",
      status TEXT DEFAULT "editing",
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS published (
      id TEXT PRIMARY KEY,
      draft_id TEXT,
      title TEXT NOT NULL,
      section TEXT DEFAULT "",
      body TEXT DEFAULT "",
      tags TEXT DEFAULT "[]",
      cover_image TEXT DEFAULT "",
      images TEXT DEFAULT "[]",
      platform TEXT DEFAULT "小红书",
      publish_date TEXT NOT NULL,
      metrics_24h TEXT DEFAULT "{}",
      metrics_7d TEXT DEFAULT "{}",
      metrics_30d TEXT DEFAULT "{}",
      rating TEXT DEFAULT "normal",
      review TEXT DEFAULT "",
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS principles (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      category TEXT DEFAULT "内容",
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT "📄"
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drafts_updated_at ON drafts(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_published_publish_date ON published(publish_date DESC);
    CREATE INDEX IF NOT EXISTS idx_principles_sort_order ON principles(sort_order ASC);
  `);

  seedDatabase();
}

function seedDatabase() {
  const principles = [
    '核心壁垒=20年老兵×零基础AI交叉点',
    '板块1流量杠杆70%板块2护城河30%',
    '定期交叉内容防止人格分裂',
    '选题热点驱动不拍脑袋',
    '4维打分≥12分才做',
    '选车先看销量榜不凭印象',
    '叫带你选好车不叫竞品对比',
    '正文≤200字emoji≤2个',
    '零AI味不排比不说教不堆砌',
    '标题方向性钩子不用数字',
    '散装自嘲反精致',
    '禁止出现平台名',
    '封面有画面感不纯文字',
    '封面一秒看清',
    '封面价值前置',
    '发布前调研爆款',
    '配图先调研再设计',
    '发布后24h/7d/30d记录反馈',
    '每周复盘',
    '月度总结迭代'
  ];

  const created1 = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  const created2 = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const aiBody = `做内容得配图，这是常识。

听说Gemini能生图，打开网页试了试。质量还行，能用。

但一篇要三四张图。手动生成、等出图、下载、改名……干了两篇，人麻了。

既然在折腾AI，就让AI折腾AI。

写了段脚本，通过Chrome调试接口控制Gemini网页：输入提示词→自动点发送→等出图→自动下载原图。

听起来简单。实际踩了一路坑：

坑一：图片用blob方式下载，CORS直接拦死，全废。
坑二：改走下载按钮，Chrome弹下载提示框，脚本卡死。
坑三：关掉弹框，图片又不自动存了。
坑四：翻文档找到下载行为API，设好路径，终于跑通。

现在：提示词扔进去，大图自动落盘，七八兆一张。全自动，不用盯。

散装是散装，但能跑。

翻车了再跟你们说。

#散装AI #AI配图 #Gemini #AI效率工具 #汽车人玩AI`;
  const carBody = `六万块买车，别看广告看销量。

我拉了六月行业销量数据，六万级别真正卖得动的就这四台：

星愿，月销三万三，断层第一。
启源Q05，月销快一万九，唯一混动。
元UP，月销快一万八，比亚迪品牌力。
缤果Pro，月销一万四，最便宜。

参数表能查的我不重复讲。我讲参数表背后的。

星愿凭啥卖第一？空间同级最大，颜值在线，价格不贵。三样占全了，太难了。

启源Q05凭啥上榜？四台里唯一混动。有长途需求不想充电排队，选它。

元UP凭啥选它？比亚迪刀片电池加保值率。信品牌选它没错。

缤果Pro凭啥也行？5.68万上路，五菱不跟你玩优惠套路。预算紧选它。

如果只让我选一台：星愿。因为它最没有短板。

什么人别选纯电：家里只有一台车、经常跑长途、小区装不了充电桩。三条中一条，加钱上混动。

#六万买车 #选车指南 #新手买车 #汽车老兵 #新能源车`;

  const seed = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS count FROM sections').get().count === 0) {
      const insert = db.prepare('INSERT INTO sections (id, name, icon) VALUES (?, ?, ?)');
      insert.run('ai-rookie', '零基础AI', '🤖');
      insert.run('car-choice', '带你选好车', '🚗');
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM principles').get().count === 0) {
      const insert = db.prepare('INSERT INTO principles (id, text, category, enabled, sort_order) VALUES (?, ?, ?, ?, ?)');
      principles.forEach((text, index) => insert.run(`rule_${index + 1}`, text, '内容', 1, index + 1));
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM ideas').get().count === 0) {
      const insert = db.prepare(`
        INSERT INTO ideas (
          id, title, section, source, score_intensity, score_gap,
          score_persona, score_timing, status, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        'idea_demo_ai', 'AI配图越精致，为什么越没人信？', 'ai-rookie', '热点雷达 · AI绘图',
        4, 4, 5, 4, 'adopted', '从“塑料感”切入，做一篇散装AI配图避坑。', created1, created1
      );
      insert.run(
        'idea_demo_car', '6万预算选车，先别打开配置表', 'car-choice', '读者留言',
        4, 3, 4, 3, 'candidate', '用销量榜缩小范围，再聊真实使用场景。', created2, created2
      );
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM drafts').get().count === 0) {
      const insert = db.prepare(`
        INSERT INTO drafts (
          id, idea_id, title, section, body, tags, cover_image, cover_idea,
          cover_type, images, checklist, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        'draft_ai_image', 'idea_demo_ai', '散装AI搞配图，差点把自己搞疯了', 'ai-rookie', aiBody,
        JSON.stringify(['散装AI', 'AI配图', 'Gemini', 'AI效率工具', '汽车人玩AI']),
        '/assets/ai_bright.png', 'Before/After对比：左边手动操作人麻了，右边AI全自动搞定',
        '前后对比', '[]', '[true,true,true,true,false,true]', 'editing', created1, nowISO()
      );
      insert.run(
        'draft_car_6w', 'idea_demo_car', '六万块买什么车，一篇帮你搞定', 'car-choice', carBody,
        JSON.stringify(['六万买车', '选车指南', '新手买车', '汽车老兵', '新能源车']),
        '/assets/cars_bright.png', '黑底黄字大标题+四款车销量排行清单',
        '纯文字', '[]', '[true,true,true,true,false,true]', 'editing', created2, nowISO()
      );
    }
  });

  seed();
}

function decodeDraft(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJSON(row.tags, []),
    images: parseJSON(row.images, []),
    checklist: parseJSON(row.checklist, [false, false, false, false, false, false])
  };
}

function decodePublished(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJSON(row.tags, []),
    images: parseJSON(row.images, []),
    metrics_24h: parseJSON(row.metrics_24h, {}),
    metrics_7d: parseJSON(row.metrics_7d, {}),
    metrics_30d: parseJSON(row.metrics_30d, {})
  };
}

function requireTitle(input) {
  const title = String(input?.title || '').trim();
  if (!title) {
    const error = new Error('title 不能为空');
    error.status = 400;
    throw error;
  }
  return title;
}

function getIdeas() {
  return db.prepare('SELECT * FROM ideas ORDER BY created_at DESC').all();
}

function getIdea(id) {
  return db.prepare('SELECT * FROM ideas WHERE id = ?').get(id) || null;
}

function createIdea(input = {}) {
  const timestamp = nowISO();
  const item = {
    id: String(input.id || makeId('idea')),
    title: requireTitle(input),
    section: String(input.section ?? input.sectionId ?? ''),
    source: String(input.source || 'manual'),
    score_intensity: clampScore(input.score_intensity ?? input.scores?.intensity),
    score_gap: clampScore(input.score_gap ?? input.scores?.whitespace ?? input.scores?.gap),
    score_persona: clampScore(input.score_persona ?? input.scores?.persona),
    score_timing: clampScore(input.score_timing ?? input.scores?.timeliness ?? input.scores?.timing),
    status: String(input.status || 'pending'),
    note: String(input.note || ''),
    created_at: String(input.created_at || input.createdAt || timestamp),
    updated_at: timestamp
  };
  db.prepare(`
    INSERT INTO ideas (
      id, title, section, source, score_intensity, score_gap, score_persona,
      score_timing, status, note, created_at, updated_at
    ) VALUES (
      @id, @title, @section, @source, @score_intensity, @score_gap, @score_persona,
      @score_timing, @status, @note, @created_at, @updated_at
    )
  `).run(item);
  return getIdea(item.id);
}

function updateIdea(id, input = {}) {
  const current = getIdea(id);
  if (!current) return null;
  const merged = { ...current, ...input };
  const item = {
    id,
    title: requireTitle(merged),
    section: String(input.section ?? input.sectionId ?? current.section),
    source: String(input.source ?? current.source),
    score_intensity: clampScore(input.score_intensity ?? input.scores?.intensity ?? current.score_intensity),
    score_gap: clampScore(input.score_gap ?? input.scores?.whitespace ?? input.scores?.gap ?? current.score_gap),
    score_persona: clampScore(input.score_persona ?? input.scores?.persona ?? current.score_persona),
    score_timing: clampScore(input.score_timing ?? input.scores?.timeliness ?? input.scores?.timing ?? current.score_timing),
    status: String(input.status ?? current.status),
    note: String(input.note ?? current.note),
    updated_at: nowISO()
  };
  db.prepare(`
    UPDATE ideas SET
      title=@title, section=@section, source=@source, score_intensity=@score_intensity,
      score_gap=@score_gap, score_persona=@score_persona, score_timing=@score_timing,
      status=@status, note=@note, updated_at=@updated_at
    WHERE id=@id
  `).run(item);
  return getIdea(id);
}

function deleteIdea(id) {
  return db.prepare('DELETE FROM ideas WHERE id = ?').run(id).changes > 0;
}

function getDrafts() {
  return db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all().map(decodeDraft);
}

function getDraft(id) {
  return decodeDraft(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id));
}

function normalizeDraft(input, current = {}) {
  const timestamp = nowISO();
  return {
    id: String(input.id || current.id || makeId('draft')),
    idea_id: input.idea_id ?? input.sourceIdeaId ?? current.idea_id ?? null,
    title: requireTitle({ ...current, ...input }),
    section: String(input.section ?? input.sectionId ?? current.section ?? ''),
    body: String(input.body ?? current.body ?? ''),
    tags: stringifyJSON(input.tags ?? current.tags, []),
    cover_image: String(input.cover_image ?? input.coverImage ?? current.cover_image ?? ''),
    cover_idea: String(input.cover_idea ?? input.coverIdea ?? current.cover_idea ?? ''),
    cover_type: String(input.cover_type ?? input.coverType ?? current.cover_type ?? '其他'),
    images: stringifyJSON(input.images ?? current.images, []),
    checklist: stringifyJSON(input.checklist ?? current.checklist, [false, false, false, false, false, false]),
    status: String(input.status ?? current.status ?? 'editing'),
    created_at: String(input.created_at ?? input.createdAt ?? current.created_at ?? timestamp),
    updated_at: timestamp
  };
}

function createDraft(input = {}) {
  const item = normalizeDraft(input);
  db.prepare(`
    INSERT INTO drafts (
      id, idea_id, title, section, body, tags, cover_image, cover_idea,
      cover_type, images, checklist, status, created_at, updated_at
    ) VALUES (
      @id, @idea_id, @title, @section, @body, @tags, @cover_image, @cover_idea,
      @cover_type, @images, @checklist, @status, @created_at, @updated_at
    )
  `).run(item);
  return getDraft(item.id);
}

function updateDraft(id, input = {}) {
  const current = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
  if (!current) return null;
  const item = normalizeDraft({ ...input, id }, current);
  db.prepare(`
    UPDATE drafts SET
      idea_id=@idea_id, title=@title, section=@section, body=@body, tags=@tags,
      cover_image=@cover_image, cover_idea=@cover_idea, cover_type=@cover_type,
      images=@images, checklist=@checklist, status=@status, updated_at=@updated_at
    WHERE id=@id
  `).run(item);
  return getDraft(id);
}

function deleteDraft(id) {
  return db.prepare('DELETE FROM drafts WHERE id = ?').run(id).changes > 0;
}

function getPublished() {
  return db.prepare('SELECT * FROM published ORDER BY publish_date DESC').all().map(decodePublished);
}

function getPublishedById(id) {
  return decodePublished(db.prepare('SELECT * FROM published WHERE id = ?').get(id));
}

function normalizePublished(input, draft = {}, current = {}) {
  const timestamp = nowISO();
  return {
    id: String(input.id || current.id || makeId('published')),
    draft_id: input.draft_id ?? input.draftId ?? current.draft_id ?? draft.id ?? null,
    title: requireTitle({ ...draft, ...current, ...input }),
    section: String(input.section ?? input.sectionId ?? current.section ?? draft.section ?? ''),
    body: String(input.body ?? current.body ?? draft.body ?? ''),
    tags: stringifyJSON(input.tags ?? current.tags ?? draft.tags, []),
    cover_image: String(input.cover_image ?? input.coverImage ?? current.cover_image ?? draft.cover_image ?? ''),
    images: stringifyJSON(input.images ?? current.images ?? draft.images, []),
    platform: String(input.platform ?? current.platform ?? '小红书'),
    publish_date: String(input.publish_date ?? input.publishedAt ?? current.publish_date ?? timestamp),
    metrics_24h: stringifyJSON(input.metrics_24h ?? input.metrics?.['24h'] ?? current.metrics_24h, {}),
    metrics_7d: stringifyJSON(input.metrics_7d ?? input.metrics?.['7d'] ?? current.metrics_7d, {}),
    metrics_30d: stringifyJSON(input.metrics_30d ?? input.metrics?.['30d'] ?? current.metrics_30d, {}),
    rating: String(input.rating ?? input.mark ?? current.rating ?? 'normal'),
    review: String(input.review ?? input.reviewNote ?? current.review ?? ''),
    created_at: String(input.created_at ?? current.created_at ?? timestamp)
  };
}

function createPublished(input = {}) {
  const draftId = input.draft_id ?? input.draftId;
  const draft = draftId ? db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) : null;
  if (draftId && !draft) {
    const error = new Error('未找到要发布的稿件');
    error.status = 404;
    throw error;
  }
  const item = normalizePublished(input, draft || {});
  const publish = db.transaction(() => {
    db.prepare(`
      INSERT INTO published (
        id, draft_id, title, section, body, tags, cover_image, images, platform,
        publish_date, metrics_24h, metrics_7d, metrics_30d, rating, review, created_at
      ) VALUES (
        @id, @draft_id, @title, @section, @body, @tags, @cover_image, @images, @platform,
        @publish_date, @metrics_24h, @metrics_7d, @metrics_30d, @rating, @review, @created_at
      )
    `).run(item);
    if (draftId) {
      db.prepare('UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?').run('published', nowISO(), draftId);
    }
  });
  publish();
  return getPublishedById(item.id);
}

function updatePublished(id, input = {}) {
  const raw = db.prepare('SELECT * FROM published WHERE id = ?').get(id);
  if (!raw) return null;
  const item = normalizePublished({ ...input, id }, {}, raw);
  db.prepare(`
    UPDATE published SET
      draft_id=@draft_id, title=@title, section=@section, body=@body, tags=@tags,
      cover_image=@cover_image, images=@images, platform=@platform, publish_date=@publish_date,
      metrics_24h=@metrics_24h, metrics_7d=@metrics_7d, metrics_30d=@metrics_30d,
      rating=@rating, review=@review
    WHERE id=@id
  `).run(item);
  return getPublishedById(id);
}

function deletePublished(id) {
  return db.prepare('DELETE FROM published WHERE id = ?').run(id).changes > 0;
}

function getPrinciples() {
  return db.prepare('SELECT * FROM principles ORDER BY sort_order ASC, id ASC').all()
    .map(item => ({ ...item, enabled: Boolean(item.enabled) }));
}

function updatePrinciple(id, input = {}) {
  const current = db.prepare('SELECT * FROM principles WHERE id = ?').get(id);
  if (!current) return null;
  const item = {
    id,
    text: String(input.text ?? current.text).trim(),
    category: String(input.category ?? current.category),
    enabled: input.enabled === undefined ? current.enabled : Number(Boolean(input.enabled)),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : current.sort_order
  };
  if (!item.text) {
    const error = new Error('原则内容不能为空');
    error.status = 400;
    throw error;
  }
  db.prepare(`
    UPDATE principles SET text=@text, category=@category, enabled=@enabled, sort_order=@sort_order
    WHERE id=@id
  `).run(item);
  return getPrinciples().find(principle => principle.id === id) || null;
}

function getSections() {
  return db.prepare('SELECT * FROM sections ORDER BY rowid ASC').all();
}

function getSection(id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(id) || null;
}

function createSection(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) {
    const error = new Error('板块名称不能为空');
    error.status = 400;
    throw error;
  }
  const item = { id: String(input.id || makeId('section')), name, icon: String(input.icon || '📄') };
  db.prepare('INSERT INTO sections (id, name, icon) VALUES (@id, @name, @icon)').run(item);
  return getSection(item.id);
}

function updateSection(id, input = {}) {
  const current = getSection(id);
  if (!current) return null;
  const item = {
    id,
    name: String(input.name ?? current.name).trim(),
    icon: String(input.icon ?? current.icon).trim() || '📄'
  };
  if (!item.name) {
    const error = new Error('板块名称不能为空');
    error.status = 400;
    throw error;
  }
  db.prepare('UPDATE sections SET name=@name, icon=@icon WHERE id=@id').run(item);
  return getSection(id);
}

function deleteSection(id) {
  return db.prepare('DELETE FROM sections WHERE id = ?').run(id).changes > 0;
}

initialize();

module.exports = {
  db,
  DB_PATH,
  getIdeas,
  getIdea,
  createIdea,
  updateIdea,
  deleteIdea,
  getDrafts,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  getPublished,
  getPublishedById,
  createPublished,
  updatePublished,
  deletePublished,
  getPrinciples,
  updatePrinciple,
  getSections,
  getSection,
  createSection,
  updateSection,
  deleteSection
};
