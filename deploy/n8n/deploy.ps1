param(
    [switch] $PrepareOnly
)

$ErrorActionPreference = "Stop"

$RemoteHost = "root@158.247.245.66"
$RemoteDir = "/opt/n8n"
$ExpectedIp = "158.247.245.66"
$Domain = "n8n.coanews.co.kr"
$PublicUrl = "https://$Domain"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

function Fail($Message) {
    Write-Host ""
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Step($Name, [scriptblock] $Block) {
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        $global:LASTEXITCODE = 0
        & $Block
        if ($global:LASTEXITCODE -ne 0) { throw "Exit code $global:LASTEXITCODE" }
    }
    catch {
        Write-Host "[ERROR] Step failed: $Name" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

function New-RandomHex([int] $ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-EnvValue($Name) {
    $match = [regex]::Match([IO.File]::ReadAllText((Join-Path $ScriptDir ".env")), "(?m)^" + [regex]::Escape($Name) + "[ \t]*=[ \t]*(.*)$")
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return ""
}

function Set-EnvValue($Name, $Value) {
    $path = Join-Path $ScriptDir ".env"
    $text = [IO.File]::ReadAllText($path)
    $pattern = "(?m)^" + [regex]::Escape($Name) + "[ \t]*=.*$"
    $line = "$Name=$Value"
    if ([regex]::IsMatch($text, $pattern)) {
        $text = [regex]::Replace($text, $pattern, $line)
    } else {
        if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += "`r`n" }
        $text += "$line`r`n"
    }
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

Set-Location $ScriptDir
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Fail "Install Windows OpenSSH Client (ssh) first." }
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) { Fail "Install Windows OpenSSH Client (scp) first." }

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[ACTION REQUIRED] .env was created." -ForegroundColor Yellow
    Write-Host "Set POSTGRES_PASSWORD in $ScriptDir\.env, then run .\deploy.ps1 again."
    exit 1
}

if ([string]::IsNullOrWhiteSpace((Get-EnvValue "POSTGRES_PASSWORD"))) {
    Fail "POSTGRES_PASSWORD is empty in .env. Set it and run again."
}

$generated = @()
foreach ($name in @("N8N_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace((Get-EnvValue $name))) {
        Set-EnvValue $name (New-RandomHex)
        $generated += $name
    }
}
$runnerSecret = Get-EnvValue "AGENT_REACH_RUNNER_SECRET"
$webhookSecret = Get-EnvValue "AGENT_REACH_WEBHOOK_SECRET"
if ([string]::IsNullOrWhiteSpace($runnerSecret) -and [string]::IsNullOrWhiteSpace($webhookSecret)) {
    $runnerSecret = New-RandomHex
    Set-EnvValue "AGENT_REACH_RUNNER_SECRET" $runnerSecret
    Set-EnvValue "AGENT_REACH_WEBHOOK_SECRET" $runnerSecret
    $generated += "AGENT_REACH_RUNNER_SECRET/AGENT_REACH_WEBHOOK_SECRET"
} elseif ([string]::IsNullOrWhiteSpace($runnerSecret)) {
    Set-EnvValue "AGENT_REACH_RUNNER_SECRET" $webhookSecret
} elseif ([string]::IsNullOrWhiteSpace($webhookSecret)) {
    Set-EnvValue "AGENT_REACH_WEBHOOK_SECRET" $runnerSecret
}
if ($generated.Count -gt 0) {
    Write-Host "Generated missing secrets: $($generated -join ', ')" -ForegroundColor Green
    Write-Host "Keep .env and its backup password in a secure password manager." -ForegroundColor Yellow
}

if ($PrepareOnly) {
    Write-Host "[OK] Local .env preparation completed. No network or VPS changes were made." -ForegroundColor Green
    exit 0
}

Invoke-Step "Create remote directories" {
    & ssh $RemoteHost "mkdir -p $RemoteDir/scripts $RemoteDir/lib $RemoteDir/workflows $RemoteDir/systemd"
}
Invoke-Step "Upload deploy/n8n files" {
    & scp -r ./ "${RemoteHost}:${RemoteDir}/"
}
Invoke-Step "Upload Agent Reach scripts and workflows" {
    & scp (Join-Path $ProjectDir "scripts\agent-reach-collect.js") (Join-Path $ProjectDir "scripts\agent-reach-runner.js") (Join-Path $ProjectDir "scripts\collection-notifications.js") (Join-Path $ProjectDir "scripts\keyword-selection.js") (Join-Path $ProjectDir "scripts\research-query-taxonomy.js") (Join-Path $ProjectDir "scripts\backfill-editorial-policy.js") "${RemoteHost}:${RemoteDir}/scripts/"
    & scp (Join-Path $ProjectDir "lib\freeCollection.js") (Join-Path $ProjectDir "lib\editorialPolicy.js") (Join-Path $ProjectDir "lib\koreanNewsRss.js") "${RemoteHost}:${RemoteDir}/lib/"
    & scp (Join-Path $ProjectDir "n8n\workflow_agent_reach_collect.json") "${RemoteHost}:${RemoteDir}/workflows/"
    & scp (Join-Path $ProjectDir "package.json") "${RemoteHost}:${RemoteDir}/package.json"
}

$RemoteScript = @'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
cd /opt/n8n
sed -i 's/\r$//' .env
chmod 600 .env

echo "==> Install base packages"
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release ufw openssl python3 python3-venv nodejs npm

echo "==> Install Agent Reach Node dependencies"
if [ -f /opt/n8n/package.json ]; then
  cd /opt/n8n
  npm install --omit=dev
fi

echo "==> Ensure Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker compose version

echo "==> Ensure Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
systemctl enable --now caddy

echo "==> Configure firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH || ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status

echo "==> Install Agent Reach"
if [ ! -x /root/.agent-reach-venv/bin/agent-reach ]; then
  python3 -m venv /root/.agent-reach-venv
  /root/.agent-reach-venv/bin/python -m pip install --upgrade pip
  /root/.agent-reach-venv/bin/python -m pip install "https://github.com/Panniantong/Agent-Reach/archive/main.zip"
  PATH="/root/.agent-reach-venv/bin:$PATH" agent-reach install --env=auto || true
fi
if ! mcporter config list 2>/dev/null | grep -q '^exa$'; then
  mcporter config add exa https://mcp.exa.ai/mcp
fi

echo "==> Install Agent Reach runner"
install -m 0644 /opt/n8n/systemd/coa-agent-reach-runner.service /etc/systemd/system/coa-agent-reach-runner.service
systemctl daemon-reload
systemctl enable coa-agent-reach-runner
systemctl restart coa-agent-reach-runner

echo "==> Start Postgres and n8n"
docker compose up -d

echo "==> Allow n8n container to reach the host Agent Reach runner"
N8N_NETWORK_ID="$(docker inspect coa-n8n --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}')"
N8N_DOCKER_SUBNET="$(docker network inspect "$N8N_NETWORK_ID" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
if [ -z "$N8N_DOCKER_SUBNET" ]; then
  echo "[ERROR] Could not determine the n8n Docker subnet." >&2
  exit 1
fi
ufw allow from "$N8N_DOCKER_SUBNET" to any port 8787 proto tcp comment 'n8n to Agent Reach runner'
ufw reload

echo "==> Install daily encrypted backup"
chmod 700 /opt/n8n/backup.sh /opt/n8n/restore.sh /opt/n8n/health-check.sh
getent group coa-backup >/dev/null || groupadd --system coa-backup
id coa-backup >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash --gid coa-backup coa-backup
passwd -l coa-backup >/dev/null 2>&1 || true
install -d -m 0711 -o root -g root /opt/backups
install -d -m 0750 -o root -g coa-backup /opt/backups/coa-n8n
find /opt/backups/coa-n8n -maxdepth 1 -type f -name 'coa-n8n-*.tar.gz.enc*' -exec chgrp coa-backup {} + -exec chmod 0640 {} +
install -m 0644 /opt/n8n/systemd/coa-n8n-backup.service /etc/systemd/system/coa-n8n-backup.service
install -m 0644 /opt/n8n/systemd/coa-n8n-backup.timer /etc/systemd/system/coa-n8n-backup.timer
systemctl daemon-reload
systemctl enable --now coa-n8n-backup.timer

echo "==> Install operations health checks"
install -m 0644 /opt/n8n/systemd/coa-ops-health.service /etc/systemd/system/coa-ops-health.service
install -m 0644 /opt/n8n/systemd/coa-ops-health.timer /etc/systemd/system/coa-ops-health.timer
systemctl daemon-reload
systemctl enable --now coa-ops-health.timer

echo "==> Local health checks"
docker compose ps
curl -fsS http://127.0.0.1:8787/health
docker exec coa-n8n node -e "fetch(process.env.AGENT_REACH_RUNNER_URL.replace('/run','/health')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

echo "==> DNS and HTTPS activation"
DNS_IP="$(getent ahostsv4 n8n.coanews.co.kr | awk '{print $1; exit}' || true)"
if [ "$DNS_IP" = "158.247.245.66" ]; then
  cp /opt/n8n/Caddyfile /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
  echo "HTTPS_READY=1"
else
  echo "[WARNING] DNS currently resolves to '${DNS_IP:-NXDOMAIN}', expected 158.247.245.66."
  echo "[WARNING] n8n is running locally, but Caddy activation was skipped. Run deploy.ps1 again after DNS is set."
  echo "HTTPS_READY=0"
fi

/usr/bin/docker ps
echo "DEPLOY_COMPLETE"
'@

Invoke-Step "Configure and start VPS services" {
    $RemoteScript | & ssh $RemoteHost "bash -s"
}

Write-Host ""
Write-Host "[OK] VPS preparation completed." -ForegroundColor Green
Write-Host "Public URL after DNS activation: $PublicUrl" -ForegroundColor Green
Write-Host "Before DNS is ready, use an SSH tunnel if needed:" -ForegroundColor Yellow
Write-Host "  ssh -L 5678:127.0.0.1:5678 $RemoteHost"
Write-Host "  Then open http://127.0.0.1:5678"
