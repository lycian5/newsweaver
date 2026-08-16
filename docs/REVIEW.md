# 수집 현황 빠른 검토

운영 규칙의 원본은 [`OPERATING_STANDARD.md`](OPERATING_STANDARD.md)입니다. 이 문서는 이후 검토·장애 확인을 위한 현재 구현 요약입니다.

- 기준일: 2026-08-16
- 수집 확장 커밋: `acc13f0`
- 운영 화면: `https://newsweaver.vercel.app`
- VPS n8n: `https://n8n.coanews.co.kr`

## 1. 지금 구조

주수집과 Agent Reach는 **별도 수집**입니다. 주수집 기사 URL을 다시 긁지 않습니다. 같은 `tracked_keywords`와 `raw_articles`를 쓰고, 오후 Agent Reach가 클러스터를 정리합니다.

```text
07:10 KST  주수집   Naver + Google + Bing + 국내 RSS + 정책/공공데이터
09:00 KST  보정     주수집 실패·저수집일 때만 같은 파이프라인 재실행
16:30 KST  Agent Reach   Exa + 공식 도메인 + 국내·해외 RSS (+선택 Reddit)
17:30 KST  소재 정리  중복 제거, 점수, 클러스터, 브리프
```

## 2. 5분 점검

1. Git: `main`이 `acc13f0` 이후인지, 작업 트리가 깨끗한지 확인합니다.
2. Vercel: Production이 같은 커밋인지, `/research-briefs` 로그인이 되는지 확인합니다.
3. VPS: `systemctl is-active coa-agent-reach-runner`가 `active`이고 `curl 127.0.0.1:8787/health`가 `ok`인지 확인합니다.
4. 코드: `api/cron/collect.js`에 `searchBingNews`, `fetchKoreanNewsRss`가 있는지 확인합니다.
5. 코드: `scripts/agent-reach-collect.js`가 `lib/koreanNewsRss.js`의 `DEFAULT_FEEDS`를 합치는지 확인합니다.
6. 데이터: 수집 실행 후 `raw_articles.source`에 `bing_news`, `korean_news_rss:*`, `agent_reach_rss:*`가 생기는지 확인합니다.

수집이 돌고 있지 않으면 runner health의 `active`는 `false`입니다. 고장 신호가 아닙니다.

## 3. 핵심 파일

| 목적 | 파일 |
|---|---|
| 주수집 | `api/cron/collect.js` |
| 주수집 보정 | `api/cron/collect-recovery.js` |
| Bing 검색 | `lib/bingNews.js` |
| 국내 언론 RSS | `lib/koreanNewsRss.js` |
| Agent Reach 수집 | `scripts/agent-reach-collect.js` |
| 공식 도메인 검색어 | `scripts/research-query-taxonomy.js` |
| VPS 배포 | `deploy/n8n/deploy.ps1` |
| 운영 화면 | `docs/vps-collector.html`, `docs/research-briefs.html`, `docs/coanews-draft.html` |

공개 랜딩은 `docs/index.html`입니다. 관리자 운영 화면이 아닙니다.

## 4. 넣지 않은 것

| 후보 | 이유 |
|---|---|
| 다음/카카오 뉴스 RSS | 공개 검색·섹션 RSS가 404이거나 HTML만 반환 |
| 빅카인즈 API | 신청, 쿼터, 비용 확인 전 |
| 주수집 HTML 스크래핑 확대 | 사이트 구조 변경에 약함. 운영 본선은 API·RSS만 |

## 5. 켜고 끄기

Vercel:

```text
BASE_COLLECT_BING_NEWS=false
BASE_COLLECT_KR_NEWS_RSS=false
```

VPS `/opt/n8n/.env`:

```text
AGENT_REACH_KR_NEWS_RSS=false
```

국내 피드 목록을 바꾸려면 `BASE_COLLECT_KR_NEWS_RSS_FEEDS`를 `이름|URL|분류` 형식으로 넣습니다. Agent Reach는 `AGENT_REACH_RSS_FEEDS`가 있어도 국내 피드를 뒤에 합칩니다.

## 6. 배포

- Vercel: `main` 푸시 후 Production 배포. 정적 출력은 `docs/`.
- VPS: `deploy/n8n/deploy.ps1`. `lib/koreanNewsRss.js`를 `/opt/n8n/lib/`에 올립니다. 이 파일이 빠지면 Agent Reach RSS가 실패합니다.

## 7. 레거시

지우지 않습니다. 운영에도 켜지 않습니다.

- `n8n/workflow_collect.json`, `n8n/workflow_suggest.json`: 구형 보관본, `active: false`
- `n8n/workflow_agent_reach_collect.json`: 운영 워크플로 원본. VPS에는 `deploy/n8n`이 복사합니다.
- `scripts/bootstrap-vps.sh`: 구형 부트스트랩. 5678 공개를 막기 위해 즉시 종료합니다.
- `src/policy_article_collector/`: 로컬 단독 정책 수집기. 운영 본선이 아닙니다.

## 8. 관련 테스트

```powershell
node tests/test_bing_news.js
node tests/test_korean_news_rss.js
node tests/test_agent_reach_korean_rss.js
node tests/test_operating_standard.js
node tests/test_research_query_taxonomy.js
```
