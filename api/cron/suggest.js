const { getSupabase } = require('../../lib/supabase');
const { assertCronAuth } = require('../../lib/cronAuth');
const { getOpenAI } = require('../../lib/openai');
const { resolveOpenAIModel } = require('../../lib/openaiModels');
const { getDatalabTrend } = require('../../lib/naver');
const { postBriefing } = require('../../lib/slack');

const CATEGORY_LABEL = {
  ai_business: 'AI 비즈니스',
  startup: '창업·부업',
  policy: '정책·지원사업',
};

const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['ai_business', 'startup', 'policy', 'column'] },
          format: { type: 'string', enum: ['article', 'column', 'interview'] },
          title: { type: 'string' },
          angle: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          reference_headlines: { type: 'array', items: { type: 'string' } },
          // OpenAI strict 모드는 모든 필드를 required에 넣어야 해서, 선택 필드는 nullable 타입으로 표현한다.
          quadrant: { type: ['string', 'null'] },
          interviewee: { type: ['string', 'null'] },
        },
        required: [
          'category',
          'format',
          'title',
          'angle',
          'keywords',
          'reference_headlines',
          'quadrant',
          'interviewee',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

module.exports = async (req, res) => {
  try {
    assertCronAuth(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  try {
    const supabase = getSupabase();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: articles, error: articlesError } = await supabase
      .from('raw_articles')
      .select('category, title, url, keyword_id, tracked_keywords(keyword)')
      .gte('collected_at', since)
      .order('collected_at', { ascending: false });
    if (articlesError) throw articlesError;

    const byCategory = groupByCategory(articles || []);
    const quadrants = await computeQuadrants(byCategory);

    const openai = getOpenAI();
    const model = resolveOpenAIModel('suggest', req.query?.model);
    const suggestions = await requestSuggestions(openai, byCategory, quadrants, model);

    if (suggestions.length) {
      const rows = suggestions.map((s) => ({
        category: s.category,
        format: s.format,
        title: s.title,
        angle: s.angle,
        keywords: s.keywords || [],
        reference_headlines: s.reference_headlines || [],
        quadrant: s.quadrant || null,
        interviewee: s.interviewee || null,
      }));
      const { error: insertError } = await supabase.from('topic_suggestions').insert(rows);
      if (insertError) throw insertError;
    }

    await postBriefing(formatSlackMessage(suggestions));

    res.status(200).json({ suggestionsCreated: suggestions.length, model });
  } catch (err) {
    console.error('[suggest] 실패:', err.message);
    res.status(500).json({ error: err.message });
  }
};

function groupByCategory(articles) {
  const grouped = { ai_business: [], startup: [], policy: [] };
  for (const a of articles) {
    if (grouped[a.category]) {
      grouped[a.category].push(a);
    }
  }
  return grouped;
}

async function computeQuadrants(byCategory) {
  const quadrants = {};

  for (const [category, articles] of Object.entries(byCategory)) {
    const keywordCounts = new Map();
    for (const a of articles) {
      const kw = a.tracked_keywords?.keyword;
      if (!kw) continue;
      keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
    }

    const topKeywords = [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([keyword]) => keyword);

    if (!topKeywords.length) {
      quadrants[category] = [];
      continue;
    }

    let trendResults = [];
    try {
      trendResults = await getDatalabTrend(
        topKeywords.map((kw) => ({ groupName: kw, keywords: [kw] }))
      );
    } catch (err) {
      console.error(`[suggest] 데이터랩 조회 실패 (${category}):`, err.message);
    }

    quadrants[category] = topKeywords.map((kw) => {
      const articleCount = keywordCounts.get(kw) || 0;
      const trend = trendResults.find((t) => t.title === kw);
      const ratios = (trend?.data || []).map((d) => d.ratio);
      const latest = ratios[ratios.length - 1] ?? 0;
      const prev = ratios[ratios.length - 2] ?? latest;
      const growth = prev > 0 ? (latest - prev) / prev : 0;

      const interestHigh = growth >= 0.3;
      const supplyHigh = articleCount >= 5;
      let quadrant = null;
      if (interestHigh && !supplyHigh) quadrant = 'blue_ocean';
      else if (interestHigh && supplyHigh) quadrant = 'hot';
      else if (!interestHigh && supplyHigh) quadrant = 'media_led';

      return { keyword: kw, articleCount, growth, quadrant };
    });
  }

  return quadrants;
}

async function requestSuggestions(openai, byCategory, quadrants, model) {
  const summary = Object.entries(byCategory)
    .map(([category, articles]) => {
      const label = CATEGORY_LABEL[category] || category;
      const headlines =
        articles
          .slice(0, 8)
          .map((a) => `- ${a.title}`)
          .join('\n') || '(수집된 기사 없음)';
      const quadrantText =
        (quadrants[category] || [])
          .map(
            (q) =>
              `${q.keyword}: ${q.quadrant || '변동없음'} (기사 ${q.articleCount}건, 검색량 변화 ${(q.growth * 100).toFixed(0)}%)`
          )
          .join('\n') || '(분석 대상 키워드 없음)';
      return `## ${label}\n[키워드 사분면]\n${quadrantText}\n[최근 헤드라인]\n${headlines}`;
    })
    .join('\n\n');

  const system = `당신은 코아뉴스의 편집 데스크 보조입니다. 코아뉴스는 다음 4개 섹션을 운영합니다:
- AI 비즈니스: 최신 AI 기술·활용 사례·업무 자동화
- 창업·부업: 창업 트렌드, 온라인 수익화, 1인 기업 실전 정보
- 정책·지원사업: 정부·공공기관 지원사업을 쉽게 풀어주는 실용 정보
- 칼럼·인터뷰: 현장 경험과 전문가 분석 기반의 심층 시각, 전문가·당사자 인터뷰

다음 기준으로 소재를 제안하세요:
- AI 비즈니스 2건, 창업·부업 2건, 정책·지원사업 2건
- 칼럼 1건: media_led 또는 지속되는 hot 키워드에서 선정
- 인터뷰 1건: blue_ocean 키워드 또는 당사자가 명확한 hot 이슈에서 선정하고, 섭외할 인터뷰이 유형을 interviewee 필드에 구체적으로 제안 (예: "AI 도입 중소기업 대표")
- blue_ocean 키워드가 있으면 반드시 1건 이상 포함
- 반드시 8건을 제안`;

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `[오늘의 카테고리별 키워드 분석]\n\n${summary}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'topic_suggestions',
        schema: SUGGESTIONS_SCHEMA,
        strict: true,
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  const parsed = JSON.parse(content);
  return parsed.suggestions || [];
}

function formatSlackMessage(suggestions) {
  if (!suggestions.length) {
    return '*🗞 코아뉴스 오늘의 소재 브리핑*\n오늘은 제안할 소재가 없습니다 (수집된 기사 부족).';
  }
  const emoji = { article: '📰', column: '✍️', interview: '🎙' };
  const lines = ['*🗞 코아뉴스 오늘의 소재 브리핑*', ''];
  suggestions.forEach((s, i) => {
    lines.push(`${i + 1}. ${emoji[s.format] || '📌'} *${s.title}*`);
    if (s.angle) lines.push(`   _${s.angle}_`);
    if (s.interviewee) lines.push(`   섭외 대상: ${s.interviewee}`);
    if (s.keywords?.length) lines.push(`   키워드: ${s.keywords.join(', ')}`);
    lines.push('');
  });
  return lines.join('\n');
}
