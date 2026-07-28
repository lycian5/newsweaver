# n8n VPS 배포 및 운영

Vultr Ubuntu 24.04의 `/opt/n8n`에 Postgres 16, n8n `2.30.7`, Agent Reach runner, Caddy와 암호화 백업을 배포합니다. n8n은 `127.0.0.1:5678`에만 바인딩하며 외부에서는 Caddy의 80/443만 사용합니다.

운영 수집 기준은 [`../../docs/OPERATING_STANDARD.md`](../../docs/OPERATING_STANDARD.md)를 따릅니다.

## 배포 전 준비

1. DNS A 레코드 `n8n.coanews.co.kr -> 158.247.245.66`을 확인합니다.
2. Windows OpenSSH로 `root@158.247.245.66` 접속이 되는지 확인합니다.
3. 이 폴더에서 `.env.example`을 `.env`로 복사하고 값을 채웁니다.
4. `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `AGENT_REACH_RUNNER_SECRET`, `AGENT_REACH_WEBHOOK_SECRET`, `BACKUP_ENCRYPTION_PASSWORD`는 서로 다른 강한 값으로 설정합니다.
5. `.env`와 백업 암호는 Git에 커밋하지 않습니다.

Agent Reach의 기본 운영값은 Exa, 공식 출처, RSS를 이용해 활성 키워드 54개를 처리합니다. 핵심 12개는 매회 포함하고 나머지 42개는 확장 키워드 풀에서 순환합니다. YouTube와 GitHub는 각각 인증과 쿠키 설정을 마친 뒤 선택적으로 추가합니다. Reddit은 승인된 읽기 전용 OAuth 앱의 `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`를 VPS `.env`에만 넣은 후 `AGENT_REACH_SOURCES`에 `reddit`을 추가합니다.

## Windows 자동 배포

```powershell
cd C:\Users\user\orca\projects\newsweaver\deploy\n8n
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
```

첫 실행에서 `.env`가 없으면 스크립트가 `.env.example`을 복사하고 종료합니다. 값을 수정한 뒤 같은 명령을 다시 실행합니다. 로컬 설정만 먼저 만들려면 다음을 사용합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -PrepareOnly
```

배포 스크립트는 Docker와 Caddy 설치 여부를 확인하고, UFW에서 OpenSSH, 80, 443만 허용합니다. 5678과 Agent Reach runner의 8787은 외부 방화벽에 열지 않습니다.

## 설치 후 확인

```bash
cd /opt/n8n
docker compose ps
docker compose logs --tail=100 n8n
systemctl status coa-agent-reach-runner --no-pager
systemctl status coa-n8n-backup.timer --no-pager
journalctl -u caddy -n 100 --no-pager
```

정상 접속 주소는 `https://n8n.coanews.co.kr`입니다. DNS가 아직 반영되지 않았으면 다음 SSH 터널로만 임시 접속합니다.

```powershell
ssh -L 5678:127.0.0.1:5678 root@158.247.245.66
```

브라우저에서 `http://127.0.0.1:5678`을 엽니다. VPS IP의 5678 포트로 직접 접속하지 않습니다.

## 수집 운영

- Vercel 기본 수집: 매일 06:00 KST, Naver와 Google 중심, 18개 키워드
- VPS Agent Reach: 매일 16:30 KST, Exa, 공식 출처, RSS, 54개 키워드
- 소재 정리: 매일 17:30 KST, 중복 제거, 점수화, 클러스터 및 브리프 생성
- AI는 원시 수집에 사용하지 않고 선택된 브리프의 200~1600자 맥락 요약에만 사용
- `n8n/workflow_collect.json`과 `n8n/workflow_suggest.json`은 보관용이며 활성화하지 않음

`workflow_agent_reach_collect.json`을 n8n에 import한 경우 환경변수를 확인한 뒤 이 워크플로를 활성 상태로 유지합니다.

자동 수집 시간은 `/vps-collector`의 `자동 수집 일정`에서 설정합니다. 이 워크플로는 5분마다 Supabase 설정을 확인해 선택한 KST 시각에만 실행합니다. 배포 후 `workflows/workflow_agent_reach_collect.json`을 n8n에 다시 import하고 기존 Agent Reach 워크플로를 교체한 뒤 활성화합니다.

## 백업과 복원

VPS는 매일 02:10 KST에 `/opt/backups/coa-n8n`으로 다음 항목을 암호화해 보관합니다.

- n8n Postgres dump와 데이터 볼륨
- Docker, Caddy 및 `.env` 설정
- `SUPABASE_DB_URL`이 있으면 Supabase PostgreSQL dump

수동 백업:

```bash
sudo /opt/n8n/backup.sh
```

복원 시험은 운영 복원과 같은 절차로 수행하되 최신 백업 하나를 지정합니다.

```bash
sudo /opt/n8n/restore.sh /opt/backups/coa-n8n/coa-n8n-YYYYMMDD-HHMMSS.tar.gz.enc RESTORE
```

DS220j 연계는 [`nas/README.md`](nas/README.md)를 따릅니다. NAS가 VPS에서 백업 파일을 가져오는 pull 방식이므로 NAS 포트를 인터넷에 공개하지 않습니다.

## 수동 설치 핵심 명령

```bash
mkdir -p /opt/n8n
cd /opt/n8n
docker compose up -d
cp /opt/n8n/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
docker ps
```
