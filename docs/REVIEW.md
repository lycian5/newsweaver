# 수집 현황 빠른 검토

운영 규칙의 원본은 [`OPERATING_STANDARD.md`](OPERATING_STANDARD.md)입니다. 이 문서는 이후 검토·장애 확인을 위한 현재 구현 요약입니다.

- 기준일: 2026-08-16
- 수집 확장: `acc13f0`
- 수집 운영 화면: `6dd491a`
- 리서치 브리프 화면: `678a984`
- 운영 화면: `https://newsweaver.vercel.app`
- VPS n8n: `https://n8n.coanews.co.kr`

## 1. 지금 구조

주수집과 Agent Reach는 **별도 수집**입니다. 주수집 기사 URL을 다시 긁지 않습니다. 같은 `tracked_keywords`와 `raw_articles`를 쓰고, 오후 Agent Reach가 클러스터를 정리합니다.

```text
07:10 KST  주수집         Naver + Google + Bing + 국내 RSS + 정책/공공데이터
09:00 KST  보정           주수집 실패·저수집일 때만 같은 파이프라인 재실행
16:30 KST  Agent Reach    Exa + 공식 도메인 + 국내·해외 RSS (+선택 Reddit)
17:30 KST  소재 정리      중복 제거, 점수, 클러스터, 브리프
이후      사람 작업      브리프 선별 → 초안 → 승인 → ZIP 수동 등록
```

## 2. 운영 화면

로그인: https://newsweaver.vercel.app/admin-login  
세션 하나로 아래 세 화면을 씁니다.

| 단계 | 화면 | 주소 | 역할 |
|---|---|---|---|
| 수집 확인·예외 실행 | 수집 운영 | https://newsweaver.vercel.app/vps-collector | 오늘 주수집/보정/Agent Reach 상태, 오늘 키워드, 16:30 일정, 수동 재수집 |
| 소재 선별 | 리서치 브리프 | https://newsweaver.vercel.app/research-briefs | 기본 큐는 오늘 작성 가능 소재. 검증 후 초안 전환 |
| 작성·승인 | 기사 초안 | https://newsweaver.vercel.app/coanews-draft | 본문 작성, AI 보조, 등록용 승인, ZIP |

보조:

| 화면 | 주소 | 역할 |
|---|---|---|
| 공개 랜딩 | https://newsweaver.vercel.app | 로컬/보조 수집기. 운영 cron과 분리 |
| n8n | https://n8n.coanews.co.kr | Agent Reach runner 호출. 소재 선별 UI 아님 |

수집 운영 화면은 자동이 기본입니다. 채널·결과 수·직접 키워드는 접힌 수동 실행에만 쓰이며 내일 자동 수집을 바꾸지 않습니다. 16:30만 이 화면에서 바꿉니다. 07:10·09:00은 Vercel cron 고정입니다.

리서치 브리프는 작성 가능 / 검토 후 진행 / 보류 카드가 기본이고, 필터는 접혀 있습니다. 수집 상태 카드를 누르면 수집 운영으로 갑니다.

## 3. 5분 점검

1. https://newsweaver.vercel.app/vps-collector 에서 오늘 주수집·보정·Agent Reach 상태를 봅니다.
2. https://newsweaver.vercel.app/research-briefs 에서 작성 가능 소재가 보이는지 확인합니다.
3. VPS: `systemctl is-active coa-agent-reach-runner`가 `active`이고 `curl 127.0.0.1:8787/health`가 `ok`인지 확인합니다. 수집이 안 돌면 `active: false`는 정상입니다.
4. 코드: `api/cron/collect.js`에 `searchBingNews`, `fetchKoreanNewsRss`가 있는지 확인합니다.
5. 코드: `scripts/agent-reach-collect.js`가 `lib/koreanNewsRss.js`의 `DEFAULT_FEEDS`를 합치는지 확인합니다.
6. 데이터: `raw_articles.source`에 `bing_news`, `korean_news_rss:*`, `agent_reach_rss:*`가 생기는지 확인합니다.

## 4. 현재 수집 출처

주수집 키워드 검색: Naver, Google News KR, Bing News KR  
주수집 보강: 국내 언론 RSS 10곳, 정책 목록, 공공데이터 API  
Agent Reach: Exa, 공식 도메인 검색, 해외 기술 RSS + 같은 국내 RSS

국내 언론 RSS: 연합뉴스, 한국경제 IT, 매일경제, 조선비즈, 전자신문, 뉴시스, 플래텀, 벤처스퀘어, 바이라인네트워크, 더피알

공식 검색에 공정위, 통계청, 한은, 기재부가 포함됩니다.

넣지 않은 것:

| 후보 | 이유 |
|---|---|
| 다음/카카오 뉴스 RSS | 공개 검색·섹션 RSS가 404이거나 HTML만 반환 |
| 빅카인즈 API | 신청, 쿼터, 비용 확인 전 |
| 주수집 HTML 스크래핑 확대 | 사이트 구조 변경에 약함. 운영 본선은 API·RSS만 |

## 5. 핵심 파일

| 목적 | 파일 |
|---|---|
| 주수집 | `api/cron/collect.js` |
| 주수집 보정 | `api/cron/collect-recovery.js` |
| Bing 검색 | `lib/bingNews.js` |
| 국내 언론 RSS | `lib/koreanNewsRss.js` |
| Agent Reach 수집 | `scripts/agent-reach-collect.js` |
| 공식 도메인 검색어 | `scripts/research-query-taxonomy.js` |
| 오늘 수집 상태 API | `api/editorial/drafts.js` `view=collection-status` |
| 수집 운영 화면 | `docs/vps-collector.html` |
| 리서치 브리프 화면 | `docs/research-briefs.html` |
| 기사 초안 화면 | `docs/coanews-draft.html` |
| VPS 배포 | `deploy/n8n/deploy.ps1` |

공개 랜딩은 `docs/index.html`입니다. 관리자 운영 화면이 아닙니다.

## 6. 켜고 끄기

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

## 7. 배포

- Vercel: `main` 푸시 후 Production 배포. 정적 출력은 `docs/`.
- VPS: `deploy/n8n/deploy.ps1`. `lib/koreanNewsRss.js`를 `/opt/n8n/lib/`에 올립니다. 이 파일이 빠지면 Agent Reach RSS가 실패합니다.

## 8. 레거시

지우지 않습니다. 운영에도 켜지 않습니다.

- `n8n/workflow_collect.json`, `n8n/workflow_suggest.json`: 구형 보관본, `active: false`
- `n8n/workflow_agent_reach_collect.json`: 운영 워크플로 원본. VPS에는 `deploy/n8n`이 복사합니다.
- `scripts/bootstrap-vps.sh`: 구형 부트스트랩. 5678 공개를 막기 위해 즉시 종료합니다.
- `src/policy_article_collector/`: 로컬 단독 정책 수집기. 운영 본선이 아닙니다.
- `docs/vps-collector-mockup.html`, `docs/research-briefs-mockup.html`, `docs/vps-collector-compare.html`: 화면 개편 당시 참고 목업

## 9. 관련 테스트

```powershell
node tests/test_bing_news.js
node tests/test_korean_news_rss.js
node tests/test_agent_reach_korean_rss.js
node tests/test_keyword_dashboard.js
node tests/test_research_briefs.js
node tests/test_operating_standard.js
node tests/test_research_query_taxonomy.js
```
