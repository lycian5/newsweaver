# newsweaver

COA NEWS의 대량 기사 소재 수집, 중복 제거, 점수화, 리서치 검증과 등록용 기사 초안 작업을 제공하는 운영 프로젝트입니다.

운영 기준의 단일 원본은 [`docs/OPERATING_STANDARD.md`](docs/OPERATING_STANDARD.md)입니다. 수집 현황을 빠르게 보려면 [`docs/REVIEW.md`](docs/REVIEW.md)를 봅니다.

## 운영 화면

- 배포 URL: `https://newsweaver.vercel.app`
- 로그인: https://newsweaver.vercel.app/admin-login
- 수집 운영: https://newsweaver.vercel.app/vps-collector
- 리서치 브리프: https://newsweaver.vercel.app/research-briefs
- 등록용 기사 준비: https://newsweaver.vercel.app/coanews-draft

수집 운영은 오늘 자동 수집 상태를 먼저 보여 주고, 수동 재수집은 예외 작업입니다. 리서치 브리프는 오늘 작성 가능한 소재를 기본 큐로 엽니다.

수집 제어, 리서치 브리프, 등록용 기사 준비는 하나의 관리자 세션을 사용합니다. Vercel Production에 다음 값을 설정합니다.

```text
CRON_SECRET=<자동화 전용 비밀값>
DASHBOARD_PASSWORD=<관리자 로그인 비밀번호, 12자 이상>
DASHBOARD_SESSION_SECRET=<선택, 32자 이상의 별도 세션 비밀값>
```

`CRON_SECRET`을 사람의 로그인 비밀번호로 사용하지 않습니다. `/admin-login`에서 로그인하면 세션은 7일간 유지됩니다.

### Reddit 수집 설정

Reddit의 비공식 `.json` 엔드포인트는 운영 수집에 사용하지 않습니다. Reddit 개발자 콘솔에서 읽기 전용 API 사용이 승인된 앱을 만든 뒤, VPS의 `/opt/n8n/.env`에 아래 값만 설정합니다. Vercel 환경변수에는 넣지 않습니다.

```text
REDDIT_CLIENT_ID=<앱 client id>
REDDIT_CLIENT_SECRET=<앱 client secret>
REDDIT_USER_AGENT=script:coa-newsweaver:v1.0 (by /u/lycian57)
AGENT_REACH_SOURCES=exa,official,rss,reddit
AGENT_REACH_REDDIT_RESULTS=5
```

수집기는 OAuth 토큰을 메모리에서 재사용하고, Reddit 결과는 신호 출처로만 기록합니다. 기사 초안 준비에는 기존의 공식·검증 출처 검사가 계속 적용됩니다.

## 수집 전략

- 주수집과 Agent Reach는 별도 수집입니다. 주수집 결과를 입력으로 재수집하지 않고, 같은 `raw_articles`에 합칩니다.
- Vercel 전날 마감 수집은 Naver, Google, Bing 뉴스와 국내 언론 RSS를 중심으로 매일 18개 키워드의 전날 발행분을 처리하고, 09시대 조건부 작업이 실패·저수집만 보정합니다.
- VPS Agent Reach는 Exa, 공식 기관, RSS를 중심으로 매일 54개 키워드를 처리합니다. RSS는 해외 기술·창업 피드와 국내 언론 피드를 함께 사용하며, `AGENT_REACH_JINA_ENRICH=true`일 때 원문 보강을 수행합니다.
- 다음/카카오 RSS와 빅카인즈 API는 넣지 않았습니다. 이유와 점검 순서는 [`docs/REVIEW.md`](docs/REVIEW.md)에 있습니다.
- 원시 수집에는 OpenAI를 사용하지 않습니다.
- 중복 제거, 출처 평가, 점수화, 사건 클러스터링 후 최대 100개 브리프를 표시합니다.
- 리서치 브리프에서 대표 제목, 근거 기사, 출처 URL, 공식·검증 출처를 확인한 뒤 기사 초안을 시작합니다.
- 완성 기사는 검증된 소재에 한해 작성하고 등록용 승인을 거쳐 신문 플랫폼에 수동 등록합니다.

## 편집 및 플랫폼 상태

기사 초안의 `pending_editor_approval`은 내부 편집장 검토대기 상태입니다. `approved`는 등록용 최종본 승인 상태이며 신문 플랫폼에 실제 등록됐다는 뜻은 아닙니다.

등록용 승인이 완료되면 기사 준비 화면에서 `article.json`, `body.html`, 선택한 대표 이미지와 체크리스트가 포함된 ZIP을 만들 수 있습니다. 자동 게시 기능은 제공하지 않으며, 플랫폼에 JSON 또는 CSV 가져오기 기능이 생길 때까지 수동 등록을 유지합니다.

## Vercel 배포

- GitHub: `lycian5/newsweaver`
- Vercel 프로젝트: `newsweaver`
- Framework Preset: Other
- Output Directory: `docs`

`vercel.json`이 정적 화면과 API cron 구성을 관리합니다.

## VPS 및 n8n 배포

```powershell
cd C:\Users\user\orca\projects\newsweaver\deploy\n8n
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
```

n8n은 `127.0.0.1:5678`에만 바인딩하고 Caddy HTTPS를 통해 접근합니다. 설치, 비밀값, Agent Reach, 백업, DS220j와 복원 절차는 [`deploy/n8n/README.md`](deploy/n8n/README.md)를 따릅니다.

## 로컬 실행

정적 화면:

```powershell
npm start
```

Python 수집기:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -e .
policy-collector collect --max-pages 5 --format json --output exports/latest.json
```

FastAPI 화면:

```powershell
uvicorn policy_article_collector.app:app --reload --host 127.0.0.1 --port 8080
```

## 보안

API 키, Supabase service role key, 데이터베이스 URL, 백업 암호와 `.env` 파일을 Git에 커밋하지 않습니다. n8n의 5678 포트와 Agent Reach runner의 8787 포트를 인터넷에 공개하지 않습니다.
